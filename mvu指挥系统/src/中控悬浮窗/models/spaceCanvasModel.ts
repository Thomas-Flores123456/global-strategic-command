/**
 * spaceCanvasModel.ts —— 天基三域交互式节点画布核心纯函数评估引擎（PKG-A · FD-25）
 *
 * 职责：
 * 1. 全量重导出 spaceCanvasRegistry.ts 中的类型、常量与开放式扩展注册表 API；
 * 2. 从 MVU 快照（ProjectV2.modules[] 与 space.orbital_assets[]）零破坏派生画布初始草稿（deriveInitialCanvasDraft）；
 * 3. 执行拓扑父节点连通、Tier-2 扩展节点舱/管廊枢纽动态生长、月面无人探测车勘探门、
 *    ⚡电力收支与🫧维生热控双平衡账本、以及星座组网羁绊判定（evaluateSpaceCanvasView）；
 * 4. 生成指挥官视角总体蓝图规划指令（buildSpaceCanvasBlueprintOrderText）与单节点发射/建造联动载荷（buildSpaceCanvasNodeActionPayload）。
 */

import {
  isProjectV2,
  type OrbitalAsset,
  type Project,
  type ProjectModule,
  type Schema,
  type SpaceContract,
} from '../../红警指挥系统/core/schema';
import {
  SPACE_INTERFACE_TYPE_LABELS,
  getReadonlySpaceCanvasAssetById,
  getReadonlySpaceCanvasSlotById,
  getSpaceCanvasAssetById,
  getSpaceCanvasAssets,
  getSpaceCanvasDomain,
  getSpaceCanvasSlots,
  getSpaceCanvasSynergies,
  registerSpaceCanvasAssets,
  registerSpaceCanvasSlots,
  type SpaceCanvasAssetDef,
  type SpaceCanvasDomainDef,
  type SpaceCanvasDomainId,
  type SpaceCanvasSlotDef,
  type SpaceCanvasSynergyDef,
  type SpaceSlotInterfaceType,
  type SpaceSlotNodeState,
} from './spaceCanvasRegistry';

export * from './spaceCanvasRegistry';

/** 兼容完整 Schema 或局部快照输入 */
export type StatSnapshot = Partial<Schema> | Schema;

/** 节点状态中文标签 */
export const SPACE_NODE_STATE_LABELS: Record<SpaceSlotNodeState, string> = {
  completed: '已完工在轨',
  built: '已建成实体',
  building: '在建施工中',
  planned: '蓝图已规划',
  empty: '空闲待选配',
  locked: '前置未解锁',
};

/** 单个画布插槽节点的派生视图模型 */
export interface SpaceCanvasNodeView {
  /** 插槽唯一 ID（与 slotId 同值，方便模板直接绑定） */
  id: string;
  slotId: string;
  domain: SpaceCanvasDomainId;
  label: string;
  interfaceType: SpaceSlotInterfaceType;
  interfaceLabel: string;
  tier: 1 | 2 | 3;
  x: number;
  y: number;
  rotation: number;
  scale: number;
  parentSlotId?: string;
  unlockedBySlotId?: string;
  connectedTo: string[];
  isRootCore: boolean;
  requiresExpansionHub: boolean;
  requiresRoverSurvey: boolean;
  lockedCore: boolean;
  /** 原始插槽定义引用 */
  slot: SpaceCanvasSlotDef;
  /** 是否在当前画布视口中可见（Tier-1 恒可见；Tier-2/3 当枢纽槽挂载扩展枢纽或自身已挂载/建成构件时动态生长可见） */
  visible: boolean;
  /** 是否已满足拓扑父节点、扩展枢纽与探测车勘探前置 */
  unlocked: boolean;
  /** 是否处于锁定状态（!unlocked） */
  locked: boolean;
  /** 未解锁时的具体工程原因提示 */
  lockReason?: string;
  /** 节点状态机（completed / built / building / planned / empty / locked） */
  state: SpaceSlotNodeState;
  status: SpaceSlotNodeState;
  stateLabel: string;
  /** 是否为已建成/已完工实体 */
  built: boolean;
  isBuilt: boolean;
  /** 当前挂载的构件 ID（未挂载时为 undefined） */
  mountedAssetId?: string;
  assetId?: string;
  /** 当前挂载的构件定义（未挂载时为 undefined） */
  mountedAsset?: SpaceCanvasAssetDef;
  asset?: SpaceCanvasAssetDef;
  /** 当前插槽接口允许挂载的候选构件列表 */
  compatibleAssets: SpaceCanvasAssetDef[];
  allowedAssets: SpaceCanvasAssetDef[];
  /** 该节点是否可挂载扩展枢纽以生长下级 Tier-2/3 外延槽 */
  hubExpandablePreview: boolean;
  /** 以该插槽为父节点或解锁枢纽的下级外延插槽 ID 列表 */
  childSlotIds: string[];
  /** 当前挂载构件的前置科技是否已满足 */
  researchUnlocked: boolean;
  missingResearch?: string;
}

/** 拓扑父子节点之间的结构桁架/加压管廊连线视图 */
export interface SpaceCanvasConnectionView {
  id: string;
  fromSlotId: string;
  toSlotId: string;
  parentSlotId: string;
  childSlotId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  tier: 1 | 2 | 3;
  state: SpaceSlotNodeState;
  active: boolean;
  visible: boolean;
  isExpansionLink: boolean;
}

/** 组网/拼装羁绊评估视图项（兼容 SpaceCanvasSynergyDef 与 UI 激活态标记） */
export interface SpaceCanvasSynergyView extends SpaceCanvasSynergyDef {
  active: boolean;
  isActive: boolean;
  unlocked: boolean;
  requirementText: string;
}

/** 画布顶部 ⚡电力 / 🫧维生 / 💰造价 / 🔗羁绊 汇总账本 */
export interface SpaceCanvasLedgerSummary {
  totalPowerGenKw: number;
  totalPowerLoadKw: number;
  powerGenKw: number;
  powerLoadKw: number;
  netPowerKw: number;
  powerBalanced: boolean;
  powerDeficit: boolean;
  totalLifeGen: number;
  totalLifeLoad: number;
  lifeGen: number;
  lifeLoad: number;
  netLifeSupport: number;
  netLife: number;
  lifeBalanced: boolean;
  lifeDeficit: boolean;
  totalCostCredits: number;
  totalCredits: number;
  totalNanites: number;
  totalNanitesCost: number;
  totalMassTons: number;
  totalWorkloadDays: number;
  mountedCount: number;
  completedCount: number;
  builtCount: number;
  buildingCount: number;
  plannedCount: number;
  unlockedSlotCount: number;
  unlockedCount: number;
  totalSlotCount: number;
  tier2ExpandedCount: number;
  tier3ExpandedCount: number;
  expandedCount: number;
  roverSurveySatisfied: boolean;
  activeSynergies: SpaceCanvasSynergyDef[];
  allSynergies: SpaceCanvasSynergyDef[];
  synergies: SpaceCanvasSynergyView[];
  warnings: string[];
}

/** 画布整体评估输出 */
export interface SpaceCanvasEvalResult {
  domain: SpaceCanvasDomainId;
  domainDef: SpaceCanvasDomainDef;
  nodes: SpaceCanvasNodeView[];
  visibleNodes: SpaceCanvasNodeView[];
  connections: SpaceCanvasConnectionView[];
  visibleConnections: SpaceCanvasConnectionView[];
  slotAssetMap: Record<string, string>;
  ledger: SpaceCanvasLedgerSummary;
  synergies: SpaceCanvasSynergyView[];
}

/** 节点联动至发射合同拟定器的预填草稿载荷 */
export interface SpaceCanvasContractPreset {
  title: string;
  kind: SpaceContract['kind'] | (string & {});
  payload: string;
  rocket: string;
  base: string;
  orbitTarget: 'LEO' | 'SSO' | 'GEO' | 'TLI';
  rewardCredits: number;
  recoverBooster: boolean;
}

/** 单节点点击「发射/施工」产出的联动动作载荷 */
export interface SpaceCanvasNodeActionPayload {
  domain: SpaceCanvasDomainId;
  slotId: string;
  slotLabel: string;
  assetId: string;
  assetName: string;
  baseName: string;
  orderText: string;
  contractPreset?: SpaceCanvasContractPreset;
}

/** 月面外环矿脉原位资源利用前置科技名 */
export const LUNAR_ISRU_SURVEY_TECH = '月面原位资源利用工学';

// ═══════════════════════════════════════════════════════════════════════════
// 内部辅助：从 snapshot 提取已建成/在建状态与初始草稿映射
// ═══════════════════════════════════════════════════════════════════════════

interface SnapshotRuntimeSlotStatus {
  slotStateMap: Record<string, 'completed' | 'built' | 'building'>;
  derivedDraft: Record<string, string>;
}

/**
 * 将基地中的独立航天建筑名映射为发射中心拓扑插槽与对应构件资产（实现「基地独立设施 ⇄ 航天城插槽」双向映射）
 */
export function mapBaseBuildingToLaunchCenterSlots(
  buildingName: string,
): Array<{ slotId: string; assetId: string }> {
  const name = (buildingName ?? '').trim();
  if (!name) return [];

  if (name === '赤星轨道战略投送阵列' || name.includes('百米级') || name.includes('捕获发射塔')) {
    return [
      { slotId: 'lc_pad_1', assetId: 'asset.lc.pad_std' },
      { slotId: 'lc_hif', assetId: 'asset.lc.vab_vertical' },
      { slotId: 'lc_crawler_way', assetId: 'asset.lc.crawler_super_base' },
      { slotId: 'lc_pad_super', assetId: 'asset.lc.mechazilla_tower' },
    ];
  }
  if (name === '重型航天发射场' || name.includes('低温重型发射')) {
    return [
      { slotId: 'lc_pad_1', assetId: 'asset.lc.pad_std' },
      { slotId: 'lc_hif', assetId: 'asset.lc.vab_vertical' },
      { slotId: 'lc_pad_2', assetId: 'asset.lc.pad_cryo' },
    ];
  }
  if (name === '航天发射中心' || name === '商业航天发射工位' || name.includes('航天发射')) {
    return [{ slotId: 'lc_pad_1', assetId: 'asset.lc.pad_std' }];
  }
  if (name.includes('垂直总装') || name.toUpperCase().includes('VAB')) {
    return [{ slotId: 'lc_hif', assetId: 'asset.lc.vab_vertical' }];
  }
  if (name.includes('水平分段') || name.includes('水平总装')) {
    return [{ slotId: 'lc_hif', assetId: 'asset.lc.hif_horiz' }];
  }
  if (name.includes('火箭制造厂') || name.includes('地下洞库旋压')) {
    return [{ slotId: 'lc_underground_fab', assetId: 'asset.lc.rocket_mega_fab' }];
  }
  if (name.includes('卫星制造中心') || name.includes('卫星测控站') || name.includes('超净卫星')) {
    return [{ slotId: 'lc_telemetry_1', assetId: 'asset.lc.sat_mfg_center' }];
  }
  if (
    name.includes('大型航天器与舱段总装中心') ||
    name.includes('大型航天器与空间站舱段总装中心') ||
    name.includes('舱段总装中心')
  ) {
    return [{ slotId: 'lc_spacecraft_hall', assetId: 'asset.lc.spacecraft_ait_hall' }];
  }
  if (name.includes('深空测控网络') || name.includes('全天候防雷') || name.includes('激光引雷')) {
    return [{ slotId: 'lc_weather_tower', assetId: 'asset.lc.weather_laser_tower' }];
  }
  if (name.includes('深冷液氧甲烷') || name.includes('甲烷原位合成')) {
    return [{ slotId: 'lc_cryo_plant', assetId: 'asset.lc.cryo_methalox_plant' }];
  }
  if (name.includes('推进剂储罐') || name.includes('推进剂加注')) {
    return [{ slotId: 'lc_prop_yard', assetId: 'asset.lc.prop_depot' }];
  }
  if (name.includes('回收着陆坪') || name.includes('回收驳船') || name.includes('助推器回收')) {
    return [{ slotId: 'lc_recovery_zone', assetId: 'asset.lc.lz_recovery' }];
  }
  return [];
}

function matchStationModuleToSlotAndAsset(
  mod: ProjectModule,
  occupiedSlots: Set<string>,
): { slotId: string; assetId: string } | null {
  const idLower = (mod.id ?? '').trim().toLowerCase();
  const nameLower = (mod.name ?? '').trim().toLowerCase();
  const combined = `${idLower} ${nameLower}`;

  if (idLower === 'core' || combined.includes('核心')) {
    return { slotId: 'st_core', assetId: 'asset.st.core' };
  }
  if (idLower === 'hab' || combined.includes('居住') || combined.includes('生活')) {
    return { slotId: 'st_port_hab', assetId: 'asset.st.hab' };
  }
  if (idLower === 'lab' || combined.includes('实验') || combined.includes('科研')) {
    return { slotId: 'st_stbd_lab', assetId: 'asset.st.lab' };
  }
  if (idLower === 'dock' || combined.includes('节点') || combined.includes('对接')) {
    return { slotId: 'st_fwd_hub', assetId: 'asset.st.node_hub' };
  }
  if (idLower === 'solar' || combined.includes('太阳') || combined.includes('光电')) {
    const slotId = !occupiedSlots.has('st_truss_up_L') ? 'st_truss_up_L' : 'st_truss_up_R';
    return { slotId, assetId: 'asset.st.solar' };
  }
  if (idLower === 'truss' || combined.includes('桁架')) {
    const slotId = !occupiedSlots.has('st_truss_up_R') ? 'st_truss_up_R' : 'st_truss_up_L';
    return { slotId, assetId: 'asset.st.heavy_truss' };
  }
  if (idLower === 'reactor' || combined.includes('核反应') || combined.includes('核堆')) {
    const slotId = !occupiedSlots.has('st_truss_up_R') ? 'st_truss_up_R' : 'st_truss_up_L';
    return { slotId, assetId: 'asset.st.reactor' };
  }
  if (idLower === 'radiator' || combined.includes('散热') || combined.includes('电推')) {
    return { slotId: 'st_aft_hub', assetId: 'asset.st.radiator_ep' };
  }
  if (idLower === 'fuel' || combined.includes('燃料') || combined.includes('补给')) {
    return { slotId: 'st_truss_dn_L', assetId: 'asset.st.fuel_depot' };
  }
  if (idLower === 'recon' || combined.includes('侦察') || combined.includes('预警')) {
    return { slotId: 'st_truss_dn_R', assetId: 'asset.st.recon_array' };
  }
  if (idLower === 'kinetic' || combined.includes('动能') || combined.includes('钨')) {
    return { slotId: 'st_truss_dn_R', assetId: 'asset.st.kinetic_rod' };
  }
  if (idLower === 'orbital_dock' || combined.includes('船坞') || combined.includes('总装臂')) {
    return { slotId: 'st_ext_dock', assetId: 'asset.st.orbital_dock' };
  }
  return null;
}

function matchLunarModuleToSlotAndAsset(
  mod: ProjectModule,
  occupiedSlots: Set<string>,
): { slotId: string; assetId: string } | null {
  const idLower = (mod.id ?? '').trim().toLowerCase();
  const nameLower = (mod.name ?? '').trim().toLowerCase();
  const combined = `${idLower} ${nameLower}`;

  if (idLower === 'core' || combined.includes('核心') || combined.includes('防辐射')) {
    return { slotId: 'ln_core', assetId: 'asset.ln.core' };
  }
  if (idLower === 'pad' || combined.includes('着陆') || combined.includes('起降')) {
    const slotId = !occupiedSlots.has('ln_pad_1') ? 'ln_pad_1' : 'ln_pad_2';
    return { slotId, assetId: 'asset.ln.landing_pad' };
  }
  if (idLower === 'solar' || combined.includes('太阳') || combined.includes('永昼峰')) {
    return { slotId: 'ln_inner_1', assetId: 'asset.ln.solar_peak' };
  }
  if (idLower === 'fission' || idLower === 'reactor' || combined.includes('核裂变') || combined.includes('核电')) {
    return { slotId: 'ln_inner_1', assetId: 'asset.ln.fission_plant' };
  }
  if (idLower === 'bio' || combined.includes('生态') || combined.includes('温室') || combined.includes('维生')) {
    return { slotId: 'ln_inner_2', assetId: 'asset.ln.bio_dome' };
  }
  if (idLower === 'rover' || combined.includes('探测车') || combined.includes('整备')) {
    return { slotId: 'ln_inner_3', assetId: 'asset.ln.rover_bay' };
  }
  if (idLower === 'tunnel' || idLower === 'hub' || combined.includes('管廊')) {
    const slotId = !occupiedSlots.has('ln_hub_west') ? 'ln_hub_west' : 'ln_hub_east';
    return { slotId, assetId: 'asset.ln.tunnel_hub' };
  }
  if (idLower === 'ice' || combined.includes('水冰') || combined.includes('电解')) {
    return { slotId: 'ln_rim_ice', assetId: 'asset.ln.ice_electrolysis' };
  }
  if (idLower === 'he3' || combined.includes('氦-3') || combined.includes('氦3')) {
    return { slotId: 'ln_rim_he3', assetId: 'asset.ln.he3_refinery' };
  }
  if (idLower === 'mass_driver' || combined.includes('电磁') || combined.includes('投射')) {
    return { slotId: 'ln_rim_mass_driver', assetId: 'asset.ln.mass_driver' };
  }
  return null;
}

function inferSatelliteAssetId(orbital: OrbitalAsset): string {
  const idLower = (orbital.id ?? '').trim().toLowerCase();
  const nameLower = (orbital.name ?? '').trim().toLowerCase();
  const orbitUpper = (orbital.orbit ?? 'LEO').trim().toUpperCase();
  const combined = `${idLower} ${nameLower}`;

  if (combined.includes('sar') || combined.includes('合成孔径') || combined.includes('雷达')) {
    return 'asset.sat.sar_radar';
  }
  if (combined.includes('勘探') || combined.includes('重磁') || combined.includes('地质')) {
    return 'asset.sat.geo_survey';
  }
  if (
    combined.includes('预警') ||
    combined.includes('红外') ||
    combined.includes('深空中继') ||
    orbital.kind === 'weapon'
  ) {
    return 'asset.sat.early_warn';
  }
  if (orbital.kind === 'navigation' || combined.includes('导航') || combined.includes('授时')) {
    return 'asset.sat.nav_timing';
  }
  if (orbital.kind === 'comm' || combined.includes('通信') || combined.includes('中继')) {
    return 'asset.sat.comm_relay';
  }
  if (orbital.kind === 'recon' || combined.includes('光学') || combined.includes('侦察')) {
    return orbitUpper.includes('SSO') ? 'asset.sat.sar_radar' : 'asset.sat.opt_recon';
  }
  if (orbitUpper.includes('GEO')) return 'asset.sat.comm_relay';
  if (orbitUpper.includes('SSO')) return 'asset.sat.sar_radar';
  return 'asset.sat.opt_recon';
}

function pickConstellationSlotForAsset(
  orbital: OrbitalAsset,
  assetId: string,
  occupiedSlots: Set<string>,
): string | null {
  const orbitUpper = (orbital.orbit ?? 'LEO').trim().toUpperCase();
  const leoSlots = ['orb_leo_1', 'orb_leo_2', 'orb_leo_3', 'orb_leo_4'];
  const ssoSlots = ['orb_sso_1', 'orb_sso_2', 'orb_sso_3', 'orb_sso_4'];
  const geoSlots = ['orb_geo_1', 'orb_geo_2', 'orb_geo_3', 'orb_geo_4'];

  const assetDef = getReadonlySpaceCanvasAssetById(assetId);
  const allowed = new Set<string>(assetDef?.allowedInterfaces ?? ['orbit_leo', 'orbit_sso', 'orbit_geo']);

  const candidatePools: Array<{ iface: string; slots: string[] }> = [];
  if (orbitUpper.includes('GEO') || orbitUpper.includes('HEO') || orbitUpper.includes('静止') || orbitUpper.includes('同步')) {
    candidatePools.push({ iface: 'orbit_geo', slots: geoSlots });
    candidatePools.push({ iface: 'orbit_sso', slots: ssoSlots });
    candidatePools.push({ iface: 'orbit_leo', slots: leoSlots });
  } else if (orbitUpper.includes('SSO') || orbitUpper.includes('极轨') || orbitUpper.includes('太阳同步')) {
    candidatePools.push({ iface: 'orbit_sso', slots: ssoSlots });
    candidatePools.push({ iface: 'orbit_leo', slots: leoSlots });
    candidatePools.push({ iface: 'orbit_geo', slots: geoSlots });
  } else {
    candidatePools.push({ iface: 'orbit_leo', slots: leoSlots });
    candidatePools.push({ iface: 'orbit_sso', slots: ssoSlots });
    candidatePools.push({ iface: 'orbit_geo', slots: geoSlots });
  }

  for (const pool of candidatePools) {
    if (!allowed.has(pool.iface)) continue;
    for (const slotId of pool.slots) {
      if (!occupiedSlots.has(slotId)) {
        return slotId;
      }
    }
  }
  return null;
}

function inspectSnapshotForDomain(
  domain: SpaceCanvasDomainId,
  snapshot?: StatSnapshot | null,
  selectedBaseName?: string,
): SnapshotRuntimeSlotStatus {
  const slotStateMap: Record<string, 'completed' | 'built' | 'building'> = {};
  const derivedDraft: Record<string, string> = {};
  const slots = getSpaceCanvasSlots(domain);
  const slotById = new Map<string, SpaceCanvasSlotDef>(slots.map(s => [s.id, s]));

  for (const slot of slots) {
    if (slot.defaultAssetId) {
      derivedDraft[slot.id] = slot.defaultAssetId;
    }
  }

  const projects: Project[] = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const occupied = new Set<string>(Object.keys(derivedDraft));

  // 读取 space.completed_slots（四域通用已建成插槽映射：slotId -> assetId）
  const completedSlots = snapshot?.space?.completed_slots;
  if (completedSlots && typeof completedSlots === 'object') {
    for (const [rawSlotId, rawAssetId] of Object.entries(completedSlots)) {
      const slotId = rawSlotId === 'lc_sat_cleanroom' ? 'lc_spacecraft_hall' : rawSlotId;
      const targetSlot = slotById.get(slotId);
      if (!targetSlot) continue;
      const resolvedId =
        resolveDraftAssetId(rawAssetId) ??
        targetSlot.defaultAssetId ??
        getSpaceCanvasAssets(domain).find(a =>
          a.allowedInterfaces.includes(targetSlot.interfaceType),
        )?.id;
      if (resolvedId) {
        derivedDraft[slotId] = resolvedId;
        occupied.add(slotId);
        slotStateMap[slotId] = domain === 'launch_center' ? 'built' : 'completed';
      }
    }
  }

  if (domain === 'station') {
    for (const proj of projects) {
      if (!proj) continue;
      const refText = `${proj.id ?? ''} ${proj.ref ?? ''}`;
      if (!refText.includes('空间站') && !refText.includes('轨道站') && !refText.toLowerCase().includes('station')) {
        continue;
      }
      if (proj.status === '完工') {
        slotStateMap.st_core = 'completed';
      } else if (proj.status === '在建') {
        slotStateMap.st_core = slotStateMap.st_core ?? 'building';
      }
      if (isProjectV2(proj) && Array.isArray(proj.modules)) {
        for (const mod of proj.modules) {
          if (!mod || mod.status === '未启动' || mod.status === '取消') continue;
          const matched = matchStationModuleToSlotAndAsset(mod, occupied);
          if (!matched) continue;
          derivedDraft[matched.slotId] = matched.assetId;
          occupied.add(matched.slotId);
          slotStateMap[matched.slotId] = mod.status === '完工' ? 'completed' : 'building';
        }
      }
    }
  } else if (domain === 'lunar') {
    for (const proj of projects) {
      if (!proj) continue;
      const refText = `${proj.id ?? ''} ${proj.ref ?? ''}`;
      if (!refText.includes('月') && !refText.toLowerCase().includes('lunar')) {
        continue;
      }
      if (proj.status === '完工') {
        slotStateMap.ln_core = 'completed';
      } else if (proj.status === '在建') {
        slotStateMap.ln_core = slotStateMap.ln_core ?? 'building';
      }
      if (isProjectV2(proj) && Array.isArray(proj.modules)) {
        for (const mod of proj.modules) {
          if (!mod || mod.status === '未启动' || mod.status === '取消') continue;
          const matched = matchLunarModuleToSlotAndAsset(mod, occupied);
          if (!matched) continue;
          derivedDraft[matched.slotId] = matched.assetId;
          occupied.add(matched.slotId);
          slotStateMap[matched.slotId] = mod.status === '完工' ? 'completed' : 'building';
        }
      }
    }
  } else if (domain === 'constellation') {
    const orbitalAssets = Array.isArray(snapshot?.space?.orbital_assets)
      ? snapshot.space.orbital_assets
      : [];
    for (const orbital of orbitalAssets) {
      if (!orbital || (orbital.status ?? 'active') !== 'active') continue;
      if (orbital.kind === 'station') continue;
      const assetId = inferSatelliteAssetId(orbital);
      const explicitSlotId =
        orbital.slot_id && slotById.has(orbital.slot_id) ? orbital.slot_id : null;
      const slotId =
        explicitSlotId ?? pickConstellationSlotForAsset(orbital, assetId, occupied);
      if (!slotId) continue;
      derivedDraft[slotId] = assetId;
      occupied.add(slotId);
      slotStateMap[slotId] = 'completed';
    }
  } else if (domain === 'launch_center') {
    const targetBaseRef = (selectedBaseName ?? '').trim();
    const launchCenters = Array.isArray(snapshot?.space?.launch_centers)
      ? snapshot.space.launch_centers
      : [];

    const matchedCenters = targetBaseRef
      ? launchCenters.filter(
          lc =>
            lc &&
            (lc.base === targetBaseRef ||
              lc.id === targetBaseRef ||
              lc.name === targetBaseRef),
        )
      : launchCenters;
    const effectiveCenters =
      matchedCenters.length > 0 ? matchedCenters : launchCenters;

    for (const lc of effectiveCenters) {
      if (!lc || lc.status === '受损' || lc.status === '停机') continue;
      const lcState: 'built' | 'building' = lc.status === '建造中' ? 'building' : 'built';
      slotStateMap.lc_pad_1 = slotStateMap.lc_pad_1 ?? lcState;

      if (lc.tier >= 2 && !derivedDraft.lc_hif) {
        derivedDraft.lc_hif = 'asset.lc.vab_vertical';
        slotStateMap.lc_hif = lcState;
      }
      if (lc.tier >= 3 && !derivedDraft.lc_crawler_way) {
        derivedDraft.lc_crawler_way = 'asset.lc.crawler_super_base';
        slotStateMap.lc_crawler_way = lcState;
      }

      const rawSlots: Record<string, string> = {
        ...(lc.mounted_slots ?? {}),
        ...((lc as unknown as { slots?: Record<string, string> }).slots ?? {}),
      };
      for (const [rawSlotId, rawAssetId] of Object.entries(rawSlots)) {
        const slotId = rawSlotId === 'lc_sat_cleanroom' ? 'lc_spacecraft_hall' : rawSlotId;
        const targetSlot = slotById.get(slotId);
        if (!targetSlot) continue;
        const resolvedId =
          resolveDraftAssetId(rawAssetId) ??
          targetSlot.defaultAssetId ??
          getSpaceCanvasAssets('launch_center').find(a =>
            a.allowedInterfaces.includes(targetSlot.interfaceType),
          )?.id;
        if (resolvedId) {
          derivedDraft[slotId] = resolvedId;
          occupied.add(slotId);
          slotStateMap[slotId] = lcState;
        }
      }
    }

    // 读取基地已建成的独立航天建筑（双向映射为发射中心拓扑插槽 'built' / 'building'）
    const allBases = Array.isArray(snapshot?.bases)
      ? snapshot.bases.filter(b => b && b.status !== '废弃')
      : [];
    const matchedBases = targetBaseRef
      ? allBases.filter(b => b.name === targetBaseRef || b.id === targetBaseRef)
      : allBases;
    const candidateBases = matchedBases.length > 0 ? matchedBases : allBases;

    for (const base of candidateBases) {
      const buildings = Array.isArray(base.buildings) ? base.buildings : [];
      for (const bld of buildings) {
        if (!bld || typeof bld.name !== 'string') continue;
        const bldState = bld.state ?? '运转';
        if (bldState === '受损' || bldState === '停机') continue;
        const mappedList = mapBaseBuildingToLaunchCenterSlots(bld.name);
        for (const mapped of mappedList) {
          if (!slotById.has(mapped.slotId)) continue;
          derivedDraft[mapped.slotId] = mapped.assetId;
          occupied.add(mapped.slotId);
          const targetNodeState: 'built' | 'building' =
            bldState === '建造中' ? 'building' : 'built';
          if (slotStateMap[mapped.slotId] !== 'built') {
            slotStateMap[mapped.slotId] = targetNodeState;
          }
        }
      }
    }
  }

  return { slotStateMap, derivedDraft };
}

// ═══════════════════════════════════════════════════════════════════════════
// 核心导出纯函数 API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 根据画布域与当前 MVU 快照派生初始画布草稿映射（slotId -> assetId）
 */
export function deriveInitialCanvasDraft(
  domain: SpaceCanvasDomainId,
  snapshot?: StatSnapshot | null,
  selectedBaseName?: string,
): Record<string, string> {
  const { derivedDraft } = inspectSnapshotForDomain(domain, snapshot, selectedBaseName);
  return { ...derivedDraft };
}

/**
 * 利用只读索引 O(1) 解析草稿构件 ID（支持按 ID 或名称匹配，避免未命中时 getSpaceCanvasAssets 克隆全部资产）
 */
export function resolveDraftAssetId(rawId?: string | null): string | undefined {
  return getReadonlySpaceCanvasAssetById(rawId)?.id;
}

/**
 * 评估画布拓扑节点可见性、解锁门控、电力与维生热控收支、星座组网羁绊与告警清单
 */
export function evaluateSpaceCanvasView(
  domainOrOptions:
    | SpaceCanvasDomainId
    | {
        domain: SpaceCanvasDomainId;
        draft?: Record<string, string>;
        draftMap?: Record<string, string>;
        snapshot?: StatSnapshot | null;
        selectedBaseName?: string;
        baseName?: string;
      },
  draftMapArg?: Record<string, string>,
  snapshotArg?: StatSnapshot | null,
  selectedBaseNameArg?: string,
): SpaceCanvasEvalResult {
  const isObjCall = typeof domainOrOptions === 'object' && domainOrOptions !== null;
  const domain: SpaceCanvasDomainId = isObjCall ? domainOrOptions.domain : domainOrOptions;
  const draftMap: Record<string, string> = isObjCall
    ? (domainOrOptions.draftMap ?? domainOrOptions.draft ?? {})
    : (draftMapArg ?? {});
  const snapshot: StatSnapshot | null | undefined = isObjCall
    ? domainOrOptions.snapshot
    : snapshotArg;
  const selectedBaseName: string | undefined = isObjCall
    ? (domainOrOptions.selectedBaseName ?? domainOrOptions.baseName)
    : selectedBaseNameArg;

  const domainDef = getSpaceCanvasDomain(domain);
  const slots = getSpaceCanvasSlots(domain);
  const domainAssets = getSpaceCanvasAssets(domain);
  const { slotStateMap, derivedDraft } = inspectSnapshotForDomain(
    domain,
    snapshot,
    selectedBaseName,
  );

  // 1. 归一化草稿并确保已建成设施与 lockedCore/isRootCore 插槽始终带有核心构件
  const slotAssetMap: Record<string, string> = {};
  const validSlotIds = new Set(slots.map(s => s.id));

  // 先将快照中已建成或在建的槽位构件作为底层基线回填
  for (const [slotId, stateVal] of Object.entries(slotStateMap)) {
    if (stateVal && derivedDraft[slotId] && validSlotIds.has(slotId)) {
      slotAssetMap[slotId] = derivedDraft[slotId];
    }
  }

  for (const [rawSlotId, assetId] of Object.entries(draftMap ?? {})) {
    const slotId = rawSlotId === 'lc_sat_cleanroom' ? 'lc_spacecraft_hall' : rawSlotId;
    if (!validSlotIds.has(slotId) || !assetId) continue;
    const resolvedId = resolveDraftAssetId(assetId);
    if (resolvedId) {
      slotAssetMap[slotId] = resolvedId;
    }
  }

  for (const slot of slots) {
    if ((slot.lockedCore || slot.isRootCore) && slot.defaultAssetId && !slotAssetMap[slot.id]) {
      slotAssetMap[slot.id] = slot.defaultAssetId;
    }
  }

  // 2. 判定月面无人探测车勘探前置是否已满足（画布已挂载 isRoverSurveyor 或科技已含 月面原位资源利用工学）
  const techDoneSet = new Set<string>(Array.isArray(snapshot?.tech?.done) ? snapshot.tech.done : []);
  const hasSurveyTech =
    techDoneSet.has(LUNAR_ISRU_SURVEY_TECH) ||
    Array.from(techDoneSet).some(t => t.includes('月面原位资源利用'));
  const hasMountedRoverBay = Object.values(slotAssetMap).some(assetId => {
    const asset = getReadonlySpaceCanvasAssetById(assetId);
    return Boolean(asset?.isRoverSurveyor);
  });
  const roverSurveySatisfied = hasMountedRoverBay || hasSurveyTech;

  // 3. 预计算父子与扩展枢纽拓扑关系
  const childrenByParentId = new Map<string, string[]>();
  for (const slot of slots) {
    const parentKeys = new Set<string>();
    if (slot.parentSlotId) parentKeys.add(slot.parentSlotId);
    if (slot.unlockedBySlotId) parentKeys.add(slot.unlockedBySlotId);
    for (const pKey of parentKeys) {
      const list = childrenByParentId.get(pKey) ?? [];
      if (!list.includes(slot.id)) {
        list.push(slot.id);
      }
      childrenByParentId.set(pKey, list);
    }
  }

  const interfaceMismatchWarnings: string[] = [];

  // 4. 逐插槽评估 visible、lockReason、state 与候选资产
  const nodes: SpaceCanvasNodeView[] = slots.map(slot => {
    const gateSlotId = slot.unlockedBySlotId ?? slot.parentSlotId;
    const gateAssetId = gateSlotId ? slotAssetMap[gateSlotId] : undefined;
    const gateAsset = gateAssetId ? getReadonlySpaceCanvasAssetById(gateAssetId) : undefined;
    const rawMountedAssetId = slotAssetMap[slot.id];
    const rawMountedAsset = rawMountedAssetId ? getSpaceCanvasAssetById(rawMountedAssetId) : undefined;
    const runtimeSlotState = slotStateMap[slot.id];

    // 计算锁定原因（若已建成或在建则视为已解锁实体；否则按父节点/解锁枢纽 -> 扩展枢纽 -> 探测车勘探 优先级）
    let lockReason: string | undefined;
    if (!runtimeSlotState) {
      if (gateSlotId && !gateAsset) {
        lockReason = '需先规划上级连接节点';
      } else if (slot.requiresExpansionHub && !gateAsset?.isExpansionHub) {
        if (domain === 'launch_center') {
          lockReason =
            slot.tier === 3
              ? '需在重型转运枢纽挂载【超重型双轨转运与航天城流水线基座】解锁 Tier-3 航天城外延槽'
              : '需在总装测试厂房槽挂载【垂直总装测试厂房 (VAB)】解锁 Tier-2 中型发射中心外圈槽';
        } else {
          lockReason = '需在父节点挂载【扩展节点舱 / 管廊延伸枢纽】解锁外延槽';
        }
      } else if (slot.requiresRoverSurvey && !roverSurveySatisfied) {
        lockReason = '需先配置【月面无人探测车整备车库】完成外围矿脉勘探';
      }
    }

    const unlocked = !lockReason;
    const locked = !unlocked;

    // Tier-1 恒为 visible: true；Tier-2/Tier-3 当枢纽槽挂载了 isExpansionHub 或该槽自身已挂载/建成构件时动态展开
    const visible =
      slot.tier === 1
        ? true
        : Boolean(
            runtimeSlotState ||
              (!slot.requiresExpansionHub && gateAsset) ||
              gateAsset?.isExpansionHub ||
              rawMountedAsset,
          );

    // 接口兼容性校验
    if (rawMountedAsset && !rawMountedAsset.allowedInterfaces.includes(slot.interfaceType)) {
      interfaceMismatchWarnings.push(
        `⚠️ 接口不匹配：插槽「${slot.label}」不支持挂载「${rawMountedAsset.name}」`,
      );
    }

    const mountedAsset = rawMountedAsset;
    const mountedAssetId = mountedAsset?.id;

    // 节点状态判定
    let state: SpaceSlotNodeState;
    if (locked) {
      state = 'locked';
    } else if (!mountedAsset) {
      state = 'empty';
    } else if (runtimeSlotState === 'built') {
      state = 'built';
    } else if (runtimeSlotState === 'completed') {
      state = 'completed';
    } else if (runtimeSlotState === 'building') {
      state = 'building';
    } else {
      state = 'planned';
    }

    const isBuilt = state === 'completed' || state === 'built';

    const compatibleAssets = domainAssets.filter(asset =>
      asset.allowedInterfaces.includes(slot.interfaceType),
    );
    const childSlotIds = childrenByParentId.get(slot.id) ?? [];
    const hubExpandablePreview =
      childSlotIds.length > 0 && compatibleAssets.some(a => Boolean(a.isExpansionHub));

    const hasTechContext = Array.isArray(snapshot?.tech?.done);
    const researchUnlocked =
      !mountedAsset?.requiredResearch ||
      !hasTechContext ||
      techDoneSet.has(mountedAsset.requiredResearch);

    const connectedTo = Array.isArray(slot.connectedTo)
      ? [...slot.connectedTo]
      : slot.parentSlotId
        ? [slot.parentSlotId]
        : [];

    return {
      id: slot.id,
      slotId: slot.id,
      domain: slot.domain,
      label: slot.label,
      interfaceType: slot.interfaceType,
      interfaceLabel: SPACE_INTERFACE_TYPE_LABELS[slot.interfaceType] ?? slot.interfaceType,
      tier: slot.tier,
      x: slot.x,
      y: slot.y,
      rotation: slot.rotation ?? 0,
      scale: slot.scale ?? 1,
      parentSlotId: slot.parentSlotId,
      unlockedBySlotId: slot.unlockedBySlotId,
      connectedTo,
      isRootCore: Boolean(slot.isRootCore || slot.lockedCore),
      requiresExpansionHub: Boolean(slot.requiresExpansionHub),
      requiresRoverSurvey: Boolean(slot.requiresRoverSurvey),
      lockedCore: Boolean(slot.lockedCore || slot.isRootCore),
      slot,
      visible,
      unlocked,
      locked,
      lockReason,
      state,
      status: state,
      stateLabel: SPACE_NODE_STATE_LABELS[state],
      built: isBuilt,
      isBuilt,
      mountedAssetId,
      assetId: mountedAssetId,
      mountedAsset,
      asset: mountedAsset,
      compatibleAssets,
      allowedAssets: compatibleAssets,
      hubExpandablePreview,
      childSlotIds,
      researchUnlocked,
      missingResearch: researchUnlocked ? undefined : mountedAsset?.requiredResearch,
    };
  });

  const nodeById = new Map<string, SpaceCanvasNodeView>(nodes.map(n => [n.id, n]));

  // 5. 构建拓扑连线视图（父节点/connectedTo -> 子节点）
  const connections: SpaceCanvasConnectionView[] = [];
  const seenConnKeys = new Set<string>();
  for (const node of nodes) {
    const linkTargets: string[] = [];
    if (node.parentSlotId) linkTargets.push(node.parentSlotId);
    for (const targetId of node.connectedTo) {
      if (targetId && !linkTargets.includes(targetId)) {
        linkTargets.push(targetId);
      }
    }

    for (const parentId of linkTargets) {
      const parentNode = nodeById.get(parentId);
      if (!parentNode) continue;
      const connKey = `${parentNode.id}->${node.id}`;
      if (seenConnKeys.has(connKey)) continue;
      seenConnKeys.add(connKey);

      const connVisible = parentNode.visible && node.visible;
      const connActive = Boolean(parentNode.mountedAsset && node.mountedAsset && node.unlocked);
      let connState: SpaceSlotNodeState = 'empty';
      if (node.locked) {
        connState = 'locked';
      } else if (parentNode.built && node.built) {
        connState = domain === 'launch_center' ? 'built' : 'completed';
      } else if (node.state === 'building') {
        connState = 'building';
      } else if (node.mountedAsset) {
        connState = 'planned';
      }

      connections.push({
        id: `conn:${connKey}`,
        fromSlotId: parentNode.id,
        toSlotId: node.id,
        parentSlotId: parentNode.id,
        childSlotId: node.id,
        x1: parentNode.x,
        y1: parentNode.y,
        x2: node.x,
        y2: node.y,
        fromX: parentNode.x,
        fromY: parentNode.y,
        toX: node.x,
        toY: node.y,
        tier: node.tier,
        state: connState,
        active: connActive,
        visible: connVisible,
        isExpansionLink: node.requiresExpansionHub,
      });
    }
  }

  // 6. 汇总账本（电力、维生、造价、纳米、总质量、组网羁绊、工程告警）
  const activeMountedNodes = nodes.filter(n => Boolean(n.mountedAsset) && !n.locked);
  const mountedAssets = activeMountedNodes
    .map(n => n.mountedAsset)
    .filter((a): a is SpaceCanvasAssetDef => Boolean(a));

  const effectiveSlotAssetMap: Record<string, string> = {};
  for (const n of activeMountedNodes) {
    if (n.mountedAssetId) {
      effectiveSlotAssetMap[n.id] = n.mountedAssetId;
    }
  }

  let totalPowerGenKw = 0;
  let totalPowerLoadKw = 0;
  let totalLifeGen = 0;
  let totalLifeLoad = 0;
  let totalCostCredits = 0;
  let totalNanites = 0;
  let totalMassTons = 0;
  let totalWorkloadDays = 0;

  for (const asset of mountedAssets) {
    if (asset.powerDeltaKw >= 0) {
      totalPowerGenKw += asset.powerDeltaKw;
    } else {
      totalPowerLoadKw += Math.abs(asset.powerDeltaKw);
    }

    if (asset.lifeSupportDelta >= 0) {
      totalLifeGen += asset.lifeSupportDelta;
    } else {
      totalLifeLoad += Math.abs(asset.lifeSupportDelta);
    }

    totalCostCredits += asset.costCredits;
    totalNanites += asset.nanitesCost;
    totalMassTons = Math.round((totalMassTons + asset.massTons) * 10) / 10;
    totalWorkloadDays += asset.workloadDays;
  }

  const netPowerKw = totalPowerGenKw - totalPowerLoadKw;
  const powerBalanced = netPowerKw >= 0;
  const netLifeSupport = totalLifeGen - totalLifeLoad;
  const lifeBalanced = netLifeSupport >= 0;

  const allSynergies = getSpaceCanvasSynergies(domain);
  const activeSynergies = allSynergies.filter(syn =>
    syn.checkActive(mountedAssets, effectiveSlotAssetMap),
  );
  const activeSynergyIds = new Set(activeSynergies.map(s => s.id));
  const synergyViews: SpaceCanvasSynergyView[] = allSynergies.map(syn => {
    const isActive = activeSynergyIds.has(syn.id);
    return {
      ...syn,
      active: isActive,
      isActive,
      unlocked: isActive,
      requirementText: syn.description,
    };
  });

  const warnings: string[] = [...interfaceMismatchWarnings];
  if (!powerBalanced) {
    warnings.push(
      `⚡ 电力赤字告警：总耗电 (${totalPowerLoadKw}kW) 超出总发电 (${totalPowerGenKw}kW) 达 ${Math.abs(netPowerKw)}kW，请增配太阳翼或核反应堆舱`,
    );
  }
  if (!lifeBalanced) {
    warnings.push(
      `🫧 维生与热控赤字告警：维生散热负荷 (${totalLifeLoad}) 超出供给 (${totalLifeGen}) 达 ${Math.abs(netLifeSupport)} 点，请增配居住舱、生态温室或电推散热翼`,
    );
  }

  if (Array.isArray(snapshot?.tech?.done)) {
    for (const node of activeMountedNodes) {
      if (!node.researchUnlocked && node.missingResearch && node.mountedAsset) {
        warnings.push(
          `🔬 科技前置提醒：「${node.mountedAsset.name}」需先研发【${node.missingResearch}】方可正式施工`,
        );
      }
    }
  }

  const completedCount = nodes.filter(n => n.state === 'completed' || n.state === 'built').length;
  const buildingCount = nodes.filter(n => n.state === 'building').length;
  const plannedCount = mountedAssets.length;
  const unlockedSlotCount = nodes.filter(n => n.unlocked).length;
  const tier2ExpandedCount = nodes.filter(n => n.tier >= 2 && n.visible).length;
  const tier3ExpandedCount = nodes.filter(n => n.tier >= 3 && n.visible).length;

  const ledger: SpaceCanvasLedgerSummary = {
    totalPowerGenKw,
    totalPowerLoadKw,
    powerGenKw: totalPowerGenKw,
    powerLoadKw: totalPowerLoadKw,
    netPowerKw,
    powerBalanced,
    powerDeficit: !powerBalanced,
    totalLifeGen,
    totalLifeLoad,
    lifeGen: totalLifeGen,
    lifeLoad: totalLifeLoad,
    netLifeSupport,
    netLife: netLifeSupport,
    lifeBalanced,
    lifeDeficit: !lifeBalanced,
    totalCostCredits,
    totalCredits: totalCostCredits,
    totalNanites,
    totalNanitesCost: totalNanites,
    totalMassTons,
    totalWorkloadDays,
    mountedCount: mountedAssets.length,
    completedCount,
    builtCount: completedCount,
    buildingCount,
    plannedCount,
    unlockedSlotCount,
    unlockedCount: unlockedSlotCount,
    totalSlotCount: nodes.length,
    tier2ExpandedCount,
    tier3ExpandedCount,
    expandedCount: tier2ExpandedCount,
    roverSurveySatisfied,
    activeSynergies,
    allSynergies,
    synergies: synergyViews,
    warnings,
  };

  return {
    domain,
    domainDef,
    nodes,
    visibleNodes: nodes.filter(n => n.visible),
    connections,
    visibleConnections: connections.filter(c => c.visible),
    slotAssetMap: effectiveSlotAssetMap,
    ledger,
    synergies: synergyViews,
  };
}

/**
 * 生成锁定总体建造蓝图的指挥官自然语言规划令文本
 * 支持可选复用已计算的 evalResult，避免重复触发 evaluateSpaceCanvasView
 */
export function buildSpaceCanvasBlueprintOrderText(
  domain: SpaceCanvasDomainId,
  draftMap: Record<string, string>,
  baseName: string,
  snapshot?: StatSnapshot | null,
  precomputedEvalResult?: SpaceCanvasEvalResult | null,
): string {
  const evalResult = precomputedEvalResult ?? evaluateSpaceCanvasView(domain, draftMap, snapshot);
  const effectiveBase = (baseName ?? '').trim() || '主发射场';
  const { domainDef, ledger, nodes } = evalResult;

  const mountedNodes = nodes.filter(n => Boolean(n.mountedAsset) && !n.locked);
  const moduleSummary = mountedNodes
    .map(n => `${n.label}：${n.mountedAsset?.name}`)
    .join('；');

  const powerSign = ledger.netPowerKw >= 0 ? '+' : '';
  const lifeSign = ledger.netLifeSupport >= 0 ? '+' : '';
  const synergyText =
    ledger.activeSynergies.length > 0
      ? `，激活天基协同羁绊：${ledger.activeSynergies.map(s => s.name).join('、')}`
      : '';
  const warningText =
    ledger.warnings.length > 0 ? `\n【工程平衡备注】${ledger.warnings.join('；')}` : '';

  return [
    `【天基蓝图规划令】定下「${domainDef.title}」总体建造蓝图，牵头基地：${effectiveBase}（共规划 ${ledger.mountedCount} 个节点，预计总造价 $${ledger.totalCostCredits}，纳米工料 ${ledger.totalNanites}，总发射质量 ${ledger.totalMassTons}t，⚡净电力 ${powerSign}${ledger.netPowerKw}kW，🫧净维生 ${lifeSign}${ledger.netLifeSupport}${synergyText}）`,
    `【节点配置清单】${moduleSummary || '暂无已选配节点'}${warningText}`,
  ].join('\n');
}

/**
 * 为单个画布插槽节点构建「拟定发射合同 / 启动节点施工」联动载荷
 * 同时兼容：
 * - buildSpaceCanvasNodeActionPayload(node, baseName)
 * - buildSpaceCanvasNodeActionPayload(domain, slotId, assetId, baseName)
 */
export function buildSpaceCanvasNodeActionPayload(
  nodeOrDomain: SpaceCanvasNodeView | SpaceCanvasDomainId,
  baseNameOrSlotId: string,
  maybeAssetId?: string,
  maybeBaseName?: string,
): SpaceCanvasNodeActionPayload {
  let domain: SpaceCanvasDomainId;
  let slotId: string;
  let slotLabel: string;
  let asset: SpaceCanvasAssetDef | undefined;
  let effectiveBase: string;

  if (typeof nodeOrDomain === 'string') {
    domain = nodeOrDomain;
    slotId = String(baseNameOrSlotId ?? '').trim();
    const slotDef = getReadonlySpaceCanvasSlotById(slotId) ?? getSpaceCanvasSlots(domain).find(s => s.id === slotId);
    slotLabel = slotDef?.label ?? slotId;
    asset = getSpaceCanvasAssetById(maybeAssetId ?? slotDef?.defaultAssetId);
    effectiveBase = (maybeBaseName ?? '').trim() || '主发射场';
  } else {
    domain = nodeOrDomain.domain;
    slotId = nodeOrDomain.id ?? nodeOrDomain.slot?.id ?? '';
    slotLabel = nodeOrDomain.label ?? nodeOrDomain.slot?.label ?? slotId;
    asset = nodeOrDomain.mountedAsset ?? nodeOrDomain.asset;
    effectiveBase = (baseNameOrSlotId ?? '').trim() || '主发射场';
  }

  if (!asset) {
    return {
      domain,
      slotId,
      slotLabel,
      assetId: '',
      assetName: '未选配构件',
      baseName: effectiveBase,
      orderText: '',
    };
  }

  // 根据构件质量与所在天基域推荐运载火箭
  let rocket = '中型常温多级运载火箭';
  if (domain === 'lunar' || asset.orbitTarget === 'TLI' || asset.massTons >= 22) {
    rocket = '超级重型两级全复用运载系统';
  } else if (domain === 'station' || asset.massTons >= 10) {
    rocket = '重型低温无毒运载火箭';
  }

  // 推断航天合同类别
  let contractKind: SpaceContract['kind'] = 'station';
  if (domain === 'constellation') {
    if (
      asset.id.includes('recon') ||
      asset.id.includes('sar') ||
      asset.id.includes('survey') ||
      asset.id.includes('warn')
    ) {
      contractKind = 'recon';
    } else if (asset.id.includes('comm')) {
      contractKind = 'comm';
    } else {
      contractKind = 'constellation';
    }
  }

  const orbitTarget = asset.orbitTarget ?? (domain === 'lunar' ? 'TLI' : 'LEO');

  let orderText: string;
  if (domain === 'station') {
    orderText = `【天基节点建造与发射令】从「${effectiveBase}」使用「${rocket}」发射并对接空间站舱段「${asset.name}」至插槽「${slotLabel}」（${slotId}），预计造价 $${asset.costCredits}，纳米工料 ${asset.nanitesCost}，发射质量 ${asset.massTons}t`;
  } else if (domain === 'constellation') {
    orderText = `【天基节点建造与发射令】从「${effectiveBase}」使用「${rocket}」发射组网卫星「${asset.name}」定点至轨道相位槽「${slotLabel}」（${slotId}），目标轨道 ${orbitTarget}，预计造价 $${asset.costCredits}`;
  } else if (domain === 'launch_center') {
    orderText = `【发射中心模块扩建令】在「${effectiveBase}」发射中心拓扑插槽「${slotLabel}」（${slotId}）扩建部署「${asset.name}」，预计造价 $${asset.costCredits}，纳米工料 ${asset.nanitesCost}`;
  } else {
    orderText = `【天基节点建造与发射令】依托「${effectiveBase}」执行地月转移投送，在月球基地插槽「${slotLabel}」（${slotId}）施工建设「${asset.name}」，预计造价 $${asset.costCredits}，纳米工料 ${asset.nanitesCost}，设备质量 ${asset.massTons}t`;
  }

  return {
    domain,
    slotId,
    slotLabel,
    assetId: asset.id,
    assetName: asset.name,
    baseName: effectiveBase,
    orderText,
    contractPreset: {
      title: `${asset.name}发射与部署任务`,
      kind: contractKind,
      payload: asset.name,
      rocket,
      base: effectiveBase,
      orbitTarget,
      rewardCredits: asset.costCredits,
      recoverBooster: asset.massTons >= 10,
    },
  };
}

/**
 * 扫描世界书目录或动态扩展项中的 canvas_slot / canvas_asset 扩展定义并注入注册表
 */
export function extractWorldbookCanvasExtensions(catalog: unknown): {
  addedAssets: number;
  addedSlots: number;
} {
  if (!catalog || typeof catalog !== 'object') {
    return { addedAssets: 0, addedSlots: 0 };
  }

  const record = catalog as Record<string, unknown>;
  const rawAssets = Array.isArray(record.canvasAssets) ? record.canvasAssets : [];
  const rawSlots = Array.isArray(record.canvasSlots) ? record.canvasSlots : [];

  if (rawAssets.length > 0) {
    registerSpaceCanvasAssets(rawAssets as SpaceCanvasAssetDef[]);
  }
  if (rawSlots.length > 0) {
    registerSpaceCanvasSlots(rawSlots as SpaceCanvasSlotDef[]);
  }

  return {
    addedAssets: rawAssets.length,
    addedSlots: rawSlots.length,
  };
}
