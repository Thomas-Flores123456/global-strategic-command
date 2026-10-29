import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { Schema } from '../../红警指挥系统/core/schema';
import {
  DEFAULT_SPACE_CANVAS_ASSETS,
  DEFAULT_SPACE_CANVAS_SLOTS,
  LAUNCH_CENTER_ASSETS,
  LAUNCH_CENTER_SLOTS,
  LAUNCH_CENTER_SYNERGIES,
  LUNAR_ISRU_SURVEY_TECH,
  SPACE_CANVAS_DOMAIN_TABS,
  buildSpaceCanvasBlueprintOrderText,
  buildSpaceCanvasNodeActionPayload,
  deriveInitialCanvasDraft,
  evaluateSpaceCanvasView,
  extractWorldbookCanvasExtensions,
  getSpaceCanvasAssetById,
  getSpaceCanvasAssets,
  getSpaceCanvasDomain,
  getSpaceCanvasSlots,
  getSpaceCanvasSynergies,
  registerSpaceCanvasAssets,
  registerSpaceCanvasDomain,
  registerSpaceCanvasSlots,
  registerSpaceCanvasSynergies,
  resetSpaceCanvasRegistryToDefaults,
} from '../models/spaceCanvasModel';
import { getSpaceSvgSymbolById } from '../panels/spaceCanvasSvgSymbols';

const FORBIDDEN_23_WORDS = [
  '六柱',
  '战略柱',
  '柱域',
  '协议轨道',
  '未选择轨道',
  '线性轨道',
  '同源面板',
  '同源投影',
  '零注入语义',
  '无实例驱动',
  '未投影',
  '抽象槽',
  '通用底座',
  '暂存门',
  '审核门',
  '待落盘',
  '原子热重算',
  '当前作用域',
] as const;

describe('PKG-A · spaceCanvasRegistry & spaceCanvasModel 天基三域画布拓扑与评估引擎', () => {
  beforeEach(() => {
    resetSpaceCanvasRegistryToDefaults();
  });

  it('1. 内置四域拓扑插槽（发射中心12槽 / 空间站12槽 / 星座12槽 / 月球基地12槽）与42枚正典构件完整性校验', () => {
    const launchCenterDomain = getSpaceCanvasDomain('launch_center');
    const stationDomain = getSpaceCanvasDomain('station');
    const constellationDomain = getSpaceCanvasDomain('constellation');
    const lunarDomain = getSpaceCanvasDomain('lunar');

    expect(SPACE_CANVAS_DOMAIN_TABS).toHaveLength(4);
    expect(launchCenterDomain.viewBoxWidth).toBe(800);
    expect(stationDomain.viewBoxWidth).toBe(800);
    expect(stationDomain.viewBoxHeight).toBe(460);
    expect(constellationDomain.centerX).toBe(400);
    expect(lunarDomain.centerY).toBe(230);

    const launchCenterSlots = getSpaceCanvasSlots('launch_center');
    const stationSlots = getSpaceCanvasSlots('station');
    const constellationSlots = getSpaceCanvasSlots('constellation');
    const lunarSlots = getSpaceCanvasSlots('lunar');

    expect(launchCenterSlots).toHaveLength(12);
    expect(launchCenterSlots.filter(s => s.tier === 1)).toHaveLength(4);
    expect(launchCenterSlots.filter(s => s.tier === 2)).toHaveLength(4);
    expect(launchCenterSlots.filter(s => s.tier === 3)).toHaveLength(4);

    expect(stationSlots).toHaveLength(12);
    expect(stationSlots.filter(s => s.tier === 1)).toHaveLength(9);
    expect(stationSlots.filter(s => s.tier === 2 && s.requiresExpansionHub)).toHaveLength(3);

    expect(constellationSlots).toHaveLength(12);
    expect(constellationSlots.filter(s => s.interfaceType === 'orbit_leo')).toHaveLength(4);
    expect(constellationSlots.filter(s => s.interfaceType === 'orbit_sso')).toHaveLength(4);
    expect(constellationSlots.filter(s => s.interfaceType === 'orbit_geo')).toHaveLength(4);

    expect(lunarSlots).toHaveLength(12);
    expect(lunarSlots.filter(s => s.tier === 1)).toHaveLength(8);
    expect(lunarSlots.filter(s => s.tier === 2 && s.requiresExpansionHub)).toHaveLength(4);
    expect(lunarSlots.filter(s => s.requiresRoverSurvey)).toHaveLength(2);

    expect(DEFAULT_SPACE_CANVAS_SLOTS).toHaveLength(48);
    expect(DEFAULT_SPACE_CANVAS_ASSETS).toHaveLength(42);
    expect(getSpaceCanvasAssets('launch_center')).toHaveLength(14);
    expect(getSpaceCanvasAssets('station')).toHaveLength(12);
    expect(getSpaceCanvasAssets('constellation')).toHaveLength(6);
    expect(getSpaceCanvasAssets('lunar')).toHaveLength(10);
  });

  it('2. deriveInitialCanvasDraft：无快照时默认填充空间站与月球基地核心舱，星座默认空表', () => {
    const stationDraft = deriveInitialCanvasDraft('station', null);
    expect(stationDraft).toEqual({ st_core: 'asset.st.core' });

    const lunarDraft = deriveInitialCanvasDraft('lunar', null);
    expect(lunarDraft).toEqual({ ln_core: 'asset.ln.core' });

    const constellationDraft = deriveInitialCanvasDraft('constellation', null);
    expect(constellationDraft).toEqual({});
  });

  it('3. deriveInitialCanvasDraft：从 snapshot.projects 轨道空间站 V2 模块自动映射至对应插槽', () => {
    const snapshot = Schema.parse({
      projects: [
        {
          id: 'proj:轨道空间站@beipo',
          ref: '轨道空间站仓段化工程',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '巨构',
          status: '在建',
          modules: [
            { id: 'core', name: '天枢核心舱', status: '完工', base: 'beipo', queue_index: null },
            { id: 'hab', name: '居住舱', status: '完工', base: 'beipo', queue_index: null },
            { id: 'lab', name: '实验舱', status: '进行中', base: 'beipo', queue_index: 0 },
            { id: 'solar', name: '太阳翼', status: '完工', base: 'beipo', queue_index: null },
            { id: 'dock', name: '对接舱段', status: '进行中', base: 'beipo', queue_index: 1 },
            { id: 'truss', name: '重型桁架段', status: '未启动', base: '', queue_index: null },
          ],
          outcome: { type: 'mark' },
          schema_version: 2,
        },
      ],
    });

    const draft = deriveInitialCanvasDraft('station', snapshot);
    expect(draft.st_core).toBe('asset.st.core');
    expect(draft.st_port_hab).toBe('asset.st.hab');
    expect(draft.st_stbd_lab).toBe('asset.st.lab');
    expect(draft.st_truss_up_L).toBe('asset.st.solar');
    expect(draft.st_fwd_hub).toBe('asset.st.node_hub');

    const evalRes = evaluateSpaceCanvasView('station', draft, snapshot);
    const habNode = evalRes.nodes.find(n => n.id === 'st_port_hab');
    const labNode = evalRes.nodes.find(n => n.id === 'st_stbd_lab');
    expect(habNode?.state).toBe('completed');
    expect(labNode?.state).toBe('building');
  });

  it('4. deriveInitialCanvasDraft：从 snapshot.space.orbital_assets 自动映射在轨卫星至对应轨道槽', () => {
    const snapshot = Schema.parse({
      space: {
        orbital_assets: [
          {
            id: 'sat-1',
            name: '高分光学详查卫星一号',
            kind: 'recon',
            orbit: 'LEO',
            status: 'active',
            launched_at_day: 2,
          },
          {
            id: 'sat-2',
            name: '全天候SAR合成孔径雷达星',
            kind: 'recon',
            orbit: 'SSO',
            status: 'active',
            launched_at_day: 3,
          },
          {
            id: 'sat-3',
            name: '高轨红外预警一号',
            kind: 'weapon',
            orbit: 'GEO',
            status: 'active',
            launched_at_day: 4,
          },
          {
            id: 'sat-retired',
            name: '退役通信星',
            kind: 'comm',
            orbit: 'LEO',
            status: 'deorbited',
            launched_at_day: 1,
          },
        ],
      },
    });

    const draft = deriveInitialCanvasDraft('constellation', snapshot);
    expect(draft.orb_leo_1).toBe('asset.sat.opt_recon');
    expect(draft.orb_sso_1).toBe('asset.sat.sar_radar');
    expect(draft.orb_geo_1).toBe('asset.sat.early_warn');
    expect(Object.keys(draft)).toHaveLength(3);
  });

  it('5. 空间站 Tier-2 扩展节点舱与重型桁架动态生长机制校验', () => {
    // 初始仅挂载核心舱：9个 Tier-1 可见，3个 Tier-2 不可见且锁定
    const initialEval = evaluateSpaceCanvasView('station', { st_core: 'asset.st.core' });
    expect(initialEval.visibleNodes).toHaveLength(9);
    expect(initialEval.ledger.tier2ExpandedCount).toBe(0);

    const extDockBefore = initialEval.nodes.find(n => n.id === 'st_ext_dock')!;
    expect(extDockBefore.visible).toBe(false);
    expect(extDockBefore.locked).toBe(true);
    expect(extDockBefore.lockReason).toBe('需先规划上级连接节点');

    // 在 st_fwd_hub 挂载普通居住舱（非扩展枢纽）：st_ext_dock 仍锁定，提示需挂载扩展节点舱
    const nonHubEval = evaluateSpaceCanvasView('station', {
      st_core: 'asset.st.core',
      st_fwd_hub: 'asset.st.hab',
    });
    const extDockNonHub = nonHubEval.nodes.find(n => n.id === 'st_ext_dock')!;
    expect(extDockNonHub.visible).toBe(false);
    expect(extDockNonHub.locked).toBe(true);
    expect(extDockNonHub.lockReason).toBe(
      '需在父节点挂载【扩展节点舱 / 管廊延伸枢纽】解锁外延槽',
    );

    // 在 st_fwd_hub 挂载六向节点舱 (asset.st.node_hub)，在 st_truss_up_L 挂载重型桁架 (asset.st.heavy_truss)
    const expandedEval = evaluateSpaceCanvasView('station', {
      st_core: 'asset.st.core',
      st_fwd_hub: 'asset.st.node_hub',
      st_truss_up_L: 'asset.st.heavy_truss',
    });
    const extDockAfter = expandedEval.nodes.find(n => n.id === 'st_ext_dock')!;
    const extWingLAfter = expandedEval.nodes.find(n => n.id === 'st_ext_wing_L')!;
    const extWingRAfter = expandedEval.nodes.find(n => n.id === 'st_ext_wing_R')!;

    expect(extDockAfter.visible).toBe(true);
    expect(extDockAfter.unlocked).toBe(true);
    expect(extDockAfter.state).toBe('empty');

    expect(extWingLAfter.visible).toBe(true);
    expect(extWingLAfter.unlocked).toBe(true);

    expect(extWingRAfter.visible).toBe(false);
    expect(extWingRAfter.locked).toBe(true);
    expect(expandedEval.ledger.tier2ExpandedCount).toBe(2);
  });

  it('6. 月球基地加压管廊枢纽与月面无人探测车勘探门（requiresRoverSurvey）双重门控校验', () => {
    // 仅在西侧管廊口挂载管廊延伸枢纽 (asset.ln.tunnel_hub)，未配探测车且无原位资源科技
    const step1 = evaluateSpaceCanvasView('lunar', {
      ln_core: 'asset.ln.core',
      ln_hub_west: 'asset.ln.tunnel_hub',
      ln_hub_east: 'asset.ln.tunnel_hub',
    });

    const rimIce1 = step1.nodes.find(n => n.id === 'ln_rim_ice')!;
    const rimHe31 = step1.nodes.find(n => n.id === 'ln_rim_he3')!;
    const rimMassDriver1 = step1.nodes.find(n => n.id === 'ln_rim_mass_driver')!;

    // 东侧电磁质量投射器槽无需探测车，管廊到位即解锁
    expect(rimMassDriver1.visible).toBe(true);
    expect(rimMassDriver1.unlocked).toBe(true);

    // 西侧水冰与氦-3矿槽虽已在视野展开，但因缺少探测车勘探而处于锁定态
    expect(rimIce1.visible).toBe(true);
    expect(rimIce1.locked).toBe(true);
    expect(rimIce1.lockReason).toBe('需先配置【月面无人探测车整备车库】完成外围矿脉勘探');
    expect(rimHe31.locked).toBe(true);

    // 方式 A：在内圈挂载【月面无人探测车与机娘整备车库】(asset.ln.rover_bay) 即可解锁
    const step2ByRover = evaluateSpaceCanvasView('lunar', {
      ln_core: 'asset.ln.core',
      ln_hub_west: 'asset.ln.tunnel_hub',
      ln_inner_3: 'asset.ln.rover_bay',
    });
    expect(step2ByRover.ledger.roverSurveySatisfied).toBe(true);
    expect(step2ByRover.nodes.find(n => n.id === 'ln_rim_ice')!.unlocked).toBe(true);
    expect(step2ByRover.nodes.find(n => n.id === 'ln_rim_he3')!.unlocked).toBe(true);

    // 方式 B：通过 snapshot.tech.done 包含「月面原位资源利用工学」科技解锁
    const snapshotWithTech = Schema.parse({
      tech: { done: [LUNAR_ISRU_SURVEY_TECH] },
    });
    const step2ByTech = evaluateSpaceCanvasView(
      'lunar',
      {
        ln_core: 'asset.ln.core',
        ln_hub_west: 'asset.ln.tunnel_hub',
      },
      snapshotWithTech,
    );
    expect(step2ByTech.ledger.roverSurveySatisfied).toBe(true);
    expect(step2ByTech.nodes.find(n => n.id === 'ln_rim_ice')!.unlocked).toBe(true);
  });

  it('7. ⚡电力收支与🫧维生热控双平衡账本计算及赤字告警校验', () => {
    // 挂载高耗电/高热负荷舱段：核心舱(+30kW, +20维生) + 实验舱(-35kW, -10维生) + 上帝之杖(-50kW, -15维生)
    const deficitEval = evaluateSpaceCanvasView('station', {
      st_core: 'asset.st.core',
      st_stbd_lab: 'asset.st.lab',
      st_truss_dn_R: 'asset.st.kinetic_rod',
    });

    expect(deficitEval.ledger.totalPowerGenKw).toBe(30);
    expect(deficitEval.ledger.totalPowerLoadKw).toBe(85);
    expect(deficitEval.ledger.netPowerKw).toBe(-55);
    expect(deficitEval.ledger.powerBalanced).toBe(false);

    expect(deficitEval.ledger.totalLifeGen).toBe(20);
    expect(deficitEval.ledger.totalLifeLoad).toBe(25);
    expect(deficitEval.ledger.netLifeSupport).toBe(-5);
    expect(deficitEval.ledger.lifeBalanced).toBe(false);

    expect(deficitEval.ledger.warnings.some(w => w.includes('电力赤字告警'))).toBe(true);
    expect(deficitEval.ledger.warnings.some(w => w.includes('维生与热控赤字告警'))).toBe(true);

    // 增配太阳翼(+65kW) 与 居住舱(-15kW, +45维生) + 另一侧太阳翼(+65kW)
    const balancedEval = evaluateSpaceCanvasView('station', {
      st_core: 'asset.st.core',
      st_port_hab: 'asset.st.hab',
      st_stbd_lab: 'asset.st.lab',
      st_truss_dn_R: 'asset.st.kinetic_rod',
      st_truss_up_L: 'asset.st.solar',
      st_truss_up_R: 'asset.st.solar',
    });

    expect(balancedEval.ledger.netPowerKw).toBe(30 + 65 + 65 - 15 - 35 - 50); // +60kW
    expect(balancedEval.ledger.powerBalanced).toBe(true);
    expect(balancedEval.ledger.netLifeSupport).toBe(20 + 45 - 10 - 15); // +40
    expect(balancedEval.ledger.lifeBalanced).toBe(true);
    expect(balancedEval.ledger.warnings).toHaveLength(0);
  });

  it('8. 轨道星座 4 大组网羁绊激活判定校验', () => {
    const evalAllFour = evaluateSpaceCanvasView('constellation', {
      orb_leo_1: 'asset.sat.opt_recon',
      orb_leo_2: 'asset.sat.comm_relay',
      orb_leo_3: 'asset.sat.comm_relay',
      orb_sso_1: 'asset.sat.sar_radar',
      orb_sso_2: 'asset.sat.geo_survey',
      orb_geo_1: 'asset.sat.nav_timing',
      orb_geo_2: 'asset.sat.early_warn',
      orb_geo_3: 'asset.sat.early_warn',
    });

    const activeIds = evalAllFour.ledger.activeSynergies.map(s => s.id);
    expect(activeIds).toContain('syn.constellation.sky_eye');
    expect(activeIds).toContain('syn.constellation.quantum_link');
    expect(activeIds).toContain('syn.constellation.aegis_dome');
    expect(activeIds).toContain('syn.constellation.cislunar_corridor');
    expect(evalAllFour.ledger.activeSynergies).toHaveLength(4);
  });

  it('9. 总体蓝图规划令与单节点发射/建造联动载荷生成校验', () => {
    const draft = {
      st_core: 'asset.st.core',
      st_port_hab: 'asset.st.hab',
      st_truss_up_L: 'asset.st.solar',
    };

    const blueprintOrder = buildSpaceCanvasBlueprintOrderText('station', draft, '北坡主基地');
    expect(blueprintOrder).toContain('【天基蓝图规划令】');
    expect(blueprintOrder).toContain('北坡主基地');
    expect(blueprintOrder).toContain('常驻乘员居住生活舱');
    expect(blueprintOrder).toContain('标准太阳翼与供配电组件');

    const evalRes = evaluateSpaceCanvasView('station', draft);
    const solarNode = evalRes.nodes.find(n => n.id === 'st_truss_up_L')!;
    const payload = buildSpaceCanvasNodeActionPayload(solarNode, '北坡主基地');

    expect(payload.domain).toBe('station');
    expect(payload.slotId).toBe('st_truss_up_L');
    expect(payload.assetId).toBe('asset.st.solar');
    expect(payload.orderText).toContain('【天基节点建造与发射令】');
    expect(payload.orderText).toContain('标准太阳翼与供配电组件');
    expect(payload.contractPreset?.payload).toBe('标准太阳翼与供配电组件');
    expect(payload.contractPreset?.base).toBe('北坡主基地');
    expect(payload.contractPreset?.rewardCredits).toBe(2400);
  });

  it('10. 开放式扩展注册表 API：支持动态注册新画布域、新插槽、新构件与新羁绊并可一键重置', () => {
    registerSpaceCanvasDomain({
      id: 'mars',
      title: '火星奥林匹斯山前哨画布',
      subtitle: '深空远征扩展域测试',
      viewBoxWidth: 800,
      viewBoxHeight: 460,
      centerX: 400,
      centerY: 230,
    });

    registerSpaceCanvasSlots('mars', [
      {
        id: 'mars_core',
        domain: 'mars',
        label: '火星穹顶核心',
        interfaceType: 'mars_core',
        tier: 1,
        x: 400,
        y: 230,
        defaultAssetId: 'asset.mars.core',
        lockedCore: true,
      },
    ]);

    registerSpaceCanvasAssets([
      {
        id: 'asset.mars.core',
        name: '火星大气压差转化核心舱',
        domain: 'mars',
        allowedInterfaces: ['mars_core'],
        costCredits: 9000,
        nanitesCost: 420,
        massTons: 35,
        workloadDays: 15,
        powerDeltaKw: 50,
        lifeSupportDelta: 40,
        effectSummary: '原位转化二氧化碳制取氧气与甲烷燃料',
        svgSymbolId: 'ln_core',
      },
    ]);

    registerSpaceCanvasSynergies([
      {
        id: 'syn.mars.pioneer',
        domain: 'mars',
        name: '【红色星球拓荒者】',
        description: '部署火星大气压差转化核心舱',
        bonusSummary: '深空远征士气与科研产出提升',
        ringTone: 'amber',
        checkActive: mounted => mounted.some(a => a.id === 'asset.mars.core'),
      },
    ]);

    expect(getSpaceCanvasAssetById('asset.mars.core')?.name).toBe('火星大气压差转化核心舱');
    const marsEval = evaluateSpaceCanvasView('mars', {});
    expect(marsEval.nodes).toHaveLength(1);
    expect(marsEval.ledger.netPowerKw).toBe(50);
    expect(marsEval.ledger.activeSynergies).toHaveLength(1);

    // 验证 extractWorldbookCanvasExtensions 批量合入
    const extRes = extractWorldbookCanvasExtensions({
      canvasAssets: [
        {
          id: 'asset.st.allied_prism',
          name: '天基超级光棱聚焦阵',
          domain: 'station',
          allowedInterfaces: ['station_truss_payload'],
          costCredits: 8800,
          nanitesCost: 400,
          massTons: 24,
          workloadDays: 12,
          powerDeltaKw: -60,
          lifeSupportDelta: -10,
          effectSummary: '盟军天基光棱轨道支援阵列',
          svgSymbolId: 'st_kinetic_rod',
        },
      ],
    });
    expect(extRes.addedAssets).toBe(1);
    expect(getSpaceCanvasAssetById('asset.st.allied_prism')?.name).toBe('天基超级光棱聚焦阵');

    // 重置后恢复默认
    resetSpaceCanvasRegistryToDefaults();
    expect(getSpaceCanvasAssetById('asset.mars.core')).toBeUndefined();
    expect(getSpaceCanvasAssetById('asset.st.allied_prism')).toBeUndefined();
    expect(getSpaceCanvasSynergies('constellation')).toHaveLength(4);
  });

  it('11. 红线门禁：源码与生成文案 0 命中 23 号任务包 18 个机器味禁用词', () => {
    const registrySource = readFileSync(
      resolve(__dirname, '../models/spaceCanvasRegistry.ts'),
      'utf8',
    );
    const modelSource = readFileSync(
      resolve(__dirname, '../models/spaceCanvasModel.ts'),
      'utf8',
    );
    const orderSample = buildSpaceCanvasBlueprintOrderText(
      'station',
      { st_core: 'asset.st.core', st_port_hab: 'asset.st.hab' },
      '北坡主基地',
    );

    for (const word of FORBIDDEN_23_WORDS) {
      expect(registrySource).not.toContain(word);
      expect(modelSource).not.toContain(word);
      expect(orderSample).not.toContain(word);
    }
  });

  it('12. FD-27 · launch_center 4➔8➔12 槽三阶同图渐进生长（VAB 解锁 Tier-2，超重型双轨转运基座解锁 Tier-3）与 SVG 图元完备校验', () => {
    expect(LAUNCH_CENTER_SLOTS).toHaveLength(12);
    expect(LAUNCH_CENTER_ASSETS).toHaveLength(14);
    expect(LAUNCH_CENTER_SYNERGIES).toHaveLength(2);

    // 校验 14 枚发射中心构件均拥有专属 SVG 图元
    for (const asset of LAUNCH_CENTER_ASSETS) {
      const symbol = getSpaceSvgSymbolById(asset.svgSymbolId);
      expect(symbol.id).toBe(asset.svgSymbolId);
      expect(symbol.paths.length).toBeGreaterThan(0);
    }

    // Stage 1：初始小型发射场（4 槽可见，1#常温工位默认挂载）
    const initDraft = deriveInitialCanvasDraft('launch_center', null);
    expect(initDraft).toEqual({ lc_pad_1: 'asset.lc.pad_std' });

    const stage1Eval = evaluateSpaceCanvasView('launch_center', initDraft);
    expect(stage1Eval.visibleNodes).toHaveLength(4);
    expect(stage1Eval.ledger.unlockedSlotCount).toBe(4);
    expect(stage1Eval.ledger.tier2ExpandedCount).toBe(0);
    expect(stage1Eval.ledger.tier3ExpandedCount).toBe(0);

    // 若 lc_hif 仅挂载水平分段厂房（非扩展枢纽），Tier-2 依然保持折叠锁定
    const stage1Horiz = evaluateSpaceCanvasView('launch_center', {
      lc_pad_1: 'asset.lc.pad_std',
      lc_hif: 'asset.lc.hif_horiz',
    });
    expect(stage1Horiz.visibleNodes).toHaveLength(4);
    expect(stage1Horiz.nodes.find(n => n.id === 'lc_pad_2')?.locked).toBe(true);

    // Stage 2：在 lc_hif 挂载【垂直总装测试厂房 (VAB)】（isExpansionHub: true）➔ 展开 Tier-2 中型 8 槽
    const stage2Eval = evaluateSpaceCanvasView('launch_center', {
      lc_pad_1: 'asset.lc.pad_std',
      lc_hif: 'asset.lc.vab_vertical',
    });
    expect(stage2Eval.visibleNodes).toHaveLength(8);
    expect(stage2Eval.ledger.unlockedSlotCount).toBe(8);
    expect(stage2Eval.ledger.tier2ExpandedCount).toBe(4);
    expect(stage2Eval.ledger.tier3ExpandedCount).toBe(0);
    expect(stage2Eval.nodes.find(n => n.id === 'lc_pad_2')?.unlocked).toBe(true);
    expect(stage2Eval.nodes.find(n => n.id === 'lc_crawler_way')?.unlocked).toBe(true);
    expect(stage2Eval.nodes.find(n => n.id === 'lc_pad_super')?.locked).toBe(true);

    // Stage 3：在 lc_crawler_way 挂载【超重型双轨转运与航天城流水线基座】（isExpansionHub: true）➔ 展开 Tier-3 航天城小巨构 12 槽
    const stage3Eval = evaluateSpaceCanvasView('launch_center', {
      lc_pad_1: 'asset.lc.pad_std',
      lc_hif: 'asset.lc.vab_vertical',
      lc_crawler_way: 'asset.lc.crawler_super_base',
    });
    expect(stage3Eval.visibleNodes).toHaveLength(12);
    expect(stage3Eval.ledger.unlockedSlotCount).toBe(12);
    expect(stage3Eval.ledger.tier2ExpandedCount).toBe(8);
    expect(stage3Eval.ledger.tier3ExpandedCount).toBe(4);
    expect(stage3Eval.nodes.find(n => n.id === 'lc_pad_super')?.unlocked).toBe(true);
    expect(stage3Eval.nodes.find(n => n.id === 'lc_underground_fab')?.unlocked).toBe(true);
    expect(stage3Eval.nodes.find(n => n.id === 'lc_spacecraft_hall')?.unlocked).toBe(true);
    expect(stage3Eval.nodes.find(n => n.id === 'lc_cryo_plant')?.unlocked).toBe(true);
  });

  it('13. FD-27 · 基地已建成独立航天建筑双向映射点亮 built 态并激活【国家航天城】与【两级完全复用】羁绊', () => {
    const snapshot = Schema.parse({
      bases: [
        {
          id: 'beipo',
          name: '北坡主基地',
          buildings: [
            { name: '重型航天发射场', state: '运转' },
            { name: '火箭制造厂', state: '运转' },
            { name: '卫星制造中心', state: '运转' },
            { name: '大型航天器与舱段总装中心', state: '运转' },
            { name: '深空测控网络', state: '运转' },
          ],
        },
      ],
      space: {
        completed_slots: {
          lc_crawler_way: 'asset.lc.crawler_super_base',
          lc_pad_super: 'asset.lc.mechazilla_tower',
          lc_recovery_zone: 'asset.lc.lz_recovery',
          lc_cryo_plant: 'asset.lc.cryo_methalox_plant',
        },
      },
    });

    const evalRes = evaluateSpaceCanvasView('launch_center', {}, snapshot, '北坡主基地');
    const nodeById = new Map(evalRes.nodes.map(n => [n.id, n]));

    expect(nodeById.get('lc_pad_1')?.state).toBe('built');
    expect(nodeById.get('lc_hif')?.state).toBe('built');
    expect(nodeById.get('lc_telemetry_1')?.state).toBe('built');
    expect(nodeById.get('lc_underground_fab')?.state).toBe('built');
    expect(nodeById.get('lc_spacecraft_hall')?.state).toBe('built');
    expect(nodeById.get('lc_weather_tower')?.state).toBe('built');
    expect(nodeById.get('lc_pad_super')?.state).toBe('built');
    expect(nodeById.get('lc_recovery_zone')?.state).toBe('built');
    expect(nodeById.get('lc_cryo_plant')?.state).toBe('built');

    const activeSynergyIds = evalRes.ledger.activeSynergies.map(s => s.id);
    expect(activeSynergyIds).toContain('syn.lc.spaceport_city');
    expect(activeSynergyIds).toContain('syn.lc.full_reuse_starbase');

    const actionPayload = buildSpaceCanvasNodeActionPayload(
      nodeById.get('lc_pad_super')!,
      '北坡主基地',
    );
    expect(actionPayload.orderText).toContain('【发射中心模块扩建令】');
    expect(actionPayload.orderText).toContain('3# 百米级超重型机械臂捕获塔架');
  });
});
