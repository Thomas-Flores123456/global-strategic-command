/**
 * 详情抽屉：全局状态 + 三层查找（世界书 catalog 唯一真源优先 → codex 动态档案 → 兜底）
 * - catalog：世界书有效目录（buildings / productions / researches / retrofits / projects / protocols）+ 通用可信度引擎对齐
 * - codex：仅当世界书目录未命中时，回退查询 AI 创造的动态条目（EVA 增补）
 * - 兜底：无档案条目给中性提示，不报错
 * 任务/情报类不走查找，由面板直接 openDetail。
 */
import { reactive } from 'vue';

import {
  findMechaSupportFallback,
  loadGirlDossierDetail,
  type GirlWorldbookReaderLike,
} from '../../中控悬浮窗/models/archiveIndex';
import {
  inferDefaultResearchDuration,
  parseEtaStringToWorkload,
} from '../../中控悬浮窗/models/worldbookCatalogHelpers';
import type { EngCommandDetail } from '../../中控悬浮窗/models/engCommands';
import {
  buildEntityCredibilityIndex,
  evaluateEntityCredibility,
} from '../core/entityCredibility';
import { classifyBuildingRing, ringToCnLabel } from '../engines/buildingCoordEngine';
import { BUILTIN_BUILDING_UPGRADE_SPECS } from '../engines/productionReconciliation';
import { BUILTIN_RETROFIT_UPGRADE_SPECS } from '../engines/projectEngineHelpers';
import { durationFromEntry } from '../engines/settleFloorHelpers';
import { canon } from '../parse/parseTypesAndCanon';
import { useCatalogStore } from './useCatalog';

export interface DetailData {
  title: string;
  /** 类别标签：科技/建筑/生产/任务/情报/档案… */
  kind: string;
  /** 参数键值对，网格展示 */
  params: [string, string][];
  desc: string;
  /** 底部弱化附注（来源说明等） */
  note?: string;
  /** 是否为纯档案只读查阅模式（为 true 时 DetailDrawer 隐藏底部列装生产/投入建造/研发立项操作栏） */
  readonly?: boolean;
  /** 工程实例四令载荷（ENG-UI-03；仅 kind='工程' 时携带，驱动指令按钮组+取消二次确认） */
  eng?: EngCommandDetail;
}

export const detail = reactive<{ open: boolean; data: DetailData | null }>({
  open: false,
  data: null,
});

export function openDetail(data: DetailData): DetailData {
  detail.data = data;
  detail.open = true;
  return data;
}

export function closeDetail() {
  detail.open = false;
}

interface CodexLike {
  name: string;
  kind: string;
  desc: string;
  params: Record<string, string>;
}

/** 去掉生产名中的数量后缀（"5.56mm步枪弹 ×2000" → "5.56mm步枪弹"） */
function stripCount(s: string): string {
  return s.replace(/\s*×.*$/, '');
}

const BUILDING_LOOKUP_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  建造厂: ['建造厂核心'],
  盟军建造厂: ['建造厂核心'],
  苏联建造厂: ['建造厂核心'],
  尤里建造厂: ['尤里建造厂核心', '建造厂核心'],
  尤里建造厂核心: ['尤里建造厂核心', '建造厂核心'],
  心灵前哨站: ['尤里建造厂核心', '建造厂核心'],
  生化反应炉: ['高能厌氧生化反应炉'],
  尤里生化反应炉: ['高能厌氧生化反应炉'],
  厌氧生化反应炉: ['高能厌氧生化反应炉'],
  盟军兵营: ['兵营'],
  苏联兵营: ['兵营'],
  尤里兵营: ['尤里克隆与新兵训导营', '兵营'],
  尤里训导营: ['尤里克隆与新兵训导营', '兵营'],
  尤里新兵训导营: ['尤里克隆与新兵训导营', '兵营'],
  心灵装具与基因调谐所: ['心灵重塑与认知感化院', '个人装备制造所'],
  心灵重塑感化院: ['心灵重塑与认知感化院'],
  克隆缸: ['生物克隆与素体培育中心', '尤里克隆与新兵训导营'],
  克隆培育中心: ['生物克隆与素体培育中心'],
  基因克隆中心: ['生物克隆与素体培育中心'],
  盟军战车工厂: ['战车工厂'],
  苏联战车工厂: ['战车工厂'],
  尤里战车工厂: ['尤里生物机电战车总装厂', '战车工厂'],
  尤里战车厂: ['尤里生物机电战车总装厂', '战车工厂'],
  尤里战车总装厂: ['尤里生物机电战车总装厂', '战车工厂'],
  部队回收厂: ['阿尔法脑波协同广播与多巴胺节律中枢', '战地维修所'],
  神经态势中心: ['尤里深层神经态势与防空指挥中心'],
  母脑特装总装跨: ['母脑湿件培育与特装总装跨'],
  盟军空军指挥部: ['空军指挥部'],
  苏联空军指挥部: ['空军指挥部'],
  尤里空军指挥部: ['神经航空引导盘', '空军指挥部'],
  飞碟整备充能巢: ['环形磁流体飞碟整备与微波充能巢'],
  盟军造船厂: ['海军造船厂'],
  苏联造船厂: ['海军造船厂'],
  尤里造船厂: ['尤里半潜与仿生造船厂', '海军造船厂'],
  尤里仿生造船厂: ['尤里半潜与仿生造船厂', '海军造船厂'],
  尤里潜艇船坞: ['尤里半潜与仿生造船厂', '半潜消磁船坞与龟背重弹装填栈桥'],
  半潜重弹船坞: ['半潜消磁船坞与龟背重弹装填栈桥'],
  造船厂: ['海军造船厂'],
  盟军矿石精炼厂: ['矿石精炼厂'],
  苏联矿石精炼厂: ['矿石精炼厂'],
  盟军维修工厂: ['战地维修所'],
  苏联维修工厂: ['战地维修所'],
  维修工厂: ['战地维修所'],
  盟军个人装备制造所: ['个人装备制造所'],
  苏联个人装备制造所: ['个人装备制造所'],
  复制中心: ['国家总动员兵工城', '国家总动员兵工城实现', '陆军军校'],
  盟军先进态势与C4ISR指挥实现: ['盟军先进态势与C4ISR指挥中心'],
  '盟军先进态势与 C4ISR 指挥实现': ['盟军先进态势与C4ISR指挥中心'],
  先进光棱塔升级: ['先进光棱塔'],
  爱国者阵地增强改装: ['爱国者PAC-3增强防空阵地'],
  数字孪生与柔性生产改造: ['数字孪生与柔性生产车间'],
  智能电网调度改造: ['智能电网潮流调度中心'],
  预测维护改造: ['预测性健康维护中心'],
  无人仓储与最优调度改造: ['无人立体仓储调度中心'],
  盟军稳定入轨实现: ['盟军稳定入轨发射场'],
  盟军持续轨道节点实现: ['盟军持续轨道空间站'],
  苏联先进态势与防空指挥实现: ['苏联先进态势与防空指挥中心'],
  战略铁路编组与动员扩建: ['战略铁路编组与动员枢纽'],
  装甲储备与装备再生扩建: ['装甲储备与装备再生基地'],
  'Crusher Crane维修—拆件—报废扩建': ['Crusher Crane重型拆解回收站'],
  '快堆—闭式燃料循环升级': ['快堆闭式循环核电站'],
  地下国家连续性升级: ['国家连续性深层地下要塞'],
  国家总动员兵工城实现: ['国家总动员兵工城'],
  地下重载军运实现: ['地下重载军运管道枢纽'],
  铁幕多节点网络升级: ['铁幕多节点偏折网络'],
  工业工厂: ['苏维埃工业工厂'],
  磁能反应炉: ['苏联磁能反应炉'],
  红星设计局: ['红星实验设计局综合体'],
  红星实验设计局: ['红星实验设计局综合体'],
  红星科学城: ['国家战略工程综合体／红星科学城'],
  核弹发射井: ['核导弹工程与地下发射群'],
  战术核导弹发射井: ['核导弹工程与地下发射群'],
  超时空传送仪: ['超时空传送仪（初级）', '超时空传送阵列'],
  天气控制机: ['天气控制仪（初级）', '天气控制仪增强设施'],
  天气控制仪: ['天气控制仪（初级）', '天气控制仪增强设施'],
  爱国者防空导弹阵地: ['爱国者防空阵地'],
  高射炮防空阵地: ['苏联高射炮', '近程防空阵地', '中程防空阵地'],
  盖特机炮: ['盖特机炮塔'],
  盖特机炮阵位: ['盖特机炮塔'],
  盖特机炮防空阵: ['盖特机炮塔'],
  盖特防空阵: ['盖特机炮塔'],
  精神控制塔: ['心灵控制塔'],
  坦克碉堡: ['并网式神经-液冷重装碉堡', '驻军碉堡'],
  神经重装碉堡: ['并网式神经-液冷重装碉堡'],
  尤里生化护墙: ['尤里复合生化护墙'],
  苍穹之眼反导阵: ['苍穹之眼高能微波与神经制导防空反导阵地'],
  潜意识幻象发生器: ['认知迷雾与潜意识幻象发生器'],
  尤里作战实验室: ['基因测序与心灵谐振研究院', '战斗实验室'],
  尤里战斗实验室: ['基因测序与心灵谐振研究院', '战斗实验室'],
  尤里实验室: ['基因测序与心灵谐振研究院', '战斗实验室'],
  基因心灵研究院: ['基因测序与心灵谐振研究院'],
  基因心灵院: ['基因测序与心灵谐振研究院'],
  高维意识科学院: ['双螺旋生命工程与高维意识科学院'],
  高维科学院: ['双螺旋生命工程与高维意识科学院'],
  基因突变器: ['基因崩解与神经凋亡共振阵列'],
  尤里基因突变器: ['基因崩解与神经凋亡共振阵列'],
  基因崩解阵列: ['基因崩解与神经凋亡共振阵列'],
  心灵控制器: ['心灵支配仪'],
  奴隶矿场: ['矿石精炼厂', '异界奇珍种质基因嵌合与异兽驯化温床'],
  尤里奴隶矿场: ['矿石精炼厂', '异界奇珍种质基因嵌合与异兽驯化温床'],
  哨戒炮: ['哨戒炮位', '苏联哨戒炮', '遥控武器站塔'],
  机枪碉堡: ['驻军碉堡', '盟军碉堡', '苏联战斗碉堡'],
  战斗碉堡: ['苏联战斗碉堡', '驻军碉堡'],
};

function normalizeBuildingLookupKey(raw: string): string {
  return raw
    .trim()
    .replace(/\s*[（(](?:初级|Tier\s*\d+|SMR)[）)]\s*/gi, '')
    .replace(/^(?:盟军|苏联|苏维埃|尤里)(?=.{2,})/u, '')
    .trim();
}

export function resolveLookupCandidates(rawName: string): string[] {
  const trimmed = rawName.trim();
  if (!trimmed) return [];
  const stripped = stripCount(trimmed);
  const norm = normalizeBuildingLookupKey(trimmed);
  const syns = BUILDING_LOOKUP_SYNONYMS[trimmed] ?? [];
  const set = new Set<string>([trimmed, stripped, ...syns, norm].filter(Boolean));
  return [...set];
}

interface CatalogBuildingLike {
  name: string;
  cost: number;
  power: number;
  desc: string;
  faction?: string;
  system_group?: string;
  research?: string | null;
  need_building?: string;
  upgrade_mode?: string;
  standalone?: boolean;
  host_building?: string | readonly string[];
  upgraded_name?: string;
  aliases?: readonly string[];
}

interface CatalogProductionLike {
  name: string;
  cost: number;
  need_building: string;
  max_count?: number;
  aliases?: readonly string[];
  desc: string;
}

interface CatalogResearchLike {
  id?: string;
  name: string;
  cost: number | string;
  eta: string;
  line: string;
  tier: number;
  prereq: string;
  unlocks: string;
  desc: string;
  workload?: {
    days?: number;
    min_days?: number;
    tflops?: number;
    tops?: number;
  };
  aliases?: readonly string[];
}

function formatMinutesAsEtaText(totalMinutes: number): string {
  if (!Number.isFinite(totalMinutes) || totalMinutes <= 0) return '';
  const days = totalMinutes / 1440;
  if (days >= 1) {
    const roundedDays = Number.isInteger(days) ? String(days) : days.toFixed(1).replace(/\.0$/, '');
    return `约 ${roundedDays} 日`;
  }
  const hours = totalMinutes / 60;
  if (hours >= 1) {
    const roundedHours = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
    return `约 ${roundedHours} 小时`;
  }
  return `约 ${Math.max(1, Math.round(totalMinutes))} 分钟`;
}

export function resolveResearchEtaDisplay(r: {
  eta?: string;
  cost?: number | string;
  tier?: number;
  workload?: { days?: number; min_days?: number };
}): string {
  const rawEta = typeof r.eta === 'string' ? r.eta.trim() : '';
  const wlDays =
    typeof r.workload?.days === 'number' && Number.isFinite(r.workload.days) && r.workload.days > 0
      ? r.workload.days
      : undefined;
  const wlMinDays =
    typeof r.workload?.min_days === 'number' && Number.isFinite(r.workload.min_days) && r.workload.min_days > 0
      ? r.workload.min_days
      : undefined;

  let baseEta = rawEta;
  if (!baseEta && (wlDays || wlMinDays)) {
    baseEta = `约${wlDays ?? wlMinDays}日`;
  }
  if (!baseEta) {
    const numCost = typeof r.cost === 'number' ? r.cost : Number(r.cost);
    baseEta = inferDefaultResearchDuration(numCost, r.tier).eta;
  }

  const effectiveMinDays = wlMinDays ?? parseEtaStringToWorkload(baseEta)?.min_days;
  const effectiveDays = wlDays ?? parseEtaStringToWorkload(baseEta)?.days;
  if (
    effectiveMinDays &&
    effectiveDays &&
    effectiveMinDays < effectiveDays &&
    !baseEta.includes('保底') &&
    !baseEta.includes('-')
  ) {
    return `${baseEta}（极限可缩至 ${effectiveMinDays} 日）`;
  }
  return baseEta;
}

interface CatalogRetrofitLike {
  name: string;
  cost?: number;
  research?: string;
  desc?: string;
  target_unit?: string | readonly string[];
  host_building?: string | readonly string[];
  upgraded_name?: string | Readonly<Record<string, string>>;
  aliases?: readonly string[];
}

interface CatalogProjectLike {
  id?: string;
  name: string;
  cost?: number;
  grade?: string;
  scope?: string;
  desc?: string;
  modules?: ReadonlyArray<{ name?: string; id?: string; cost?: number }>;
  aliases?: readonly string[];
}

interface CatalogProtocolLike {
  id?: string;
  name: string;
  faction?: string;
  track?: string;
  tier?: number;
  cost_points?: number;
  experiment_cost_credits?: number;
  desc?: string;
  aliases?: readonly string[];
}

function openBuildingDetail(b: CatalogBuildingLike, trimmedName: string): DetailData {
  const bUpg = BUILTIN_BUILDING_UPGRADE_SPECS[b.name] ?? BUILTIN_BUILDING_UPGRADE_SPECS[trimmedName];
  const mode = b.upgrade_mode ?? bUpg?.upgrade_mode;
  const standalone = b.standalone ?? (bUpg?.upgraded_name ? false : mode === 'addon' ? false : true);
  const hosts =
    typeof b.host_building === 'string'
      ? [b.host_building]
      : Array.isArray(b.host_building)
        ? b.host_building
        : (bUpg?.host_building ?? []);
  const upgName = b.upgraded_name ?? bUpg?.upgraded_name;
  const bDur = durationFromEntry(b);
  const bDurText = bDur ? `${formatMinutesAsEtaText(bDur.totalMinutes)}（标准工期）` : '标准工期 (即时部署)';
  const ring = classifyBuildingRing(b.name);
  const ringLabel = ringToCnLabel(ring);
  const ringDesc =
    ring === 'core'
      ? 'MCV原点'
      : ring === 'inner'
        ? '能源科研中枢'
        : ring === 'outer'
          ? '防线超武工事'
          : '产线后勤母体';
  const params: [string, string][] = [
    ['造价', `$${b.cost}`],
    [b.power < 0 ? '发电' : '耗电', `${Math.abs(b.power)} W`],
    ['工期', bDurText],
    ['防务圈层', `${ringLabel}（${ringDesc}）`],
  ];
  if (b.faction) {
    params.push([
      '所属阵营',
      b.faction === 'allied'
        ? '盟军体系'
        : b.faction === 'soviet'
          ? '苏联体系'
          : b.faction === 'yuri'
            ? '尤里体系'
            : b.faction === 'common'
              ? '通用基建'
              : b.faction,
    ]);
  }
  if (b.system_group) {
    params.push(['体系分环', b.system_group]);
  }
  if (mode === 'addon') {
    params.push(['部署类型', '母体附着扩建挂件']);
  } else if (mode === 'replace' && standalone === false) {
    params.push(['部署类型', '原位升阶替换包']);
  } else if (mode === 'replace') {
    params.push(['部署类型', '高阶独立建筑 / 原位升级双轨']);
  }
  if (hosts.length > 0) {
    params.push(['附着母体', hosts.join(' / ')]);
  }
  if (upgName) {
    params.push(['升级后型号', upgName]);
  }
  if (b.research) params.push(['前置研究', b.research]);
  if (b.need_building) params.push(['前置建筑', b.need_building]);
  return openDetail({
    title: b.name === trimmedName ? b.name : `${trimmedName}（${b.name}）`,
    kind: '建筑',
    params,
    desc: b.desc,
  });
}

function openProductionDetail(
  p: CatalogProductionLike,
  trimmedName: string,
  matchedBaseTargets: readonly string[],
  matchedRetrofitName: string,
): DetailData {
  const isModernizedLookup = matchedBaseTargets.length > 0 && p.name !== trimmedName;
  const pDur = durationFromEntry(p);
  const pDurText = pDur ? `${formatMinutesAsEtaText(pDur.totalMinutes)}（战术列装）` : '标准工期 (战术列装)';
  const params: [string, string][] = [
    ['造价', `$${p.cost}`],
    ['工期', pDurText],
    ['产地', p.need_building],
  ];
  if (isModernizedLookup) {
    params.push(['基础原型', stripCount(p.name)]);
    if (matchedRetrofitName) params.push(['现代改套件', matchedRetrofitName]);
  }
  if (typeof p.max_count === 'number' && p.max_count > 0) {
    params.push(['数量上限', p.max_count === 1 ? '1（战区唯一）' : `${p.max_count}`]);
  }
  return openDetail({
    title: isModernizedLookup ? trimmedName : p.name,
    kind: '生产',
    params,
    desc: p.desc,
  });
}

function openResearchDetail(r: CatalogResearchLike): DetailData {
  const etaDisplay = resolveResearchEtaDisplay(r);
  const params: [string, string][] = [
    ['费用', String(r.cost)],
    ['工期', etaDisplay],
    ['科技线', `${r.line}线`],
    ['层级', `T${r.tier}`],
    // 阵营特色线命名约定：'X特色'（盟军/焚风/…）——DLC 规范同此约定
    ['归属', r.line.endsWith('特色') ? '阵营特色 · 需MCV在场' : '通用理论 · 全阵营生效'],
    ['前置', r.prereq || '无（基础科技）'],
    ['解锁', r.unlocks || '——'],
  ];
  if (r.workload && (r.workload.tflops || r.workload.tops)) {
    const parts: string[] = [];
    if (r.workload.tflops) parts.push(`${r.workload.tflops} TFLOPS`);
    if (r.workload.tops) parts.push(`${r.workload.tops} TOPS`);
    params.push(['算力需求', parts.join(' + ')]);
  }
  return openDetail({
    title: r.name,
    kind: '科技',
    params,
    desc: r.desc,
    note: `${r.line}线 · T${r.tier}`,
  });
}

function openRetrofitDetail(rf: CatalogRetrofitLike): DetailData {
  const params: [string, string][] = [['造价', `$${rf.cost ?? 0}`]];
  if (rf.research) params.push(['前置研究', rf.research]);
  return openDetail({ title: rf.name, kind: '建筑改造', params, desc: rf.desc ?? '' });
}

function openProjectDetail(proj: CatalogProjectLike): DetailData {
  const params: [string, string][] = [];
  if (typeof proj.cost === 'number') params.push(['预算造价', `$${proj.cost}`]);
  if (proj.grade) params.push(['工程等级', proj.grade]);
  if (proj.scope) params.push(['作用域', proj.scope === 'theater' ? '全战区' : '单基地']);
  if (Array.isArray(proj.modules) && proj.modules.length > 0) {
    params.push(['仓段模块', `${proj.modules.length} 个子模块`]);
  }
  return openDetail({
    title: proj.name,
    kind: '工程',
    params,
    desc: proj.desc ?? '',
    note: `${proj.grade ?? '巨构'}工程`,
  });
}

function openProtocolDetail(proto: CatalogProtocolLike): DetailData {
  const params: [string, string][] = [];
  if (proto.faction) params.push(['阵营', proto.faction]);
  if (proto.track) params.push(['轨道', proto.track]);
  if (proto.tier) params.push(['层级', `T${proto.tier}`]);
  if (typeof proto.cost_points === 'number') params.push(['消耗点数', `${proto.cost_points}`]);
  if (typeof proto.experiment_cost_credits === 'number') {
    params.push(['实验经费', `$${proto.experiment_cost_credits}`]);
  }
  return openDetail({
    title: proto.name,
    kind: '条令',
    params,
    desc: proto.desc ?? '',
    note: [proto.faction, proto.track, proto.tier ? `T${proto.tier}` : ''].filter(Boolean).join(' · '),
  });
}

/**
 * 异步回读机娘世界书详情（含当前聊天绑定书 `档案·{name}` + `剧情·{name}` 双段合并）并打开详情抽屉。
 */
export async function openGirlLookup(
  name: string,
  codex: CodexLike[] = [],
  opts?: { chatBook?: string | null; reader?: GirlWorldbookReaderLike },
): Promise<DetailData> {
  const girlRes = await loadGirlDossierDetail(name, opts);
  if (girlRes.dossierEntry || girlRes.storyEntry) {
    openDetail(girlRes.detail);
    return girlRes.detail;
  }
  const c = codex.find(e => e.name === name);
  if (c) {
    const fallback: DetailData = {
      title: c.name,
      kind: c.kind,
      params: Object.entries(c.params),
      desc: c.desc || '——',
      note: '动态档案 · 由 EVA 增补',
    };
    openDetail(fallback);
    return fallback;
  }
  const empty: DetailData = {
    title: name,
    kind: '档案',
    params: [],
    desc: '',
    note: '暂无详细档案 · 可在对话中请 EVA 补录',
  };
  openDetail(empty);
  return empty;
}

/**
 * 按名称打开详情：世界书有效目录第一优先（含通用可信度引擎对齐） -> codex 动态档案回退 -> 兜底
 */
export function openLookup(name: string, codex: CodexLike[] = []): DetailData {
  const catalog = useCatalogStore();
  const trimmedName = name.trim();
  const canonTrimmed = canon(trimmedName);
  const strippedCountName = stripCount(trimmedName);
  const canonStripped = canon(strippedCountName);
  const candidates = resolveLookupCandidates(trimmedName);
  const synonymTargets = BUILDING_LOOKUP_SYNONYMS[trimmedName] ?? [];
  const normTarget = normalizeBuildingLookupKey(trimmedName);

  const buildings = (catalog.buildings ?? []) as readonly CatalogBuildingLike[];
  const productions = (catalog.productions ?? []) as readonly CatalogProductionLike[];
  const researches = (catalog.researches ?? []) as readonly CatalogResearchLike[];
  const retrofits = (
    (catalog as unknown as { retrofits?: readonly CatalogRetrofitLike[] }).retrofits ?? []
  );
  const projects = (
    (catalog as unknown as { projects?: readonly CatalogProjectLike[] }).projects ?? []
  );
  const protocols = (
    (catalog as unknown as { protocols?: readonly CatalogProtocolLike[] }).protocols ?? []
  );

  // FD-22：预先解析现代化改型后的高级型号名（upgraded_name）反查基础生产单位 + 现代改套件详情
  let matchedRetrofitName = '';
  let matchedBaseTargets: readonly string[] = [];
  for (const r of retrofits) {
    const targets =
      typeof r.target_unit === 'string'
        ? [r.target_unit]
        : Array.isArray(r.target_unit)
          ? r.target_unit
          : [];
    if (!targets.length) continue;
    const upgValues =
      typeof r.upgraded_name === 'string'
        ? [r.upgraded_name]
        : r.upgraded_name && typeof r.upgraded_name === 'object'
          ? Object.values(r.upgraded_name)
          : [];
    if (upgValues.some(u => u.trim() === trimmedName || stripCount(u) === strippedCountName)) {
      matchedRetrofitName = r.name;
      matchedBaseTargets = targets;
      break;
    }
  }
  if (!matchedBaseTargets.length) {
    for (const [rName, spec] of Object.entries(BUILTIN_RETROFIT_UPGRADE_SPECS)) {
      if (!spec.target_unit?.length) continue;
      if (
        spec.upgraded_name === trimmedName ||
        stripCount(spec.upgraded_name) === strippedCountName ||
        (spec.research === '航母电磁弹射改装工程研发' && trimmedName === 'CV-63小鹰级航空母舰(电弹现代改)')
      ) {
        matchedRetrofitName = rName;
        matchedBaseTargets = spec.target_unit;
        break;
      }
    }
  }

  // ── 第一优先级 Step 1a：世界书有效目录精确 / canon / 候选同义匹配（buildings -> productions -> researches -> retrofits -> projects -> protocols） ──
  const bExact =
    buildings.find(e => e.name === trimmedName || canon(e.name) === canonTrimmed) ??
    synonymTargets
      .map(target => buildings.find(e => e.name === target || canon(e.name) === canon(target)))
      .find(Boolean) ??
    buildings.find(e => candidates.includes(e.name)) ??
    (normTarget ? buildings.find(e => normalizeBuildingLookupKey(e.name) === normTarget) : undefined) ??
    buildings.find(
      e =>
        Array.isArray(e.aliases) &&
        e.aliases.some(a => a === trimmedName || canon(a) === canonTrimmed),
    );
  if (bExact) {
    return openBuildingDetail(bExact, trimmedName);
  }

  const pExact =
    productions.find(
      e =>
        e.name === name ||
        e.name === trimmedName ||
        stripCount(e.name) === strippedCountName ||
        canon(e.name) === canonTrimmed ||
        canon(stripCount(e.name)) === canonStripped ||
        (Array.isArray(e.aliases) &&
          e.aliases.some(a => a === name || a === trimmedName || canon(a) === canonTrimmed)),
    ) ??
    (matchedBaseTargets.length > 0
      ? productions.find(e =>
          matchedBaseTargets.some(
            t =>
              e.name === t ||
              stripCount(e.name) === stripCount(t) ||
              canon(e.name) === canon(t) ||
              (Array.isArray(e.aliases) && e.aliases.some(a => a === t || canon(a) === canon(t))),
          ),
        )
      : undefined);
  if (pExact) {
    return openProductionDetail(pExact, trimmedName, matchedBaseTargets, matchedRetrofitName);
  }

  const rExact = researches.find(
    e =>
      e.name === name ||
      e.name === trimmedName ||
      e.id === trimmedName ||
      canon(e.name) === canonTrimmed ||
      (Array.isArray(e.aliases) && e.aliases.some(a => a === trimmedName || canon(a) === canonTrimmed)),
  );
  if (rExact) {
    return openResearchDetail(rExact);
  }

  const rfExact = retrofits.find(
    e =>
      e.name === trimmedName ||
      canon(e.name) === canonTrimmed ||
      (normTarget ? normalizeBuildingLookupKey(e.name) === normTarget : false) ||
      (Array.isArray(e.aliases) && e.aliases.some(a => a === trimmedName || canon(a) === canonTrimmed)),
  );
  if (rfExact) {
    return openRetrofitDetail(rfExact);
  }

  const projExact = projects.find(
    e =>
      e.name === trimmedName ||
      e.id === trimmedName ||
      canon(e.name) === canonTrimmed ||
      (Array.isArray(e.aliases) && e.aliases.some(a => a === trimmedName || canon(a) === canonTrimmed)),
  );
  if (projExact) {
    return openProjectDetail(projExact);
  }

  const protoExact = protocols.find(
    e =>
      e.name === trimmedName ||
      e.id === trimmedName ||
      canon(e.name) === canonTrimmed ||
      (Array.isArray(e.aliases) && e.aliases.some(a => a === trimmedName || canon(a) === canonTrimmed)),
  );
  if (protoExact) {
    return openProtocolDetail(protoExact);
  }

  // ── 第一优先级 Step 1b：通用可信度引擎评估（highThreshold: 0.80） ──
  const credIndex = buildEntityCredibilityIndex({
    buildings,
    productions,
    researches,
    retrofits,
    projects,
    protocols,
  });
  const credRes = evaluateEntityCredibility(credIndex, trimmedName, { highThreshold: 0.80 });
  if (credRes.verdict === 'system_high' && credRes.matchedName && credRes.matchedDomain) {
    const matchedName = credRes.matchedName;
    if (credRes.matchedDomain === 'building') {
      const bHit = buildings.find(e => e.name === matchedName);
      if (bHit) return openBuildingDetail(bHit, trimmedName);
    } else if (credRes.matchedDomain === 'production') {
      const pHit = productions.find(e => e.name === matchedName || stripCount(e.name) === stripCount(matchedName));
      if (pHit) return openProductionDetail(pHit, trimmedName, matchedBaseTargets, matchedRetrofitName);
    } else if (credRes.matchedDomain === 'research') {
      const rHit = researches.find(e => e.name === matchedName);
      if (rHit) return openResearchDetail(rHit);
    } else if (credRes.matchedDomain === 'retrofit') {
      const rfHit = retrofits.find(e => e.name === matchedName);
      if (rfHit) return openRetrofitDetail(rfHit);
    } else if (credRes.matchedDomain === 'project') {
      const projHit = projects.find(e => e.name === matchedName);
      if (projHit) return openProjectDetail(projHit);
    } else if (credRes.matchedDomain === 'protocol') {
      const protoHit = protocols.find(e => e.name === matchedName);
      if (protoHit) return openProtocolDetail(protoHit);
    }
  }

  // ── 第二优先级：世界书目录未命中时，回退查 codex 动态档案（渲染「动态档案 · 由 EVA 增补」） ──
  const c =
    codex.find(e => e.name === name || e.name === trimmedName) ??
    codex.find(e => canon(e.name) === canonTrimmed);
  if (c) {
    const codexDetail = openDetail({
      title: c.name,
      kind: c.kind,
      params: Object.entries(c.params ?? {}),
      desc: c.desc || '——',
      note: '动态档案 · 由 EVA 增补',
    });
    if (c.kind === '人员' || c.desc?.includes('机娘')) {
      void loadGirlDossierDetail(name).then(res => {
        if ((res.dossierEntry || res.storyEntry) && detail.open && detail.data?.title === c.name) {
          detail.data = res.detail;
        }
      });
    }
    return codexDetail;
  }

  // 建筑名子串包含兜底（仅在世界书高可信与 codex 均未命中时触发）
  const bSubstring =
    trimmedName.length >= 2
      ? buildings.find(e => e.name.includes(trimmedName) || trimmedName.includes(e.name))
      : undefined;
  if (bSubstring) {
    return openBuildingDetail(bSubstring, trimmedName);
  }

  const supportHit = findMechaSupportFallback(name);
  if (supportHit) {
    return openDetail(supportHit);
  }

  const fallbackDetail = openDetail({
    title: name,
    kind: '档案',
    params: [],
    desc: '',
    note: '暂无详细档案 · 可在对话中请 EVA 补录',
  });
  void loadGirlDossierDetail(name).then(res => {
    if ((res.dossierEntry || res.storyEntry) && detail.open && detail.data?.title === name) {
      detail.data = res.detail;
    }
  });
  return fallbackDetail;
}

export function useDetail() {
  return {
    detail,
    openDetail,
    closeDetail,
    openLookup,
    openGirlLookup,
  };
}
