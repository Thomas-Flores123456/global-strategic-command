/**
 * buildingSystemModel.ts
 * 基地建筑五大体系总览纯函数模型（FD-18 / CTRL-BLD-SYS-01）
 * 严格零副作用、只读消费 StatData 与 EffectiveCatalog，严禁调用任何酒馆写 API。
 */
import type { BuildingDef } from '../../红警指挥系统/core/catalog';
import { deriveBuildableWithContext } from '../../红警指挥系统/core/catalog';
import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import { buildCatalogPrerequisiteContext } from '../../红警指挥系统/core/catalogRuntimeContext';
import { isDebugBypassPrerequisitesActive } from '../../红警指挥系统/composables/useDebugMode';
import { canon } from '../../红警指挥系统/parse/parsePipeline';
import { BUILTIN_BUILDING_UPGRADE_SPECS } from '../../红警指挥系统/engines/productionReconciliation';
import { resolveBuildingRelativeCoord } from '../../红警指挥系统/engines/buildingCoordEngine';
import type { Base, Building, QueueItem, StatData } from '../../红警指挥系统/core/schema';
import { CONYARD_ORIGIN_NAMES, stripFactionBuildingPrefix } from './tagTaxonomy';
import { normalizeActionBuildingName } from './worldbookCatalogHelpers';
import {
  baseHasOperationalConyard,
  BLUEPRINT_EDGES,
  BLUEPRINT_NODES,
  BUILDING_SYSTEM_TABS,
  buildMetricsForSystem,
  classifyBuildingSystem,
  inferBuildingFaction,
  inferConyardFaction,
  inferSystemSubGroup,
  isConyardBuildingName,
  isDualModeBuildingName,
  normalizeBuildingFactionFilter,
  resolveAvailableBuildingFactions,
  resolveBaseOperationalConyardFactions,
  type BuildingBlueprintNode,
  type BuildingBlueprintNodeSpec,
  type BuildingFactionFilter,
  type BuildingNodeState,
  type BuildingOverviewModel,
  type BuildingScopeMode,
  type BuildingSystemId,
  type BuildingSystemView,
  type BuiltBuildingInstanceRef,
  type BuiltFacilitySummary,
  type FacilityUpgradeOption,
  type LiveBaseSandboxModel,
  type LiveLayerGroupModel,
  type LiveSandboxBlip,
  type LiveSectorCardModel,
  type PowerLedgerItem,
  type SystemCatalogEntry,
} from './buildingSystemHelpers';

export * from './buildingSystemHelpers';

function resolveBlueprintNodeIdForCatalogEntry(
  entry: SystemCatalogEntry,
  sysSpecs: BuildingBlueprintNodeSpec[],
): string {
  // 1. 精确命中节点主名或 aliases
  for (const spec of sysSpecs) {
    if (matchesNodeSpec(entry.name, spec)) {
      return spec.id;
    }
  }
  const n = entry.name;
  // 2. 按各体系语义精准归并到对应 SVG 拓扑节点
  if (entry.system === 'military') {
    if (/建造厂|Sputnik|工程扩建|心灵前哨/.test(n)) return 'mil_conyard';
    if (/军校|动员兵工城|复制中心|克隆缸|生物克隆与素体培育|胚胎复制|基因克隆/.test(n)) return 'mil_academy';
    if (/装备|心灵重塑与认知感化院|心灵装具/.test(n)) return 'mil_equip';
    if (/兵营|新兵训导营|新兵洗脑|狂热信徒/.test(n)) return 'mil_barracks';
    if (/维修|预测维护|Crusher|部队回收|生物质与金属解构/.test(n)) return 'mil_depot';
    if (/天启|母脑湿件培育与特装总装跨|装甲储备/.test(n)) return 'mil_apoc_bay';
    if (/工业工厂|自动化战车|军工综合体|联合兵工厂|数字孪生/.test(n)) return 'mil_indplant';
    if (/战车|生物机电战车总装厂|悬浮底盘/.test(n)) return 'mil_warfactory';
    if (/基洛夫|环形磁流体飞碟整备/.test(n)) return 'mil_kirov_hangar';
    if (/空天/.test(n)) return 'mil_airradar';
    if (/空军|神经航空引导盘|神经制空引导盘|空域指挥塔/.test(n)) return 'mil_airforce';
    if (/无畏|半潜消磁船坞与龟背重弹装填栈桥|战略堡垒潜艇/.test(n)) return 'mil_dreadnought_dock';
    if (/简易船坞/.test(n)) return 'mil_dock';
    if (/造船|船坞|半潜与仿生造船厂|潜艇船坞|潜艇母港/.test(n)) return 'mil_shipyard';
    if (/保险库/.test(n)) return 'mil_mecha_vault';
    if (/再造舱|基因容器调律舱/.test(n)) return 'mil_mecha_pod';
    return 'mil_mecha_shop';
  }
  if (entry.system === 'defense') {
    if (/感知塔|探针|心灵感应器|心灵探测仪|广域脑波侦测/.test(n)) return 'def_far_radar';
    if (/爱国者|苍穹之眼/.test(n)) return 'def_far_patriot';
    if (/THAAD|GPI|防空指挥|深层神经态势与防空指挥/.test(n)) return 'def_far_s300';
    if (/裂缝|认知迷雾与潜意识幻象发生器|神经迷雾与感官屏蔽|全谱|广谱/.test(n)) return 'def_far_gap';
    if (/高射炮|中程防空|盖特机炮|双联盖特/.test(n)) return 'def_mid_flak';
    if (/光棱塔|磁电谐振棱镜塔/.test(n)) return 'def_mid_prism';
    if (/磁暴线圈|精神控制塔|心灵控制塔/.test(n)) return 'def_mid_tesla';
    if (/反装甲|巨炮|榴弹炮|火箭炮|迫击炮|区域防御要塞/.test(n)) return 'def_mid_at';
    if (/哨戒炮|遥控武器站|神经毒素喷射塔|基因狂暴抑止/.test(n)) return 'def_near_pillbox';
    if (/碉堡|神经-液冷重装碉堡|活性生物凝胶自愈合装甲外皮|神经接驳坦克掩体|强化掩体/.test(n)) return 'def_near_bunker';
    if (/近程防空|近防系统|诱饵|伪装|照明/.test(n)) return 'def_near_flame';
    if (/围墙|复合生化护墙|护城墙|障碍带|纳米雷区/.test(n)) return 'def_near_wall';
    if (/地下掩蔽所|活体神经签名与防夺舍认证门禁|深层地下|地下国家连续性/.test(n)) return 'def_core_bunker';
    if (/前线综合后勤|野战物资库|生活营区/.test(n)) return 'def_core_fire';
    if (/野战医疗|掩蔽库|硬化机堡|看押所/.test(n)) return 'def_core_repair';
    return 'def_core_decon';
  }
  if (entry.system === 'agro') {
    if (/深井泵站|净水与供水/.test(n)) return 'agro_water';
    if (/种质|育种|异界奇珍种质基因嵌合/.test(n)) return 'agro_seed';
    if (/饲料|合成生物蛋白|狂暴激素营养槽/.test(n)) return 'agro_feed';
    if (/土壤培育|生态修复|生态公园/.test(n)) return 'agro_farmland';
    if (/规模化种植/.test(n)) return 'agro_greenhouse';
    if (/菌类|多倍体速生巨菌/.test(n)) return 'agro_hydro';
    if (/智能养殖/.test(n)) return 'agro_livestock';
    if (/昆虫蛋白/.test(n)) return 'agro_poultry';
    if (/水产养殖/.test(n)) return 'agro_aqua';
    if (/粮食加工/.test(n)) return 'agro_grain';
    if (/生态副食|离体肌束与无神经培养肉/.test(n)) return 'agro_meat';
    if (/食品加工|冷链/.test(n)) return 'agro_cold';
    if (/有机循环|社区环卫/.test(n)) return 'agro_biogas';
    if (/废水|污水|环境监测/.test(n)) return 'agro_wastewater';
    return 'agro_incinerator';
  }
  if (entry.system === 'industry') {
    if (/太阳能|风力|光能|同位素|RTG/.test(n)) return 'ind_solar';
    if (/磁能反应炉|深层地热-嗜热菌电化学复合反应堆/.test(n)) return 'ind_tesla_plant';
    if (/核反应堆|SMR|裂变|快堆/.test(n)) return 'ind_smr';
    if (/聚变|红色太阳|深层脑波谐振与灵能电容/.test(n)) return 'ind_fusion';
    if (/电力分配|生物电容与脑波谐振变电枢|智能电网|超导磁|脉冲电网|蓄电池/.test(n)) return 'ind_grid';
    if (/发电厂|电厂|发电机|生化反应炉|高能厌氧生化反应炉|高密度生物质热解发电/.test(n)) return 'ind_power';
    if (/矿石精炼|奴隶矿场|自动化神经劳工采掘/.test(n)) return 'ind_refinery';
    if (/抽油机|炼油厂/.test(n)) return 'ind_oil';
    if (/合成燃料|化工合成/.test(n)) return 'ind_synfuel';
    if (/纳米合成/.test(n)) return 'ind_nanite';
    if (/矿业综合体|弹药制造|微型盾构|阿尔法脑波协同广播与多巴胺节律中枢/.test(n)) return 'ind_heavy';
    if (/矿石储仓|重装周转总库/.test(n)) return 'ind_silo';
    if (/燃料与分散储罐/.test(n)) return 'ind_oiltank';
    return 'ind_rail';
  }
  // research_space
  if (/情报分析/.test(n)) return 'rs_taclab';
  if (/红星实验设计局|联合科研/.test(n)) return 'rs_redstar';
  if (/战斗实验室|作战实验室|基因测序与心灵谐振|认知神经科学与心灵工程院/.test(n)) return 'rs_battlelab';
  if (/量子超算|科学城|双螺旋生命工程与高维意识科学院|基因突变与合成生物学圣殿|阿卡夏集体潜意识/.test(n)) return 'rs_quantum';
  if (/超算中心/.test(n)) return 'rs_supercomp';
  if (/卫星测控|间谍卫星|深空测控/.test(n)) return 'rs_sat';
  if (/航天发射|山体发射|稳定入轨|反重力飞碟工程与亚轨道弹射井/.test(n)) return 'rs_launchpad';
  if (/火箭制造|轨道船坞|地月转运|在轨燃料|轨道侦察/.test(n)) return 'rs_rocket';
  if (/超时空|基因突变器|基因崩解与神经凋亡共振阵列|天基基因突变散播阵列/.test(n)) return 'rs_chrono';
  if (/天气控制|天基超级光棱|心灵控制器|心灵支配仪|行星级心灵共振放大器/.test(n)) return 'rs_weather';
  if (/铁幕/.test(n)) return 'rs_iron';
  if (/核导弹|赤星轨道|轨道武器平台/.test(n)) return 'rs_nuke';
  return 'rs_station';
}
const BLUEPRINT_NODE_CANON_SET_CACHE = new WeakMap<BuildingBlueprintNodeSpec, Set<string>>();

function getSpecCanonSet(spec: BuildingBlueprintNodeSpec): Set<string> {
  let set = BLUEPRINT_NODE_CANON_SET_CACHE.get(spec);
  if (set) return set;
  set = new Set<string>();
  const candidates = [spec.name, ...(spec.aliases ?? [])];
  for (const cand of candidates) {
    set.add(canon(cand));
    set.add(canon(stripFactionBuildingPrefix(cand)));
  }
  BLUEPRINT_NODE_CANON_SET_CACHE.set(spec, set);
  return set;
}

const BLUEPRINT_NODE_BY_EXACT_NAME = new Map<string, BuildingBlueprintNodeSpec>(
  BLUEPRINT_NODES.map(s => [s.name, s]),
);

const BLUEPRINT_NODES_BY_SYSTEM = new Map<BuildingSystemId, BuildingBlueprintNodeSpec[]>();
for (const spec of BLUEPRINT_NODES) {
  const arr = BLUEPRINT_NODES_BY_SYSTEM.get(spec.system) ?? [];
  arr.push(spec);
  BLUEPRINT_NODES_BY_SYSTEM.set(spec.system, arr);
}

function matchesNodeSpec(buildingName: string, spec: BuildingBlueprintNodeSpec): boolean {
  const cBuilding = canon(buildingName);
  const cStripped = canon(stripFactionBuildingPrefix(buildingName));
  const candSet = getSpecCanonSet(spec);
  return candSet.has(cBuilding) || candSet.has(cStripped);
}

/**
 * 构建五大建筑体系总览视图模型（纯函数，零副作用）
 */
export function buildBuildingOverviewModel(
  snapshot: StatData | null | undefined,
  catalog?: Partial<EffectiveCatalog> | null,
  options?: { scope?: BuildingScopeMode; activeBaseIndex?: number; factionFilter?: BuildingFactionFilter },
): BuildingOverviewModel {
  const scope: BuildingScopeMode = options?.scope ?? 'base';
  const factionFilter: BuildingFactionFilter = options?.factionFilter ?? 'all';
  const allBases: Base[] = snapshot?.bases ?? [];
  const activeBaseIndex = Math.max(0, Math.min(options?.activeBaseIndex ?? 0, Math.max(0, allBases.length - 1)));
  const currentBase = allBases[activeBaseIndex];
  const targetBasesWithIndex: Array<{ base: Base; baseIndex: number }> =
    scope === 'global'
      ? allBases
          .map((base, baseIndex) => ({ base, baseIndex }))
          .filter(x => x.base.status !== '失守' && x.base.status !== '废弃')
      : currentBase
        ? [{ base: currentBase, baseIndex: activeBaseIndex }]
        : [];
  const targetBases: Base[] = targetBasesWithIndex.map(x => x.base);
  const activeBaseName =
    scope === 'global' ? `战区全局（${targetBases.length} 座基地）` : (currentBase?.name ?? '未选定基地');

  const powerGen = targetBases.reduce((sum, b) => sum + (b.power?.gen ?? 0), 0);
  const powerUse = targetBases.reduce((sum, b) => sum + (b.power?.use ?? 0), 0);

  const catalogBuildings: BuildingDef[] = catalog?.buildings ?? [];
  const catalogByCanonName = new Map<string, BuildingDef>();
  const catalogByStrippedCanonName = new Map<string, BuildingDef>();
  for (const cb of catalogBuildings) {
    const cName = canon(cb.name);
    if (!catalogByCanonName.has(cName)) catalogByCanonName.set(cName, cb);
    const cStripped = canon(stripFactionBuildingPrefix(cb.name));
    if (!catalogByStrippedCanonName.has(cStripped)) catalogByStrippedCanonName.set(cStripped, cb);
  }

  const resolveSingleBuildingPower = (bName: string): { powerGen: number; powerUse: number } => {
    const catDef =
      catalogByCanonName.get(canon(bName)) ??
      catalogByStrippedCanonName.get(canon(stripFactionBuildingPrefix(bName)));
    const rawPower = typeof catDef?.power === 'number' && Number.isFinite(catDef.power) ? catDef.power : 0;
    if (isConyardBuildingName(bName) && rawPower >= 0) {
      return { powerGen: 50, powerUse: 0 };
    }
    if (rawPower < 0) return { powerGen: Math.abs(rawPower), powerUse: 0 };
    if (rawPower > 0) return { powerGen: 0, powerUse: rawPower };
    return { powerGen: 0, powerUse: 0 };
  };

  // 汇总目标范围内已建建筑（排除 state === '建造中'）与建造中项，保留精确 baseIndex/buildingIndex 供可编辑模式直接写回
  const builtEntries: Array<{
    building: Building;
    baseIndex: number;
    baseId: string;
    baseName: string;
    buildingIndex: number;
    instance: BuiltBuildingInstanceRef;
  }> = [];
  const underConstructionEntries: BuiltBuildingInstanceRef[] = [];
  const inProgressBuildingNames = new Map<string, number>();

  for (const { base, baseIndex } of targetBasesWithIndex) {
    const bList = base.buildings ?? [];
    const ordinalCounter = new Map<string, number>();
    const resolvedBaseId = base.id || base.name;
    for (let buildingIndex = 0; buildingIndex < bList.length; buildingIndex += 1) {
      const b = bList[buildingIndex];
      if (!b) continue;
      const cKey = canon(b.name);
      const instanceOrdinal = (ordinalCounter.get(cKey) ?? 0) + 1;
      ordinalCounter.set(cKey, instanceOrdinal);
      const spatial = resolveBuildingRelativeCoord(b, buildingIndex, resolvedBaseId);
      const { powerGen: bPowerGen, powerUse: bPowerUse } = resolveSingleBuildingPower(b.name);
      const addons = Array.isArray((b as { addons?: unknown[] }).addons)
        ? (b as { addons?: unknown[] }).addons!.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
        : [];
      const instance: BuiltBuildingInstanceRef = {
        baseIndex,
        baseId: resolvedBaseId,
        baseName: base.name,
        buildingIndex,
        name: b.name,
        instanceOrdinal,
        state: (b.state as BuiltBuildingInstanceRef['state']) || '运转',
        mode: b.mode === '加速' ? '加速' : '生产',
        accelScope: b.accel_scope === 'base' ? 'base' : 'global',
        layer: b.layer || '地面',
        dualModeCapable: isDualModeBuildingName(b.name),
        coord: spatial.coord,
        bearing: spatial.bearingLabel,
        ring: spatial.ring,
        ringLabel: spatial.ringLabel,
        bearingLabel: spatial.bearingLabel,
        progress: b.progress,
        eta: b.eta,
        addons,
        powerGen: bPowerGen,
        powerUse: bPowerUse,
      };
      if (b.state === '建造中') {
        const prev = inProgressBuildingNames.get(b.name) ?? 0;
        inProgressBuildingNames.set(b.name, Math.max(prev, b.progress ?? 0));
        underConstructionEntries.push(instance);
      } else {
        builtEntries.push({
          building: b,
          baseIndex,
          baseId: resolvedBaseId,
          baseName: base.name,
          buildingIndex,
          instance,
        });
      }
    }
  }

  // 汇总 queues 中的建造在途项
  const targetBaseIds = new Set(targetBases.map(b => b.id));
  const targetBaseNames = new Set(targetBases.map(b => b.name));
  const activeBuildQueues: QueueItem[] = (snapshot?.queues ?? []).filter(q => {
    if (q.type !== '建造') return false;
    if (q.status !== 'active' && q.status !== 'queued' && q.status !== 'settling') return false;
    if (scope === 'global' || !q.base) return true;
    return targetBaseIds.has(q.base) || targetBaseNames.has(q.base);
  });
  for (let qIdx = 0; qIdx < activeBuildQueues.length; qIdx += 1) {
    const q = activeBuildQueues[qIdx]!;
    const prev = inProgressBuildingNames.get(q.item) ?? 0;
    inProgressBuildingNames.set(q.item, Math.max(prev, q.progress ?? 0));
    const matchedBaseEntry =
      targetBasesWithIndex.find(x => x.base.id === q.base || x.base.name === q.base) ??
      targetBasesWithIndex[0];
    const hasExplicitUnderConst = underConstructionEntries.some(
      u => canon(u.name) === canon(q.item) && (!matchedBaseEntry || u.baseIndex === matchedBaseEntry.baseIndex),
    );
    if (!hasExplicitUnderConst && matchedBaseEntry) {
      const qBaseId = matchedBaseEntry.base.id || matchedBaseEntry.base.name;
      const existingSameNameCount =
        builtEntries.filter(
          e => e.baseIndex === matchedBaseEntry.baseIndex && canon(e.building.name) === canon(q.item),
        ).length +
        underConstructionEntries.filter(
          u => u.baseIndex === matchedBaseEntry.baseIndex && canon(u.name) === canon(q.item),
        ).length;
      const qCoord = (q as { coord?: { x: number; y: number } }).coord;
      const qBearing = (q as { bearing?: string }).bearing;
      const qLayer = (q as { layer?: string }).layer || '地面';
      const spatial = resolveBuildingRelativeCoord(
        { name: q.item, coord: qCoord, bearing: qBearing },
        100 + qIdx,
        qBaseId,
      );
      const { powerGen: qGen, powerUse: qUse } = resolveSingleBuildingPower(q.item);
      underConstructionEntries.push({
        baseIndex: matchedBaseEntry.baseIndex,
        baseId: qBaseId,
        baseName: matchedBaseEntry.base.name,
        buildingIndex: -1,
        name: q.item,
        instanceOrdinal: existingSameNameCount + 1,
        state: '建造中',
        mode: '生产',
        accelScope: 'global',
        layer: qLayer,
        dualModeCapable: isDualModeBuildingName(q.item),
        coord: spatial.coord,
        bearing: qBearing || spatial.bearingLabel,
        ring: spatial.ring,
        ringLabel: spatial.ringLabel,
        bearingLabel: spatial.bearingLabel,
        progress: q.progress ?? 0,
        eta: (q as { eta?: string }).eta,
        addons: [],
        powerGen: qGen,
        powerUse: qUse,
      });
    }
  }

  // 计算当前可解锁建造集合（铁律：必须基地内已有运转中的对应阵营建造厂核心/MCV展开，各阵营可建造建筑严格分开计算！）
  const unlockedNames = new Set<string>();
  const basesForPrereq = scope === 'global' ? targetBases : currentBase ? [currentBase] : [];
  const rawPrimary = (snapshot?.command as { primary_faction?: string } | undefined)?.primary_faction ?? '';
  const fallbackConyardFaction: 'allied' | 'soviet' | 'yuri' | (string & {}) =
    /yuri|epsilon|尤里|心灵|厄普西隆/i.test(rawPrimary)
      ? 'yuri'
      : /soviet|sov|苏联|苏军|苏维埃/i.test(rawPrimary)
        ? 'soviet'
        : 'allied';
  const normalizedFilter = normalizeBuildingFactionFilter(factionFilter);

  const operationalConyardFactions = new Set<string>();
  for (const base of basesForPrereq) {
    for (const fac of resolveBaseOperationalConyardFactions(base, fallbackConyardFaction)) {
      operationalConyardFactions.add(fac);
    }
  }
  const debugBypass = isDebugBypassPrerequisitesActive();
  const hasAnyConyard = debugBypass || operationalConyardFactions.size > 0;
  const hasConyardForFaction = (fac: string): boolean => {
    if (debugBypass) return true;
    if (!fac || fac === 'all' || fac === 'common') return hasAnyConyard;
    return operationalConyardFactions.has(fac);
  };
  const hasOperationalConyard = hasConyardForFaction(normalizedFilter);

  if (debugBypass) {
    for (const b of catalogBuildings) {
      unlockedNames.add(b.name);
      unlockedNames.add(stripFactionBuildingPrefix(b.name));
    }
    for (const spec of BLUEPRINT_NODES) {
      unlockedNames.add(spec.name);
      for (const a of spec.aliases ?? []) unlockedNames.add(a);
    }
  }

  for (const base of basesForPrereq) {
    const baseConyardFactions = resolveBaseOperationalConyardFactions(base, fallbackConyardFaction);
    if (baseConyardFactions.size === 0) continue;
    if (normalizedFilter !== 'all' && normalizedFilter !== 'common' && !baseConyardFactions.has(normalizedFilter)) {
      continue;
    }
    const ctx = buildCatalogPrerequisiteContext({
      bases: allBases,
      selectedBaseId: base.id,
      techDone: snapshot?.tech?.done ?? [],
      forces: (snapshot?.forces ?? { troops: {}, vehicles: [], girls: [] }) as unknown as import('../../红警指挥系统/core/catalogRuntimeContext').RuntimeForcesLike,
      protocols: snapshot?.protocols,
    });
    if (ctx) {
      for (const b of deriveBuildableWithContext(catalogBuildings, ctx, [])) {
        if (b.id === 'bld.common.construction_yard_core' || CONYARD_ORIGIN_NAMES.has(b.name.trim())) {
          continue;
        }
        const bFaction = inferBuildingFaction({ id: b.id, name: b.name, faction: b.faction, tags: b.tags });
        if (bFaction !== 'common' && !baseConyardFactions.has(bFaction)) continue;
        unlockedNames.add(b.name);
        if (bFaction === 'common') {
          unlockedNames.add(stripFactionBuildingPrefix(b.name));
        }
      }
    }
  }

  // 归集全部实际已建设施清单（含未在蓝图节点中的长尾建筑）
  const facilityMap = new Map<string, BuiltFacilitySummary>();
  for (const { building, baseName, instance } of builtEntries) {
    const key = building.name;
    let item = facilityMap.get(key);
    if (!item) {
      const catDef = catalogByCanonName.get(canon(key));
      const matchedSpec = BLUEPRINT_NODES.find(spec => matchesNodeSpec(key, spec));
      const sys = matchedSpec?.system ?? classifyBuildingSystem({ name: key, desc: catDef?.desc, tags: catDef?.tags });
      item = {
        name: key,
        system: sys,
        dualModeCapable: Boolean(matchedSpec?.dualModeCapable) || isDualModeBuildingName(key),
        count: 0,
        runningCount: 0,
        offlineCount: 0,
        productionModeCount: 0,
        accelModeCount: 0,
        layers: [],
        baseNames: [],
        instances: [],
      };
      facilityMap.set(key, item);
    }
    item.count += 1;
    if (building.state === '运转') item.runningCount += 1;
    else item.offlineCount += 1;
    if (building.mode === '加速') item.accelModeCount += 1;
    else item.productionModeCount += 1;
    if (building.layer && !item.layers.includes(building.layer)) item.layers.push(building.layer);
    if (baseName && !item.baseNames.includes(baseName)) item.baseNames.push(baseName);
    item.instances.push(instance);
  }

  // FD-22：在 facilityMap 循环外一次性构建 candidateSpecs 与 facilityKeysByCanon 索引
  const absorbedAddonKeys = new Set<string>();
  if (facilityMap.size > 0) {
    const facilityKeysByCanon = new Map<string, string[]>();
    for (const k of facilityMap.keys()) {
      const ck = canon(k);
      const list = facilityKeysByCanon.get(ck);
      if (list) list.push(k);
      else facilityKeysByCanon.set(ck, [k]);
    }

    const candidateSpecs = new Map<
      string,
      {
        name: string;
        displayName: string;
        nameCanon: string;
        displayNameCanon: string;
        mode: 'replace' | 'addon';
        standalone: boolean;
        hostBuildings: readonly string[];
        hostCanonList: readonly string[];
        cost: number;
        research?: string;
      }
    >();

    for (const [specName, spec] of Object.entries(BUILTIN_BUILDING_UPGRADE_SPECS)) {
      // 跳过 upgraded_name 别名镜像行（避免同一升阶包出现两条）
      if (spec.upgraded_name && specName === spec.upgraded_name) continue;
      const catEntry = catalogByCanonName.get(canon(specName));
      const rawCost = catEntry?.cost ?? (spec.upgrade_mode === 'addon' ? 1200 : 1800);
      const displayName = spec.upgraded_name || specName;
      const hostCanonList: string[] = [];
      for (const h of spec.host_building) {
        hostCanonList.push(canon(h), canon(stripFactionBuildingPrefix(h)));
      }
      candidateSpecs.set(specName, {
        name: specName,
        displayName,
        nameCanon: canon(specName),
        displayNameCanon: canon(displayName),
        mode: spec.upgrade_mode,
        standalone: catEntry?.standalone ?? (spec.upgraded_name ? false : spec.upgrade_mode === 'replace'),
        hostBuildings: spec.host_building,
        hostCanonList,
        cost: rawCost,
        research: catEntry?.research,
      });
    }

    for (const cb of catalogBuildings) {
      if (!cb.upgrade_mode || !cb.host_building) continue;
      const hosts = typeof cb.host_building === 'string' ? [cb.host_building] : cb.host_building;
      const displayName = cb.upgraded_name || cb.name;
      const hostCanonList: string[] = [];
      for (const h of hosts) {
        hostCanonList.push(canon(h), canon(stripFactionBuildingPrefix(h)));
      }
      candidateSpecs.set(cb.name, {
        name: cb.name,
        displayName,
        nameCanon: canon(cb.name),
        displayNameCanon: canon(displayName),
        mode: cb.upgrade_mode,
        standalone: cb.standalone ?? true,
        hostBuildings: hosts,
        hostCanonList,
        cost: cb.cost ?? 0,
        research: cb.research,
      });
    }

    for (const fac of facilityMap.values()) {
      const cFac = canon(fac.name);
      const cFacStripped = canon(stripFactionBuildingPrefix(fac.name));
      const hostCatDef = catalogByCanonName.get(cFac) ?? catalogByStrippedCanonName.get(cFacStripped);
      const hostCost = hostCatDef?.cost ?? 0;

      const upgradeOptions: FacilityUpgradeOption[] = [];
      const addonOptions: FacilityUpgradeOption[] = [];
      const mountedAddons: string[] = [];
      const pushMountedAddon = (addonName: string) => {
        const trimmed = addonName.trim();
        if (trimmed && !mountedAddons.includes(trimmed)) {
          mountedAddons.push(trimmed);
        }
      };

      const matchedUnderConst = underConstructionEntries.filter(u => canon(u.name) === cFac);
      fac.allInstances = [...fac.instances, ...matchedUnderConst];
      fac.buildingCount = matchedUnderConst.length;
      fac.damagedCount = fac.instances.filter(i => i.state === '受损').length;
      fac.stoppedCount = fac.instances.filter(i => i.state === '停机').length;
      fac.totalPowerGen = fac.instances.reduce((s, i) => s + (i.powerGen ?? 0), 0);
      fac.totalPowerUse = fac.instances.reduce((s, i) => s + (i.powerUse ?? 0), 0);
      for (const inst of fac.allInstances) {
        for (const ad of inst.addons ?? []) {
          pushMountedAddon(ad);
        }
      }

      for (const spec of candidateSpecs.values()) {
        const matchesHost = spec.hostCanonList.some(hc => hc === cFac || hc === cFacStripped);
        if (!matchesHost) continue;

        const inQueue =
          inProgressBuildingNames.has(spec.name) || inProgressBuildingNames.has(spec.displayName);
        const matchedKeysByName = facilityKeysByCanon.get(spec.nameCanon);
        const matchedKeysByDisplay =
          spec.displayNameCanon !== spec.nameCanon
            ? facilityKeysByCanon.get(spec.displayNameCanon)
            : undefined;
        const isMountedInInstances = fac.allInstances.some(inst =>
          (inst.addons ?? []).some(
            ad => canon(ad) === spec.nameCanon || canon(ad) === spec.displayNameCanon,
          ),
        );
        const isMounted =
          isMountedInInstances ||
          facilityMap.has(spec.name) ||
          facilityMap.has(spec.displayName) ||
          Boolean(matchedKeysByName && matchedKeysByName.length > 0) ||
          Boolean(matchedKeysByDisplay && matchedKeysByDisplay.length > 0);
        const isUnlocked =
          unlockedNames.has(spec.name) ||
          unlockedNames.has(spec.displayName) ||
          unlockedNames.has(stripFactionBuildingPrefix(spec.name));

        // standalone: true 的跨代高阶替换建筑使用补差价 max(0, target.cost - host.cost)；纯升级包本身已是差价
        const deltaCost =
          spec.mode === 'replace' && spec.standalone
            ? Math.max(0, spec.cost - hostCost)
            : spec.cost;

        const opt: FacilityUpgradeOption = {
          name: spec.name,
          displayName: spec.displayName,
          mode: spec.mode,
          standalone: spec.standalone,
          cost: spec.cost,
          deltaCost,
          isUnlocked,
          inQueue,
          isMounted,
          research: spec.research,
        };

        if (spec.mode === 'replace') {
          upgradeOptions.push(opt);
        } else {
          addonOptions.push(opt);
          if (isMounted) {
            pushMountedAddon(spec.displayName);
            if (matchedKeysByName) {
              for (const k of matchedKeysByName) absorbedAddonKeys.add(k);
            }
            if (matchedKeysByDisplay) {
              for (const k of matchedKeysByDisplay) absorbedAddonKeys.add(k);
            }
          }
        }
      }

      if (mountedAddons.length > 0) fac.mountedAddons = mountedAddons;
      if (upgradeOptions.length > 0) fac.upgradeOptions = upgradeOptions;
      if (addonOptions.length > 0) fac.addonOptions = addonOptions;
    }
  }

  const allBuiltFacilities = Array.from(facilityMap.values())
    .filter(f => !absorbedAddonKeys.has(f.name))
    .sort((a, b) => b.count - a.count);

  // 构造全部蓝图节点四态
  const evaluatedNodes: BuildingBlueprintNode[] = BLUEPRINT_NODES.map(spec => {
    const specFaction = spec.faction ?? 'common';
    const matchedEntries = builtEntries.filter(e => {
      if (!matchesNodeSpec(e.building.name, spec)) return false;
      const bName = e.building.name.trim();
      if (spec.isOriginConyard) {
        const cyFac = inferConyardFaction(bName, fallbackConyardFaction);
        if (normalizedFilter !== 'all' && normalizedFilter !== 'common' && cyFac !== normalizedFilter) {
          return false;
        }
        return true;
      }
      const builtFac = inferBuildingFaction({ name: bName });
      if (
        normalizedFilter !== 'all' &&
        normalizedFilter !== 'common' &&
        builtFac !== 'common' &&
        builtFac !== normalizedFilter
      ) {
        return false;
      }
      if (specFaction !== 'common' && builtFac !== 'common' && builtFac !== specFaction) {
        // 特例：若该节点配置了对应阵营变体（如 rs_chrono 配了 yuri 基因突变器），允许该变体命中
        if (!spec.factionVariants?.[builtFac]) return false;
      }
      return true;
    });
    const builtCount = matchedEntries.length;
    const runningCount = matchedEntries.filter(e => e.building.state === '运转').length;
    const offlineCount = builtCount - runningCount;
    const accelModeCount = matchedEntries.filter(e => e.building.mode === '加速').length;
    const productionModeCount = builtCount - accelModeCount;
    const matchedNames = Array.from(new Set(matchedEntries.map(e => e.building.name)));
    const instances = matchedEntries.map(e => e.instance);

    // 动态适配阵营显示名称与阵营徽标
    let displayName = spec.name;
    let displayShortLabel = spec.shortLabel ?? spec.name;
    if (spec.factionVariants) {
      const variantForFilter =
        normalizedFilter !== 'all' && normalizedFilter !== 'common'
          ? spec.factionVariants[normalizedFilter]
          : undefined;
      if (variantForFilter) {
        displayName = variantForFilter.name;
        displayShortLabel = variantForFilter.shortLabel ?? variantForFilter.name;
      } else if (matchedNames.length === 1) {
        const onlyBuilt = matchedNames[0]!;
        const builtFac = spec.isOriginConyard
          ? inferConyardFaction(onlyBuilt, fallbackConyardFaction)
          : inferBuildingFaction({ name: onlyBuilt });
        const matchedVariant = builtFac !== 'common' ? spec.factionVariants[builtFac] : undefined;
        if (matchedVariant) {
          displayName = matchedVariant.name;
          displayShortLabel = matchedVariant.shortLabel ?? matchedVariant.name;
        }
      }
    }

    const effectiveNodeFaction =
      normalizedFilter !== 'all' &&
      normalizedFilter !== 'common' &&
      spec.factionVariants?.[normalizedFilter]
        ? normalizedFilter
        : specFaction;

    const factionBadge: BuildingBlueprintNode['factionBadge'] =
      effectiveNodeFaction === 'soviet'
        ? '苏'
        : effectiveNodeFaction === 'allied'
          ? '盟'
          : effectiveNodeFaction === 'yuri'
            ? '尤'
            : spec.factionVariants
              ? spec.factionVariants.yuri
                ? '盟/苏/尤'
                : '盟/苏'
              : undefined;
    const dimmedByFaction =
      normalizedFilter !== 'all' &&
      normalizedFilter !== 'common' &&
      effectiveNodeFaction !== 'common' &&
      effectiveNodeFaction !== normalizedFilter;

    // 检查是否有在建队列
    let buildingProgress: number | undefined;
    for (const [qName, prog] of inProgressBuildingNames.entries()) {
      if (matchesNodeSpec(qName, spec)) {
        buildingProgress = Math.max(buildingProgress ?? 0, prog);
      }
    }

    // 查找 catalog 定义以获取前置提示
    const catDef = catalogBuildings.find(cb => matchesNodeSpec(cb.name, spec));
    const prereqHint =
      catDef?.research
        ? `需科技：${catDef.research}`
        : catDef?.need_building
          ? `需建筑：${catDef.need_building}`
          : (spec.defaultPrereqHint ?? '基础可建');

    const nodeRequiredFaction: string =
      normalizedFilter !== 'all' && normalizedFilter !== 'common'
        ? normalizedFilter
        : effectiveNodeFaction !== 'common'
          ? effectiveNodeFaction
          : 'common';
    const nodeHasRequiredConyard = hasConyardForFaction(nodeRequiredFaction);
    const requiredConyardLabel =
      nodeRequiredFaction === 'soviet'
        ? '苏联建造厂 (MCV)'
        : nodeRequiredFaction === 'allied'
          ? '盟军建造厂 (MCV)'
          : nodeRequiredFaction === 'yuri'
            ? '尤里建造厂 (MCV)'
            : '建造厂核心 (MCV)';

    const isUnlocked =
      !spec.isOriginConyard &&
      nodeHasRequiredConyard &&
      (unlockedNames.has(spec.name) ||
        (spec.aliases ?? []).some(a => unlockedNames.has(a)) ||
        (catDef ? unlockedNames.has(catDef.name) : false));

    let state: BuildingNodeState = 'locked';
    let statusText = '未解锁';
    let hint = prereqHint;

    if (spec.isOriginConyard) {
      if (builtCount > 0) {
        state = 'built';
        if (accelModeCount > 0) {
          statusText = `已展开×${builtCount}（产${productionModeCount}/加${accelModeCount}）`;
        } else if (offlineCount > 0) {
          statusText = `已展开×${builtCount}（运转${runningCount}/停损${offlineCount}）`;
        } else {
          statusText = `已展开×${builtCount} · 运转`;
        }
        hint = '基地建造中枢已展开，支持生产/加速双模切换';
      } else if (buildingProgress !== undefined) {
        state = 'building';
        statusText = `展开中 ${Math.round(buildingProgress)}%`;
        hint = 'MCV 正在展开为建造厂核心';
      } else {
        state = 'locked';
        statusText = '未展开';
        hint =
          normalizedFilter === 'soviet'
            ? '需在当前基地就地展开苏联 MCV（移动基地车）'
            : normalizedFilter === 'allied'
              ? '需在当前基地就地展开盟军 MCV（移动基地车）'
              : normalizedFilter === 'yuri'
                ? '需在当前基地就地展开尤里 MCV（移动基地车）'
                : '需在当前基地就地展开 MCV（移动基地车）';
      }
    } else if (builtCount > 0) {
      state = 'built';
      if (accelModeCount > 0) {
        statusText = `已建×${builtCount}（产${productionModeCount}/加${accelModeCount}）`;
      } else if (offlineCount > 0) {
        statusText = `已建×${builtCount}（运转${runningCount}/停损${offlineCount}）`;
      } else {
        statusText = `已建×${builtCount} · 运转`;
      }
      hint = buildingProgress !== undefined ? `扩建中 ${Math.round(buildingProgress)}%` : '点击查阅设施详情或切换模式';
    } else if (buildingProgress !== undefined) {
      state = 'building';
      statusText = `建造中 ${Math.round(buildingProgress)}%`;
      hint = '工程队列推进中';
    } else if (!nodeHasRequiredConyard) {
      state = 'locked';
      statusText = '未解锁';
      hint = `需先展开${requiredConyardLabel}｜${prereqHint}`;
    } else if (isUnlocked) {
      state = 'unlocked';
      statusText = '可建造';
      hint = '已满足前置，点击查阅并下达建造令';
    }

    return {
      ...spec,
      displayName,
      displayShortLabel,
      factionBadge,
      dimmedByFaction,
      state,
      builtCount,
      runningCount,
      offlineCount,
      switchingCount: 0,
      productionModeCount,
      accelModeCount,
      buildingProgress,
      statusText,
      hint,
      matchedNames,
      instances,
      clusterItems: [],
    };
  });

  // 构建全量世界书建筑目录图鉴（直接消费世界书 <数据> 块 system / system_group / faction，兜底走纯函数分类器）
  const allCatalogEntries: SystemCatalogEntry[] = catalogBuildings
    .filter(cb => {
      const fac = inferBuildingFaction(cb);
      if (normalizedFilter !== 'all' && normalizedFilter !== 'common') {
        if (fac !== 'common' && fac !== normalizedFilter) return false;
      }
      return true;
    })
    .map(cb => {
      const bId = cb.id || cb.name;
      const isConyard =
        bId === 'bld.common.construction_yard_core' ||
        bId === 'bld.yuri.construction_yard_core' ||
        CONYARD_ORIGIN_NAMES.has(cb.name.trim());
      const matchedSpec = BLUEPRINT_NODE_BY_EXACT_NAME.get(cb.name);
      const rawSys = (cb.system as string | undefined) === 'agriculture' ? 'agro' : cb.system;
      const sys: BuildingSystemId = isConyard
        ? 'military'
        : ((rawSys as BuildingSystemId | undefined) ??
          matchedSpec?.system ??
          classifyBuildingSystem({ name: cb.name, tags: cb.tags, system: cb.system }));
      const faction = inferBuildingFaction({ id: bId, name: cb.name, faction: cb.faction, tags: cb.tags });
      const subGroup = inferSystemSubGroup(sys, cb.name, cb.system_group);
      const cbCanon = canon(cb.name);
      const builtCount = builtEntries.filter(e => {
        const eName = e.building.name.trim();
        if (isConyard) {
          if (!CONYARD_ORIGIN_NAMES.has(eName) && !/建造厂|心灵前哨/.test(eName)) return false;
          const cyFac = inferConyardFaction(eName, fallbackConyardFaction);
          if (faction !== 'common') return cyFac === faction;
          if (normalizedFilter !== 'all' && normalizedFilter !== 'common') return cyFac === normalizedFilter;
          return true;
        }
        return canon(eName) === cbCanon;
      }).length;
      const inProg = inProgressBuildingNames.get(cb.name);
      const entryRequiredFaction =
        faction !== 'common'
          ? faction
          : normalizedFilter !== 'all' && normalizedFilter !== 'common'
            ? normalizedFilter
            : 'common';
      const entryHasRequiredConyard = hasConyardForFaction(entryRequiredFaction);
      const isUnlocked = !isConyard && entryHasRequiredConyard && unlockedNames.has(cb.name);

      let state: BuildingNodeState = 'locked';
      let statusText = '未解锁';
      if (isConyard) {
        state = builtCount > 0 ? 'built' : 'locked';
        statusText = builtCount > 0 ? `已展开×${builtCount}` : '未展开';
      } else if (builtCount > 0) {
        state = 'built';
        statusText = `已建×${builtCount}`;
      } else if (inProg !== undefined) {
        state = 'building';
        statusText = `建造中 ${Math.round(inProg)}%`;
      } else if (isUnlocked) {
        state = 'unlocked';
        statusText = '可建造';
      }

      const prereqParts: string[] = [];
      const rawNeedBldText =
        cb.need_building ||
        (Array.isArray((cb as { need_buildings?: string[] }).need_buildings)
          ? (cb as { need_buildings?: string[] }).need_buildings!.filter(Boolean).join('+')
          : '');
      const needBldText = rawNeedBldText
        ? rawNeedBldText
            .split('+')
            .map(s => normalizeActionBuildingName(s))
            .join('+')
        : '';
      const researchText =
        cb.research ||
        (Array.isArray((cb as { prereqs?: string[] }).prereqs)
          ? (cb as { prereqs?: string[] }).prereqs!.filter(Boolean).join('+')
          : '');
      if (needBldText) prereqParts.push(`需建筑:${needBldText}`);
      if (researchText) prereqParts.push(`需科技:${researchText}`);
      const mcvLabel =
        entryRequiredFaction === 'soviet'
          ? '苏联MCV'
          : entryRequiredFaction === 'allied'
            ? '盟军MCV'
            : entryRequiredFaction === 'yuri'
              ? '尤里MCV'
              : 'MCV';
      const prereqText = !entryHasRequiredConyard && !isConyard
        ? `需先展开${mcvLabel}${prereqParts.length ? ` · ${prereqParts.join(' / ')}` : ''}`
        : prereqParts.length > 0
          ? prereqParts.join(' · ')
          : isConyard
            ? `由${mcvLabel}就地展开`
            : '基础可建';

      return {
        id: bId,
        name: normalizeActionBuildingName(cb.name),
        system: sys,
        faction,
        subGroup,
        state,
        builtCount,
        statusText,
        cost: cb.cost ?? 0,
        power: cb.power ?? 0,
        prereqText,
      };
    });

  // 将全部世界书建筑条目精确挂载到所属 SVG 蓝图节点的 clusterItems 聚合簇上（支持点选节点一键展开子建筑）
  const nodeById = new Map<string, BuildingBlueprintNode>(evaluatedNodes.map(n => [n.id, n]));
  for (const entry of allCatalogEntries) {
    const sysSpecs = BLUEPRINT_NODES_BY_SYSTEM.get(entry.system) ?? [];
    const targetNodeId = resolveBlueprintNodeIdForCatalogEntry(entry, sysSpecs);
    const targetNode = nodeById.get(targetNodeId);
    if (targetNode) {
      targetNode.clusterItems.push(entry);
    }
  }
  // 将每个节点的主显示建筑排在 clusterItems 首位
  for (const node of evaluatedNodes) {
    node.clusterItems.sort((a, b) => {
      const aPrimary = a.name === node.displayName || a.name === node.name ? 0 : 1;
      const bPrimary = b.name === node.displayName || b.name === node.name ? 0 : 1;
      if (aPrimary !== bPrimary) return aPrimary - bPrimary;
      if (a.builtCount !== b.builtCount) return b.builtCount - a.builtCount;
      return a.cost - b.cost;
    });
  }

  // 按五大体系分装视图与能力指标
  const systems = {} as Record<BuildingSystemId, BuildingSystemView>;
  for (const tab of BUILDING_SYSTEM_TABS) {
    const sysNodes = evaluatedNodes.filter(n => n.system === tab.id);
    const sysEdges = BLUEPRINT_EDGES.filter(e => e.system === tab.id);
    const sysBuiltList = allBuiltFacilities.filter(f => f.system === tab.id);
    const sysCatalogEntries = allCatalogEntries.filter(c => c.system === tab.id);
    const builtNodeCount = sysNodes.filter(n => n.state === 'built').length;

    const metrics = buildMetricsForSystem(tab.id, sysNodes, sysBuiltList, {
      powerGen,
      powerUse,
      techDoneCount: snapshot?.tech?.done?.length ?? 0,
    });

    systems[tab.id] = {
      id: tab.id,
      meta: tab,
      nodes: sysNodes,
      edges: sysEdges,
      metrics,
      builtList: sysBuiltList,
      catalogEntries: sysCatalogEntries,
      builtNodeCount,
      totalNodeCount: sysNodes.length,
    };
  }

  const allInstances: BuiltBuildingInstanceRef[] = [
    ...builtEntries.map(e => e.instance),
    ...underConstructionEntries,
  ];
  const conyardHubs = allInstances
    .filter(inst => isConyardBuildingName(inst.name))
    .map(inst => {
      const fac = inferConyardFaction(inst.name, fallbackConyardFaction);
      const factionLabel =
        fac === 'soviet'
          ? '苏联'
          : fac === 'yuri'
            ? '尤里'
            : fac === 'allied'
              ? '盟军'
              : fac === 'rising_sun'
                ? '升阳'
                : fac === 'foehn'
                  ? '焚风'
                  : '通用';
      return {
        name: inst.name,
        faction: fac,
        factionLabel,
        state: inst.state,
        mode: inst.mode,
        layer: inst.layer || '地面',
        powerGen: inst.powerGen ?? 50,
      };
    });

  const ringCounts = { core: 0, inner: 0, mid: 0, outer: 0 };
  const blips: LiveSandboxBlip[] = allInstances.map((inst, idx) => {
    const ring = inst.ring ?? 'mid';
    ringCounts[ring] += 1;
    const coord = inst.coord ?? { x: 0, y: 0 };
    const leftPct = Math.max(6, Math.min(94, Number((50 + coord.x * 4.2).toFixed(1))));
    const topPct = Math.max(6, Math.min(94, Number((50 - coord.y * 4.2).toFixed(1))));
    const color =
      inst.state === '运转'
        ? '#4ade80'
        : inst.state === '建造中'
          ? '#fbbf24'
          : inst.state === '受损'
            ? '#f87171'
            : '#94a3b8';
    const ringLabel = inst.ringLabel ?? '中环';
    const bearingLabel = inst.bearingLabel ?? 'MCV原点 (0,0)';
    const ord = inst.instanceOrdinal ?? 1;
    return {
      key: `${inst.baseId}-${inst.buildingIndex}-${inst.name}-${ord}-${idx}`,
      instance: inst,
      system: classifyBuildingSystem({ name: inst.name }),
      leftPct,
      topPct,
      color,
      ring,
      ringLabel,
      bearingLabel,
      titleText: `${inst.name} #${ord} · ${inst.layer || '地面'} · ${ringLabel} ${bearingLabel} · ${inst.state}`,
    };
  });

  const normLayer = (raw?: string): string => {
    const t = (raw ?? '').trim();
    return !t || t === '地面' ? '地面层' : t;
  };

  const sectors: LiveSectorCardModel[] = [];
  for (const base of targetBases) {
    const rawSectors = (base as Base & { sectors?: unknown[] }).sectors;
    if (!Array.isArray(rawSectors)) continue;
    for (const item of rawSectors) {
      let name = '';
      let layer = '';
      let status = '正常';
      let desc = '';
      if (typeof item === 'string') {
        name = item.trim();
      } else if (item && typeof item === 'object') {
        const rec = item as Record<string, unknown>;
        name = String(rec.name ?? '').trim();
        layer = String(rec.layer ?? '').trim();
        status = String(rec.status ?? '正常').trim() || '正常';
        desc = String(rec.desc ?? '').trim();
      }
      if (!name) continue;
      const statusTone: LiveSectorCardModel['statusTone'] = /受损|危险|失陷|被毁|沦陷|告警/.test(status)
        ? 'danger'
        : /警戒|施工|建设|抢修|改造/.test(status)
          ? 'warn'
          : /强化|特级|核心/.test(status)
            ? 'accent'
            : 'ok';
      const normalizedSecLayer = normLayer(layer);
      const coLocatedBuildings = Array.from(
        new Set(allInstances.filter(i => normLayer(i.layer) === normalizedSecLayer).map(i => i.name)),
      );
      sectors.push({
        name,
        layer: layer || '地面层',
        status,
        statusTone,
        desc,
        coLocatedBuildings,
      });
    }
  }

  const availableLayersSet = new Set<string>();
  for (const sec of sectors) availableLayersSet.add(normLayer(sec.layer));
  for (const inst of allInstances) availableLayersSet.add(normLayer(inst.layer));
  const availableLayers = Array.from(availableLayersSet);
  const layerGroups: LiveLayerGroupModel[] = availableLayers.map(layerName => {
    const grpSectors = sectors.filter(s => normLayer(s.layer) === layerName);
    const grpInstances = allInstances.filter(i => normLayer(i.layer) === layerName);
    return {
      layerName,
      sectors: grpSectors,
      instances: grpInstances,
      runningCount: grpInstances.filter(i => i.state === '运转').length,
      buildingCount: grpInstances.filter(i => i.state === '建造中').length,
    };
  });

  const generators: PowerLedgerItem[] = [];
  const consumers: PowerLedgerItem[] = [];
  for (const { instance } of builtEntries) {
    const ord = instance.instanceOrdinal ?? 1;
    const item: PowerLedgerItem = {
      key: `${instance.baseId}-${instance.buildingIndex}-${instance.name}-${ord}`,
      name: instance.name,
      instanceLabel: `${instance.name} #${ord}`,
      baseName: instance.baseName,
      layer: instance.layer || '地面',
      state: instance.state,
      gen: instance.powerGen ?? 0,
      use: instance.powerUse ?? 0,
      addons: instance.addons ?? [],
    };
    if (item.gen > 0) generators.push(item);
    if (item.use > 0) consumers.push(item);
  }
  generators.sort((a, b) => b.gen - a.gen);
  consumers.sort((a, b) => b.use - a.use);
  const totalCatalogGen = generators.reduce((s, g) => s + g.gen, 0);
  const totalCatalogUse = consumers.reduce((s, c) => s + c.use, 0);

  const liveSandbox: LiveBaseSandboxModel = {
    conyardHubs,
    blips,
    ringCounts,
    layerGroups,
    availableLayers,
    sectors,
    powerLedger: {
      generators,
      consumers,
      totalCatalogGen,
      totalCatalogUse,
      reportedGen: powerGen,
      reportedUse: powerUse,
      net: powerGen - powerUse,
    },
    allInstances,
    underConstructionInstances: underConstructionEntries,
  };

  return {
    scope,
    factionFilter,
    availableFactions: resolveAvailableBuildingFactions(
      snapshot as unknown as Parameters<typeof resolveAvailableBuildingFactions>[0],
      catalog as unknown as Parameters<typeof resolveAvailableBuildingFactions>[1],
    ),
    hasOperationalConyard,
    activeBaseIndex,
    activeBaseName,
    totalBuiltCount: builtEntries.length,
    totalRunningCount: builtEntries.filter(e => e.building.state === '运转').length,
    totalBuildingQueueCount: inProgressBuildingNames.size,
    powerSummary: { gen: powerGen, use: powerUse, net: powerGen - powerUse },
    systems,
    allBuiltFacilities,
    liveSandbox,
  };
}
