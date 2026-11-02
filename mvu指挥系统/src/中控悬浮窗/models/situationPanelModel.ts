/**
 * situationPanelModel.ts —— 战区舆情与暴露态势总控面板纯函数视图模型（FD-55 · PKG-C）
 *
 * 职责：
 * 1. 民心舆情与市政页签（moraleTab）：
 *    - 五阶刻度尺与破冰头栏（无人在意 / 沸反盈天 ~ 万众一心）；
 *    - 跨系统实时增益与惩罚算力板（正向资金链日收修正、暴露度每轮联动漂移、民间眼线情报源、动荡阈值预警）；
 *    - 驻地民生与环保公共设施盘点矩阵（8 类民生基建在役盘点、缺电断供预警、待建短板推荐）；
 *    - 分基地辖区民心与地方势力态度对照表；
 *    - 上下文感知的快捷抚民与市政调度指令芯片。
 * 2. 暴露等级与底线拆解页签（exposureTab）：
 *    - 暴露度五级法定标尺（EL-0 ~ EL-4）与永久出圈锁状态；
 *    - 各在役基地常驻暴露底线物理成因拆解（阵营混建摩擦、地表超武信标、伪装屏障抵消、选址天然隐蔽）；
 *    - 平静轮次自然冷却与民心联动漂移合成说明；
 *    - 反侦察与降敏快捷指令芯片。
 *
 * 纯函数准则：零 DOM / 零酒馆 API / 指挥官战术简报语体。
 */

import {
  clampRange,
  computeExposureFloor,
  isMoraleEngaged,
  resolveExposureLevel,
  resolveMoraleStage,
  round2,
  type ExposureCanonicalLabel,
  type ExposureLevelCode,
  type MoraleStageName,
} from '../../红警指挥系统/engines/exposureMoraleEngine';

export type SituationTabKey = 'morale' | 'exposure';

export type SituationTone = 'ok' | 'warn' | 'alert';

export type MoraleTrendLabel = '▲ 上升' | '▼ 下降' | '▬ 平稳' | '隐蔽潜伏';

export type ExposureTrendLabel = '▲ 上升' | '▼ 下降' | '▬ 平稳';

export interface MoraleStageLadderItem {
  stage: Exclude<MoraleStageName, '无人在意'>;
  rangeText: string;
  chainBonusText: string;
  exposureDriftText: string;
  desc: string;
  active: boolean;
}

export interface MoraleActiveEffectsView {
  chainMultiplier: number;
  chainBonusText: string;
  baseDailyPositiveCredits: number;
  moraleDailyCreditsDelta: number;
  moraleDailyCreditsDeltaText: string;
  exposureDriftPerTurn: number;
  exposureDriftText: string;
  informantChannelUnlocked: boolean;
  informantChannelText: string;
  crisisQuestTriggered: boolean;
  crisisAlertText: string;
}

export interface InstalledCivicFacilityItem {
  standardName: string;
  buildingName: string;
  baseName: string;
  buildingState: string;
  isOperational: boolean;
  basePowerDeficit: boolean;
  monthlyBonus: number;
  monthlyBonusText: string;
  statusBadgeText: string;
  outageImpactText: string;
  tone: SituationTone;
}

export interface MissingCivicRecommendationItem {
  name: string;
  firstBuildBonusText: string;
  monthlyBonusText: string;
  roleDesc: string;
}

export interface CivicFacilityMatrixView {
  installed: InstalledCivicFacilityItem[];
  totalMonthlyBonus: number;
  totalMonthlyBonusText: string;
  hasPowerOutageAlert: boolean;
  powerOutageAlertText: string;
  missingRecommendations: MissingCivicRecommendationItem[];
}

export interface RegionalBaseMoraleItem {
  baseId: string;
  baseName: string;
  location: string;
  status: string;
  localMorale: number;
  localMoraleText: string;
  isLocalOverride: boolean;
  localStage: MoraleStageName;
  civicCount: number;
}

export interface RegionalFactionOverviewItem {
  name: string;
  attitude: string;
  risk: string;
  intel: string;
  linkedChains: string[];
}

export interface RegionalOverviewView {
  bases: RegionalBaseMoraleItem[];
  factions: RegionalFactionOverviewItem[];
}

export interface SituationQuickActionChip {
  id: string;
  label: string;
  prompt: string;
  tag: string;
}

export interface MoraleTabViewModel {
  header: {
    value: number;
    valueText: string;
    engaged: boolean;
    stage: MoraleStageName;
    trendText: MoraleTrendLabel;
    lastEventText: string;
    nextStageHint: string;
    effectSummary: string;
  };
  stageLadder: MoraleStageLadderItem[];
  activeEffects: MoraleActiveEffectsView;
  civicMatrix: CivicFacilityMatrixView;
  regionalOverview: RegionalOverviewView;
  quickActions: SituationQuickActionChip[];
}

export interface ExposureLevelLadderItem {
  code: ExposureLevelCode;
  shortName: string;
  rangeText: string;
  canNaturalDecay: boolean;
  consequenceText: string;
  active: boolean;
}

export interface BaseExposureFloorBreakdownItem {
  baseId: string;
  baseName: string;
  siteType: string;
  siteTypeLabel: string;
  factionsInBase: string[];
  factionMixPenalty: number;
  factionMixText: string;
  heavyBeacons: string[];
  heavyBeaconPenalty: number;
  heavyBeaconText: string;
  stealthShields: string[];
  stealthShieldOffset: number;
  stealthShieldText: string;
  siteModifier: number;
  siteModifierText: string;
  netBaseFloor: number;
  netBaseFloorText: string;
}

export interface ExposureFloorBreakdownView {
  totalFloor: number;
  totalFloorText: string;
  irreversibleLocked: boolean;
  bases: BaseExposureFloorBreakdownItem[];
  baseBreakdowns: BaseExposureFloorBreakdownItem[];
}

export interface ExposureDriftSummaryView {
  baseNaturalCoolPerTurn: number;
  baseNaturalCoolText: string;
  moraleDriftPerTurn: number;
  moraleDriftText: string;
  netDriftPerTurn: number;
  netDriftText: string;
  formulaSummaryText: string;
}

export interface ExposureTabViewModel {
  header: {
    value: number;
    valueText: string;
    code: ExposureLevelCode;
    shortName: string;
    canonicalLabel: ExposureCanonicalLabel;
    floor: number;
    floorText: string;
    trendText: ExposureTrendLabel;
    lastEventText: string;
    irreversibleLocked: boolean;
  };
  levelLadder: ExposureLevelLadderItem[];
  floorBreakdown: ExposureFloorBreakdownView;
  driftSummary: ExposureDriftSummaryView;
  driftFormula: ExposureDriftSummaryView;
  quickActions: SituationQuickActionChip[];
}

export interface SituationPanelViewModel {
  moraleTab: MoraleTabViewModel;
  exposureTab: ExposureTabViewModel;
}

interface CivicCatalogDef {
  standardName: string;
  matchRe: RegExp;
  firstBuildBonusText: string;
  monthlyBonus: number;
  monthlyBonusText: string;
  roleDesc: string;
  outageSeverity: 'high' | 'medium' | 'low';
  outageImpactText: string;
  recommendPriority: number;
  unlocksInformant?: boolean;
}

const CIVIC_FACILITY_DEFS: readonly CivicCatalogDef[] = [
  {
    standardName: '净水与供水站',
    matchRe: /净水与供水站|净水站|供水站/i,
    firstBuildBonusText: '+0.50',
    monthlyBonus: 0.15,
    monthlyBonusText: '+0.15 / 月',
    roleDesc: '饮用水四级净化与管网配送（民生头号主力）',
    outageSeverity: 'high',
    outageImpactText: '高危断供：加压泵降载，水塔耗尽后社区停水，触发断水反噬预警（-0.05 / 日）',
    recommendPriority: 1,
  },
  {
    standardName: '社区环卫服务站',
    matchRe: /社区环卫服务站|社区环卫|环卫服务站|环卫站/i,
    firstBuildBonusText: '+0.35',
    monthlyBonus: 0.12,
    monthlyBonusText: '+0.12 / 月',
    roleDesc: '垃圾密闭清运、公共消杀与烈性疫病防疫',
    outageSeverity: 'medium',
    outageImpactText: '防疫降载：机械清运停摆退回人工，防疫效率折半',
    recommendPriority: 2,
    unlocksInformant: true,
  },
  {
    standardName: '基础废物分拣站',
    matchRe: /基础废物分拣站|废物分拣站|废品分拣站/i,
    firstBuildBonusText: '+0.25',
    monthlyBonus: 0.1,
    monthlyBonusText: '+0.10 / 月',
    roleDesc: '平价废品收购惠民窗口 +「民间眼线」社区情报源',
    outageSeverity: 'medium',
    outageImpactText: '收购降速：分选线停机退回人工称重，情报与民心效能折半',
    recommendPriority: 3,
    unlocksInformant: true,
  },
  {
    standardName: '生活污水处理站',
    matchRe: /生活污水处理站|污水处理站/i,
    firstBuildBonusText: '+0.30',
    monthlyBonus: 0.09,
    monthlyBonusText: '+0.09 / 月',
    roleDesc: '生活黑水/灰水生化处理与中水回用，消除排污暴露',
    outageSeverity: 'high',
    outageImpactText: '污水外溢风险：曝气池停机致出水水质恶化，触发臭气/污染告警（-0.03 / 日）',
    recommendPriority: 4,
  },
  {
    standardName: '生态公园与绿化设施',
    matchRe: /生态公园与绿化设施|生态公园|绿化设施/i,
    firstBuildBonusText: '+0.50',
    monthlyBonus: 0.12,
    monthlyBonusText: '+0.12 / 月',
    roleDesc: '公共绿地休憩、微气候调节与地表伪装',
    outageSeverity: 'low',
    outageImpactText: '低敏韧性：仅关闭景观照明，退回人工浇灌，核心民心滋养保留 80%',
    recommendPriority: 5,
  },
  {
    standardName: '深井泵站与水文净化设施',
    matchRe: /深井泵站与水文净化设施|深井泵站|水文净化设施/i,
    firstBuildBonusText: '+0.30',
    monthlyBonus: 0.09,
    monthlyBonusText: '+0.09 / 月',
    roleDesc: '承压水开采与周边缺水聚落民用共生供水',
    outageSeverity: 'medium',
    outageImpactText: '供水降压：外接共生水网停泵，暂停民心正滋养',
    recommendPriority: 6,
  },
  {
    standardName: '生态修复站',
    matchRe: /生态修复站/i,
    firstBuildBonusText: '+0.60',
    monthlyBonus: 0.15,
    monthlyBonusText: '+0.15 / 月',
    roleDesc: '污染毒地淋洗与微生物降解修复（长周期高回报）',
    outageSeverity: 'medium',
    outageImpactText: '修复停滞：淋洗泵停机致修复周期顺延',
    recommendPriority: 7,
  },
  {
    standardName: '环境监测站',
    matchRe: /环境监测站/i,
    firstBuildBonusText: '+0.15',
    monthlyBonus: 0.06,
    monthlyBonusText: '+0.06 / 月',
    roleDesc: '水源/大气全天候传感监测，防范水源投毒与排污泄露',
    outageSeverity: 'medium',
    outageImpactText: '盲区风险：传感器降采样，丧失水质事故实时预警能力',
    recommendPriority: 8,
  },
];

const SUPERWEAPON_OR_HEAVY_BEACON_RE =
  /天气控制|核弹发射井|基因突变|心灵控制塔|心灵信标|铁幕装置|巨炮|要塞巨炮|航天发射|质量投射/i;
const STEALTH_SHIELD_BUILDING_RE = /裂缝产生器|超维暗网|暗网中继|伪装网|电磁欺骗/i;
const ALLIED_BUILDING_RE = /盟军|光棱|爱国者|空指部|裂缝产生器|超时空|天气控制/i;
const SOVIET_BUILDING_RE = /苏联|苏军|磁能|磁暴|特斯拉|铁幕|核子反应堆|核弹发射井|复制中心/i;
const YURI_BUILDING_RE = /尤里|心灵|生物反应炉|基因突变|盖特|精神控制/i;

function isRecord(val: unknown): val is Record<string, unknown> {
  return Boolean(val) && typeof val === 'object' && !Array.isArray(val);
}

function unwrapStateRoot(rawState: unknown): Record<string, unknown> {
  if (!isRecord(rawState)) return {};
  if (
    'exposure' in rawState ||
    'morale' in rawState ||
    'bases' in rawState ||
    'economy' in rawState ||
    'factions' in rawState
  ) {
    return rawState;
  }
  for (const key of ['snapshot', 'stat', 'data']) {
    const sub = rawState[key];
    if (isRecord(sub)) return sub;
  }
  return rawState;
}

function matchCivicDef(buildingName: string): CivicCatalogDef | null {
  const name = buildingName.trim();
  if (!name) return null;
  for (const def of CIVIC_FACILITY_DEFS) {
    if (def.matchRe.test(name)) return def;
  }
  return null;
}

function resolveSiteTypeLabel(siteType: string): string {
  switch (siteType) {
    case 'inland_canyon':
      return '内陆峡谷';
    case 'high_latitude':
      return '高纬冻土';
    case 'sea_platform':
      return '远海平台';
    case 'equatorial_coastal':
      return '赤道海滨';
    case 'orbital_dock':
      return '近地轨道船坞';
    case 'lunar_surface':
      return '月面驻地';
    default:
      return '常规陆地防区';
  }
}

function resolveMoraleTrendText(rawTrend: unknown, engaged: boolean): MoraleTrendLabel {
  if (!engaged) return '隐蔽潜伏';
  const t = String(rawTrend ?? '').trim();
  if (/上升|↑|升|涨/.test(t)) return '▲ 上升';
  if (/下降|↓|降|跌/.test(t)) return '▼ 下降';
  return '▬ 平稳';
}

function resolveExposureTrendText(rawTrend: unknown): ExposureTrendLabel {
  const t = String(rawTrend ?? '').trim();
  if (/上升|↑|升|涨/.test(t)) return '▲ 上升';
  if (/下降|↓|降|跌/.test(t)) return '▼ 下降';
  return '▬ 平稳';
}

function buildNextStageHint(value: number, engaged: boolean): string {
  if (!engaged) {
    return '当与周边聚落发生抚民/扰民接触，或暴露度达到 4.5（EL-2 战区警觉）时自动破冰激活';
  }
  if (value < 2.0) {
    return `距离下一阶「人心惶惶」还差 ${(2.0 - value).toFixed(1)} 分（达 2.0 可解除罢工与告密危机）`;
  }
  if (value < 4.0) {
    return `距离下一阶「观望顺从」还差 ${(4.0 - value).toFixed(1)} 分（达 4.0 可消除商路减收与流言外泄）`;
  }
  if (value < 6.5) {
    return `距离下一阶「安居归心」还差 ${(6.5 - value).toFixed(1)} 分（达 6.5 激活 +10% 资金链增益与民众掩护）`;
  }
  if (value < 8.5) {
    return `距离下一阶「万众一心」还差 ${(8.5 - value).toFixed(1)} 分（民生自动滋养上限 8.5，需实质抚民善政突围）`;
  }
  return '已达最高阶「万众一心」（享 +20% 资金链收益与 -0.12 / 轮人民汪洋铁壁掩护）';
}

export function buildSituationPanelModel(rawState: unknown): SituationPanelViewModel {
  const root = unwrapStateRoot(rawState);
  const rawExposure = isRecord(root.exposure) ? root.exposure : {};
  const rawMorale = isRecord(root.morale) ? root.morale : {};
  const rawEconomy = isRecord(root.economy) ? root.economy : {};
  const rawBases = Array.isArray(root.bases) ? root.bases : [];
  const rawFactions = Array.isArray(root.factions) ? root.factions : [];
  const rawChains = Array.isArray(rawEconomy.chains) ? rawEconomy.chains : [];

  // ── 1. 暴露度基础值与常驻底线拆解 ──
  const expValRaw = Number(rawExposure.value);
  const expVal = Number.isFinite(expValRaw) ? clampRange(expValRaw, 0, 10) : 0.0;
  const expFloorExplicit = Number(rawExposure.floor);

  const activeBases = rawBases.filter(
    (b): b is Record<string, unknown> =>
      isRecord(b) && b.status !== '废弃' && b.status !== '失守',
  );

  const baseBreakdowns: BaseExposureFloorBreakdownItem[] = [];
  for (let i = 0; i < activeBases.length; i++) {
    const base = activeBases[i];
    const baseId = String(base.id || base.name || `base_${i + 1}`);
    const baseName = String(base.name || base.id || `驻地-${i + 1}`);
    const siteType = String(base.site_type ?? '');
    const siteTypeLabel = resolveSiteTypeLabel(siteType);

    if (siteType === 'orbital_dock' || siteType === 'lunar_surface') {
      baseBreakdowns.push({
        baseId,
        baseName,
        siteType,
        siteTypeLabel,
        factionsInBase: [],
        factionMixPenalty: 0,
        factionMixText: '天基/月面防区豁免地面暴露',
        heavyBeacons: [],
        heavyBeaconPenalty: 0,
        heavyBeaconText: '+0.00（天基豁免）',
        stealthShields: [],
        stealthShieldOffset: 0,
        stealthShieldText: '0.00',
        siteModifier: 0,
        siteModifierText: '0.00（轨道/月面天然隔绝）',
        netBaseFloor: 0,
        netBaseFloorText: '0.00',
      });
      continue;
    }

    const factionsSet = new Set<string>();
    const heavyBeacons: string[] = [];
    const stealthShields: string[] = [];
    const buildings = Array.isArray(base.buildings) ? base.buildings : [];

    for (const bld of buildings) {
      if (!isRecord(bld) || bld.state === '停机') continue;
      const bName = String(bld.name ?? '').trim();
      if (!bName) continue;
      const bLayer = String(bld.layer ?? '');
      const isUnderground = /地下|空腔|掩体/.test(bLayer);

      if (!isUnderground) {
        if (ALLIED_BUILDING_RE.test(bName)) factionsSet.add('盟军');
        if (SOVIET_BUILDING_RE.test(bName)) factionsSet.add('苏联');
        if (YURI_BUILDING_RE.test(bName)) factionsSet.add('尤里');
        if (SUPERWEAPON_OR_HEAVY_BEACON_RE.test(bName)) {
          heavyBeacons.push(bName);
        }
      }
      if (STEALTH_SHIELD_BUILDING_RE.test(bName)) {
        stealthShields.push(bName);
      }
    }

    const factionsInBase = Array.from(factionsSet);
    let factionMixPenalty = 0;
    let factionMixText = '单一阵营制式 +0.00';
    if (factionsInBase.length === 2) {
      factionMixPenalty = 0.4;
      factionMixText = `双阵营混建（${factionsInBase.join('/')}）+0.40`;
    } else if (factionsInBase.length >= 3) {
      factionMixPenalty = 0.9;
      factionMixText = `三阵营混建（${factionsInBase.join('/')}）+0.90`;
    }

    const heavyBeaconPenalty = round2(heavyBeacons.length * 0.6);
    const heavyBeaconText =
      heavyBeacons.length > 0
        ? `+${heavyBeaconPenalty.toFixed(2)}（${heavyBeacons.join('、')}）`
        : '+0.00（无地表超武信标）';

    const stealthShieldOffset = round2(-stealthShields.length * 0.35);
    const stealthShieldText =
      stealthShields.length > 0
        ? `${stealthShieldOffset.toFixed(2)}（${stealthShields.join('、')}）`
        : '0.00（未部署伪装屏障）';

    let siteModifier = 0;
    let siteModifierText = '0.00（标准地形）';
    if (siteType === 'inland_canyon' || siteType === 'high_latitude') {
      siteModifier = -0.15;
      siteModifierText = `-0.15（${siteTypeLabel}地形遮蔽）`;
    } else if (siteType === 'sea_platform') {
      siteModifier = -0.25;
      siteModifierText = `-0.25（${siteTypeLabel}远洋隔绝）`;
    }

    const rawBaseFloor = factionMixPenalty + heavyBeaconPenalty + stealthShieldOffset + siteModifier;
    const netBaseFloor = clampRange(Math.max(0, rawBaseFloor), 0, 8.5);

    baseBreakdowns.push({
      baseId,
      baseName,
      siteType,
      siteTypeLabel,
      factionsInBase,
      factionMixPenalty,
      factionMixText,
      heavyBeacons,
      heavyBeaconPenalty,
      heavyBeaconText,
      stealthShields,
      stealthShieldOffset,
      stealthShieldText,
      siteModifier,
      siteModifierText,
      netBaseFloor,
      netBaseFloorText: netBaseFloor.toFixed(2),
    });
  }

  const computedFloor = computeExposureFloor({
    exposure: {
      value: expVal,
      floor: Number.isFinite(expFloorExplicit) ? expFloorExplicit : undefined,
    },
    bases: activeBases as ReadonlyArray<{
      status?: string;
      site_type?: string;
      buildings?: ReadonlyArray<{ name?: string; layer?: string; state?: string }>;
    }>,
  });
  const effectiveFloor =
    Number.isFinite(expFloorExplicit) && expFloorExplicit > computedFloor
      ? clampRange(expFloorExplicit, 0, 9.0)
      : computedFloor;
  const expLevelInfo = resolveExposureLevel(expVal);
  const irreversibleLocked = expVal >= 9.0 || effectiveFloor >= 9.0 || expLevelInfo.irreversibleLock;

  // ── 2. 民心五阶与破冰状态 ──
  const moraleValRaw = Number(rawMorale.value);
  const moraleVal = Number.isFinite(moraleValRaw) ? clampRange(moraleValRaw, 0, 10) : 5.0;
  const moraleEngaged = isMoraleEngaged(
    rawMorale as {
      value?: number;
      level?: string;
      trend?: string;
      last_change?: string;
      engaged?: boolean;
    },
    expVal,
  );
  const moraleStageInfo = resolveMoraleStage(moraleVal, {
    engaged: moraleEngaged,
    exposureValue: expVal,
  });

  const stageLadder: MoraleStageLadderItem[] = [
    {
      stage: '沸反盈天',
      rangeText: '0.0 ~ 2.0',
      chainBonusText: '资金链收益 -25%',
      exposureDriftText: '+0.10 / 轮（民众告密）',
      desc: '辖区罢工抗命、向敌方通报坐标，后勤商路严重受阻',
      active: moraleEngaged && moraleStageInfo.stage === '沸反盈天',
    },
    {
      stage: '人心惶惶',
      rangeText: '2.0 ~ 4.0',
      chainBonusText: '资金链收益 -10%',
      exposureDriftText: '+0.05 / 轮（流言外泄）',
      desc: '流言四起、劳工怠工，外围警戒与物资周转产生摩擦',
      active: moraleEngaged && moraleStageInfo.stage === '人心惶惶',
    },
    {
      stage: '观望顺从',
      rangeText: '4.0 ~ 6.5',
      chainBonusText: '资金链收益 ±0%',
      exposureDriftText: '0.00 / 轮（常态基线）',
      desc: '社会秩序平稳，民众保持中立观望，按章履约交易',
      active: moraleEngaged && moraleStageInfo.stage === '观望顺从',
    },
    {
      stage: '安居归心',
      rangeText: '6.5 ~ 8.5',
      chainBonusText: '资金链收益 +10%',
      exposureDriftText: '-0.08 / 轮（主动掩护）',
      desc: '民众认同驻军秩序，主动提供后勤便利与外围行踪掩护',
      active: moraleEngaged && moraleStageInfo.stage === '安居归心',
    },
    {
      stage: '万众一心',
      rangeText: '8.5 ~ 10.0',
      chainBonusText: '资金链收益 +20%',
      exposureDriftText: '-0.12 / 轮（汪洋铁壁）',
      desc: '军民同心构筑人民汪洋防线，自发反谍锄奸、踊跃支前',
      active: moraleEngaged && moraleStageInfo.stage === '万众一心',
    },
  ];

  // ── 3. 驻地民生与环保公共设施盘点矩阵 ──
  const installedCivic: InstalledCivicFacilityItem[] = [];
  const installedStandardNames = new Set<string>();
  const baseCivicCountMap = new Map<string, number>();
  let totalMonthlyBonus = 0;
  let hasPowerOutageAlert = false;
  let hasOperationalInformantFacility = false;

  for (let i = 0; i < activeBases.length; i++) {
    const base = activeBases[i];
    const baseId = String(base.id || base.name || `base_${i + 1}`);
    const baseName = String(base.name || base.id || `驻地-${i + 1}`);
    const powerObj = isRecord(base.power) ? base.power : {};
    const powerGen = Number(powerObj.gen ?? 0);
    const powerUse = Number(powerObj.use ?? 0);
    const basePowerDeficit = powerUse > powerGen;
    const buildings = Array.isArray(base.buildings) ? base.buildings : [];

    let baseCivicCount = 0;
    for (const bld of buildings) {
      if (!isRecord(bld)) continue;
      const bName = String(bld.name ?? '').trim();
      const def = matchCivicDef(bName);
      if (!def) continue;

      baseCivicCount++;
      installedStandardNames.add(def.standardName);
      const buildingState = String(bld.state ?? '运转').trim() || '运转';

      let isOperational = false;
      let monthlyBonus = 0;
      let monthlyBonusText = '0.00 / 月';
      let statusBadgeText = '运转中';
      let tone: SituationTone = 'ok';

      if (buildingState === '运转' && !basePowerDeficit) {
        isOperational = true;
        monthlyBonus = def.monthlyBonus;
        monthlyBonusText = def.monthlyBonusText;
        statusBadgeText = '供电正常 · 运转中';
        tone = 'ok';
        totalMonthlyBonus = round2(totalMonthlyBonus + monthlyBonus);
        if (def.unlocksInformant) {
          hasOperationalInformantFacility = true;
        }
      } else if (buildingState === '运转' && basePowerDeficit) {
        isOperational = false;
        monthlyBonus = 0;
        if (def.outageSeverity === 'high') {
          hasPowerOutageAlert = true;
          monthlyBonusText = '暂停滋养（断供反噬）';
          statusBadgeText = '主网缺电 · 断供预警';
          tone = 'alert';
        } else {
          monthlyBonusText = '0.00 / 月（缺电降载）';
          statusBadgeText = '主网缺电 · 降载运行';
          tone = 'warn';
        }
      } else {
        isOperational = false;
        monthlyBonus = 0;
        monthlyBonusText = '0.00 / 月（未投产）';
        statusBadgeText = buildingState === '建造中' ? '施工建设中' : `暂停（${buildingState}）`;
        tone = buildingState === '受损' ? 'alert' : 'warn';
      }

      installedCivic.push({
        standardName: def.standardName,
        buildingName: bName,
        baseName,
        buildingState,
        isOperational,
        basePowerDeficit,
        monthlyBonus,
        monthlyBonusText,
        statusBadgeText,
        outageImpactText: def.outageImpactText,
        tone,
      });
    }
    baseCivicCountMap.set(baseId, baseCivicCount);
  }

  const missingRecommendations: MissingCivicRecommendationItem[] = CIVIC_FACILITY_DEFS.filter(
    def => !installedStandardNames.has(def.standardName),
  )
    .sort((a, b) => a.recommendPriority - b.recommendPriority)
    .slice(0, 4)
    .map(def => ({
      name: def.standardName,
      firstBuildBonusText: def.firstBuildBonusText,
      monthlyBonusText: def.monthlyBonusText,
      roleDesc: def.roleDesc,
    }));

  // ── 4. 跨系统实时增益 / 惩罚算力板 ──
  let baseDailyPositiveCredits = 0;
  for (const c of rawChains) {
    if (!isRecord(c)) continue;
    const flow = String(c.flow ?? '收入');
    const status = String(c.status ?? 'active');
    if (flow === '支出') continue;
    if (status === 'broken' || status === 'exhausted' || status === 'establishing') continue;
    const rate = Number(c.rate_daily ?? 0);
    const eff = typeof c.eff === 'number' && Number.isFinite(c.eff) ? c.eff : 1;
    if (rate > 0 && eff > 0) {
      baseDailyPositiveCredits += rate * eff;
    }
  }
  baseDailyPositiveCredits = Math.round(baseDailyPositiveCredits);

  const moraleDailyCreditsDelta = Math.round(
    baseDailyPositiveCredits * (moraleStageInfo.chainMultiplier - 1),
  );
  const moraleDailyCreditsDeltaText =
    moraleDailyCreditsDelta > 0
      ? `+${moraleDailyCreditsDelta} / 日`
      : moraleDailyCreditsDelta < 0
        ? `${moraleDailyCreditsDelta} / 日`
        : '±0 / 日';

  const expDrift = moraleStageInfo.exposureDriftPerTurn;
  let exposureDriftText = '0.00 / 轮（隐蔽潜伏，无民众联动漂移）';
  if (moraleEngaged) {
    if (expDrift < 0) {
      const reason =
        moraleStageInfo.stage === '万众一心' ? '人民汪洋铁壁掩护' : '民众主动协作掩护';
      exposureDriftText = `${expDrift.toFixed(2)} / 轮（${reason}）`;
    } else if (expDrift > 0) {
      const reason =
        moraleStageInfo.stage === '沸反盈天' ? '罢工抗命与敌情告密' : '流言四起增加暴露风险';
      exposureDriftText = `+${expDrift.toFixed(2)} / 轮（${reason}）`;
    } else {
      exposureDriftText = '0.00 / 轮（社会秩序平稳，无额外暴露漂移）';
    }
  }

  const informantChannelUnlocked =
    hasOperationalInformantFacility || (moraleEngaged && moraleVal >= 6.5);
  const informantChannelText = informantChannelUnlocked
    ? '已点亮「民间眼线」社区情报源'
    : '未点亮（需建成分拣站/环卫站，或民心达 6.5 安居归心）';

  const crisisQuestTriggered = moraleEngaged && moraleVal < 4.2;
  const crisisAlertText = crisisQuestTriggered
    ? '已触发舆情危机阈值（< 4.2），急需开展平民抚恤或补建净水/环卫设施'
    : '辖区治安平稳，未触发动荡危机阈值';

  // ── 5. 分基地辖区民心与地方势力态度对照 ──
  const regionalBases: RegionalBaseMoraleItem[] = activeBases.map((base, idx) => {
    const baseId = String(base.id || base.name || `base_${idx + 1}`);
    const baseName = String(base.name || base.id || `驻地-${idx + 1}`);
    const location = String(base.location || '未标定防区');
    const status = String(base.status || '运转中');
    const isLocalOverride = typeof base.morale === 'number' && Number.isFinite(base.morale);
    const localMorale = isLocalOverride ? clampRange(Number(base.morale), 0, 10) : moraleVal;
    const localStage = resolveMoraleStage(localMorale, {
      engaged: moraleEngaged || isLocalOverride,
      exposureValue: expVal,
    }).stage;

    return {
      baseId,
      baseName,
      location,
      status,
      localMorale,
      localMoraleText: localMorale.toFixed(1),
      isLocalOverride,
      localStage,
      civicCount: baseCivicCountMap.get(baseId) ?? 0,
    };
  });

  const regionalFactions: RegionalFactionOverviewItem[] = rawFactions
    .filter((f): f is Record<string, unknown> => isRecord(f) && Boolean(f.name))
    .map(f => {
      const fName = String(f.name ?? '').trim();
      const linkedChains: string[] = [];
      for (const c of rawChains) {
        if (!isRecord(c)) continue;
        const cName = String(c.name ?? '').trim();
        if (!cName) continue;
        const deps = isRecord(c.deps) ? c.deps : {};
        const depFaction = String(deps.faction ?? '').trim();
        const reason = String(c.reason ?? '');
        if (
          (depFaction && depFaction === fName) ||
          (fName && (cName.includes(fName) || reason.includes(fName)))
        ) {
          linkedChains.push(cName);
        }
      }
      return {
        name: fName,
        attitude: String(f.attitude || '未接触'),
        risk: String(f.risk || '未知'),
        intel: String(f.intel || '暂无接触情报摘要'),
        linkedChains,
      };
    });

  // ── 6. 民心与市政快捷调度指令 ──
  const moraleQuickActions: SituationQuickActionChip[] = [];
  if (hasPowerOutageAlert) {
    moraleQuickActions.push({
      id: 'morale-restore-power',
      label: '【紧急抢修民生电网恢复净水与排污供能】',
      prompt:
        '【紧急抢修民生电网恢复净水与排污供能】优先保障驻地净水与供水站、生活污水处理站供电，派员安抚受断水影响的社区民众。',
      tag: '断供抢修',
    });
  } else {
    moraleQuickActions.push({
      id: 'morale-medical-relief',
      label: '【调拨净水与医药开展辖区抚民义诊】',
      prompt:
        '【调拨净水与医药开展辖区抚民义诊】向周边聚落开放净水配给与战地医疗巡诊，缓解平民生活物资紧缺并提振辖区民心。',
      tag: '抚民善政',
    });
  }
  moraleQuickActions.push({
    id: 'morale-informant-recycle',
    label: '【依托废品分拣站平价收购并搜集民间眼线情报】',
    prompt:
      '【依托废品分拣站平价收购并搜集民间眼线情报】通过基础废物分拣站与社区环卫站开展惠民收购，顺势向往来民众收集周边外军可疑动向。',
    tag: '民间眼线',
  });
  moraleQuickActions.push({
    id: 'morale-discipline-patrol',
    label: '【严明驻军军纪排查外围扰民隐患】',
    prompt:
      '【严明驻军军纪排查外围扰民隐患】约束重装车队夜间机动路线，整肃防区外围哨卡纪律，及时赔偿修缮受损农田道路。',
    tag: '军纪整肃',
  });

  // ── 7. 暴露等级五级标尺与漂移算式 ──
  const levelLadder: ExposureLevelLadderItem[] = [
    {
      code: 'EL-0',
      shortName: '日常隐蔽',
      rangeText: '0.0 ~ 2.0',
      canNaturalDecay: false,
      consequenceText: '完全隐匿于常规背景噪声中，外部强权与地方势力均未察觉异常',
      active: expLevelInfo.code === 'EL-0',
    },
    {
      code: 'EL-1',
      shortName: '轻微可疑',
      rangeText: '2.0 ~ 4.5',
      canNaturalDecay: true,
      consequenceText: '零星目击与边角传闻，平静轮次可按 -0.05 / 轮自然消退',
      active: expLevelInfo.code === 'EL-1',
    },
    {
      code: 'EL-2',
      shortName: '战区警觉',
      rangeText: '4.5 ~ 7.0',
      canNaturalDecay: true,
      consequenceText: '触发周边侦察试探并自动破冰激活民心，平静轮次按 -0.03 / 轮缓慢冷却',
      active: expLevelInfo.code === 'EL-2',
    },
    {
      code: 'EL-3',
      shortName: '大势震动',
      rangeText: '7.0 ~ 9.0',
      canNaturalDecay: false,
      consequenceText: '登上区域强权核心案头，丧失自然冷却能力，随时面临联合军事围剿',
      active: expLevelInfo.code === 'EL-3',
    },
    {
      code: 'EL-4',
      shortName: '位面出圈',
      rangeText: '9.0 ~ 10.0',
      canNaturalDecay: false,
      consequenceText: '触发最高级战略锁定 [R]，常驻底线永久锁定 9.0 不可逆转',
      active: expLevelInfo.code === 'EL-4',
    },
  ];

  let baseNaturalCoolPerTurn = 0;
  let baseNaturalCoolText = '0.00 / 轮（EL-0 已处隐蔽基线）';
  if (expLevelInfo.code === 'EL-1') {
    baseNaturalCoolPerTurn = expVal > effectiveFloor ? -0.05 : 0;
    baseNaturalCoolText = '-0.05 / 轮（EL-1 轻微可疑自然消退）';
  } else if (expLevelInfo.code === 'EL-2') {
    baseNaturalCoolPerTurn = expVal > effectiveFloor ? -0.03 : 0;
    baseNaturalCoolText = '-0.03 / 轮（EL-2 战区警觉缓慢冷却）';
  } else if (expLevelInfo.code === 'EL-3' || expLevelInfo.code === 'EL-4') {
    baseNaturalCoolPerTurn = 0;
    baseNaturalCoolText = '0.00 / 轮（高危态势丧失自然冷却能力）';
  }

  let netDriftPerTurn = 0;
  if (expDrift > 0) {
    netDriftPerTurn = expDrift;
  } else if (expLevelInfo.canNaturalDecay && expVal > effectiveFloor) {
    const baseCool = expLevelInfo.code === 'EL-1' ? -0.05 : -0.03;
    const moraleCool = expDrift < 0 ? expDrift : 0;
    netDriftPerTurn = Math.min(baseCool, moraleCool);
  }

  const netDriftText =
    netDriftPerTurn > 0
      ? `+${netDriftPerTurn.toFixed(2)} / 轮（民心恶化引发告密外泄）`
      : netDriftPerTurn < 0
        ? `${netDriftPerTurn.toFixed(2)} / 轮（平静轮次净冷却，受常驻底线 ${effectiveFloor.toFixed(1)} 托底）`
        : `0.00 / 轮（当前受常驻底线 ${effectiveFloor.toFixed(1)} 或高危锁定约束）`;

  const formulaSummaryText = `平静轮次净漂移 = 自然冷却（${baseNaturalCoolText}）与民心联动修正（${exposureDriftText}）取优合成，下限受常驻暴露底线 ${effectiveFloor.toFixed(1)} 托底保护。`;

  const driftSummary: ExposureDriftSummaryView = {
    baseNaturalCoolPerTurn,
    baseNaturalCoolText,
    moraleDriftPerTurn: expDrift,
    moraleDriftText: exposureDriftText,
    netDriftPerTurn,
    netDriftText,
    formulaSummaryText,
  };

  const exposureQuickActions: SituationQuickActionChip[] = [
    {
      id: 'exp-stealth-silence',
      label: '【构筑洞口伪装网与全频段电磁静默】',
      prompt:
        '【构筑洞口伪装网与全频段电磁静默】加固各驻地地表伪装网与裂缝/暗网屏障覆盖，严格管制大功率雷达与高能耗设施信号外泄。',
      tag: '频谱静默',
    },
    {
      id: 'exp-counter-recon',
      label: '【排查外围侦察眼线并严控重装夜间机动】',
      prompt:
        '【排查外围侦察眼线并严控重装夜间机动】派遣反侦察巡逻队清理防区外围可疑探子，将重型装备调动转入夜间或地下掩体进行。',
      tag: '反谍降敏',
    },
    {
      id: 'exp-decoy-beacon',
      label: '【释放假情报信标误导外部势力侦察视线】',
      prompt:
        '【释放假情报信标误导外部势力侦察视线】在远离核心驻地的废弃地段布置诱饵信标与伪造车辙，转移外部侦察重心。',
      tag: '欺骗掩护',
    },
  ];

  const lastMoraleChange = String(rawMorale.last_change ?? '').trim();
  const lastExposureChange = String(rawExposure.last_change ?? '').trim();

  return {
    moraleTab: {
      header: {
        value: moraleVal,
        valueText: moraleVal.toFixed(1),
        engaged: moraleEngaged,
        stage: moraleStageInfo.stage,
        trendText: resolveMoraleTrendText(rawMorale.trend, moraleEngaged),
        lastEventText:
          lastMoraleChange ||
          (moraleEngaged
            ? '近期无显著舆情波动'
            : '部队保持隐蔽潜伏，尚未与周边聚落发生公开接触'),
        nextStageHint: buildNextStageHint(moraleVal, moraleEngaged),
        effectSummary: moraleStageInfo.effectSummary,
      },
      stageLadder,
      activeEffects: {
        chainMultiplier: moraleStageInfo.chainMultiplier,
        chainBonusText: moraleStageInfo.chainBonusText,
        baseDailyPositiveCredits,
        moraleDailyCreditsDelta,
        moraleDailyCreditsDeltaText,
        exposureDriftPerTurn: expDrift,
        exposureDriftText,
        informantChannelUnlocked,
        informantChannelText,
        crisisQuestTriggered,
        crisisAlertText,
      },
      civicMatrix: {
        installed: installedCivic,
        totalMonthlyBonus,
        totalMonthlyBonusText: `+${totalMonthlyBonus.toFixed(2)} / 月`,
        hasPowerOutageAlert,
        powerOutageAlertText: hasPowerOutageAlert
          ? '主电网赤字致净水/排污设施停供，面临断水与污水反噬风险，请立即补建发电设施或关停高耗电武备！'
          : '在役民生公用设施供电平稳',
        missingRecommendations,
      },
      regionalOverview: {
        bases: regionalBases,
        factions: regionalFactions,
      },
      quickActions: moraleQuickActions,
    },
    exposureTab: {
      header: {
        value: expVal,
        valueText: expVal.toFixed(1),
        code: expLevelInfo.code,
        shortName: expLevelInfo.shortName,
        canonicalLabel: expLevelInfo.canonicalLabel,
        floor: effectiveFloor,
        floorText: effectiveFloor.toFixed(1),
        trendText: resolveExposureTrendText(rawExposure.trend),
        lastEventText: lastExposureChange || '近期无显著暴露异常事件',
        irreversibleLocked,
      },
      levelLadder,
      floorBreakdown: {
        totalFloor: effectiveFloor,
        totalFloorText: effectiveFloor.toFixed(1),
        irreversibleLocked,
        bases: baseBreakdowns,
        baseBreakdowns,
      },
      driftSummary,
      driftFormula: driftSummary,
      quickActions: exposureQuickActions,
    },
  };
}
