/**
 * buildingSystemLiveModelV2.test.ts —— FD-39 (PKG-A) 建筑面板体系 2.0 实况沙盘数据模型、多实例坐标/addons 聚合、电网收支账本与防区指令测试
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Schema } from '../../红警指挥系统/core/schema';
import { buildBuildingOverviewModel } from '../models/buildingSystemModel';
import {
  buildSectorActionOrder,
  resolveFacilityCoordBadge,
  resolveFacilityInstanceCoordBadges,
  triggerSectorActionOrder,
} from '../modals/modalBuildingsHelpers';

const mockFillHostSendInput = vi.fn(() => 'chat_input');
const mockToastSuccess = vi.fn();

vi.mock('../../红警指挥系统/worldbook/hostSendInput', () => ({
  fillHostSendInput: (...args: unknown[]) => mockFillHostSendInput(...args),
}));

vi.mock('toastr', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    warning: vi.fn(),
    error: vi.fn(),
  },
}));

const MOCK_CATALOG = {
  buildings: [
    { name: '盟军建造厂', cost: 2500, power: 0, desc: '盟军基地核心', tags: ['军工'], prereqs: [], need_buildings: [], research: null },
    { name: '苏联建造厂', cost: 2500, power: 0, desc: '苏联基地核心', tags: ['军工'], prereqs: [], need_buildings: [], research: null },
    { name: '盟军发电厂', cost: 800, power: -200, desc: '盟军基础供电', tags: ['工业'], prereqs: [], need_buildings: ['盟军建造厂'], research: null },
    { name: '盟军战车工厂', cost: 2000, power: 100, desc: '装甲总装', tags: ['军工'], prereqs: [], need_buildings: ['盟军建造厂'], research: null },
    { name: '光棱塔', cost: 1200, power: 75, desc: '光学点防', tags: ['防御'], prereqs: [], need_buildings: ['盟军发电厂'], research: null },
  ],
};

describe('FD-39 PKG-A · 建筑体系 2.0 实况沙盘模型、多实例坐标/addons 聚合、电网收支账本与防区指令', () => {
  beforeEach(() => {
    mockFillHostSendInput.mockClear();
    mockToastSuccess.mockClear();
  });

  it('1. 同名多座建筑（2 座已建 + 1 座在建 盟军发电厂）的 instanceOrdinal、resolveFacilityInstanceCoordBadges、liveSandbox.blips 与 powerLedger', () => {
    const snap = Schema.parse({
      bases: [
        {
          id: 'base-alpha',
          name: '一号主基地',
          status: '运转中',
          power: { gen: 450, use: 100 },
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '盟军发电厂', state: '运转', layer: '地表层', coord: { x: -2, y: 1 } },
            { name: '盟军发电厂', state: '运转', layer: '地下层', coord: { x: 2, y: -1 } },
            { name: '盟军发电厂', state: '建造中', layer: '地下层', progress: 60, eta: '余2日', coord: { x: 0, y: 2 } },
            { name: '盟军战车工厂', state: '运转', layer: '地表层', coord: { x: 4, y: 0 } },
          ],
        },
      ],
    });

    const overview = buildBuildingOverviewModel(snap, MOCK_CATALOG, { scope: 'base', activeBaseIndex: 0 });
    expect(overview.totalBuiltCount).toBe(4);

    const powerFac = overview.systems.industry.builtList.find(f => f.name === '盟军发电厂')!;
    expect(powerFac.count).toBe(2);
    expect(powerFac.buildingCount).toBe(1);
    expect(powerFac.instances.map(i => i.instanceOrdinal)).toEqual([1, 2]);
    expect(powerFac.allInstances?.map(i => i.instanceOrdinal)).toEqual([1, 2, 3]);
    expect(powerFac.totalPowerGen).toBe(400);

    const primaryBadge = resolveFacilityCoordBadge(powerFac, snap);
    expect(primaryBadge.badgeText).toBe('◆ 内环 · 西北·220m (-2,+1)');

    const instBadges = resolveFacilityInstanceCoordBadges(powerFac, snap);
    expect(instBadges.length).toBe(3);
    expect(instBadges[0]?.instanceOrdinal).toBe(1);
    expect(instBadges[0]?.badgeText).toBe('◆ 内环 · 西北·220m (-2,+1)');
    expect(instBadges[1]?.instanceOrdinal).toBe(2);
    expect(instBadges[1]?.badgeText).toBe('◆ 内环 · 东南·220m (+2,-1)');
    expect(instBadges[1]?.layer).toBe('地下层');
    expect(instBadges[2]?.instanceOrdinal).toBe(3);
    expect(instBadges[2]?.state).toBe('建造中');
    expect(instBadges[2]?.progress).toBe(60);
    expect(instBadges[2]?.eta).toBe('余2日');

    expect(overview.liveSandbox.allInstances.length).toBe(5);
    expect(overview.liveSandbox.underConstructionInstances.length).toBe(1);
    expect(overview.liveSandbox.blips.length).toBe(5);
    const buildingBlip = overview.liveSandbox.blips.find(b => b.instance.state === '建造中')!;
    expect(buildingBlip.color).toBe('#fbbf24');
    expect(buildingBlip.ring).toBe('inner');

    const { powerLedger } = overview.liveSandbox;
    expect(powerLedger.totalCatalogGen).toBe(450);
    expect(powerLedger.totalCatalogUse).toBe(100);
    expect(powerLedger.reportedGen).toBe(450);
    expect(powerLedger.reportedUse).toBe(100);
    expect(powerLedger.net).toBe(350);
    expect(powerLedger.generators.map(g => `${g.instanceLabel}:${g.gen}`)).toEqual([
      '盟军发电厂 #1:200',
      '盟军发电厂 #2:200',
      '盟军建造厂 #1:50',
    ]);
    expect(powerLedger.consumers.map(c => `${c.instanceLabel}:${c.use}`)).toEqual(['盟军战车工厂 #1:100']);
  });

  it('2. 多 MCV 同址合署（盟军建造厂 + 苏联建造厂）在 liveSandbox.conyardHubs 与 powerLedger.generators 中的精确体现', () => {
    const snap = Schema.parse({
      bases: [
        {
          id: 'base-joint',
          name: '合署中枢基地',
          status: '运转中',
          power: { gen: 100, use: 0 },
          buildings: [
            { name: '盟军建造厂', state: '运转', mode: '生产', layer: '地表层' },
            { name: '苏联建造厂', state: '运转', mode: '加速', layer: '地表层' },
          ],
        },
      ],
    });

    const overview = buildBuildingOverviewModel(snap, MOCK_CATALOG, { scope: 'base', activeBaseIndex: 0 });
    expect(overview.liveSandbox.conyardHubs).toEqual([
      {
        name: '盟军建造厂',
        faction: 'allied',
        factionLabel: '盟军',
        state: '运转',
        mode: '生产',
        layer: '地表层',
        powerGen: 50,
      },
      {
        name: '苏联建造厂',
        faction: 'soviet',
        factionLabel: '苏联',
        state: '运转',
        mode: '加速',
        layer: '地表层',
        powerGen: 50,
      },
    ]);
    expect(overview.liveSandbox.ringCounts.core).toBe(2);
    expect(overview.liveSandbox.powerLedger.generators.map(g => `${g.name}:+${g.gen}W`)).toEqual([
      '盟军建造厂:+50W',
      '苏联建造厂:+50W',
    ]);
    expect(overview.liveSandbox.powerLedger.totalCatalogGen).toBe(100);
  });

  it('3. 实例级 building.addons（如 ["智能电网潮流调度中心"]）自动合并至 instance.addons 与 fac.mountedAddons', () => {
    const snap = Schema.parse({
      bases: [
        {
          id: 'base-addon',
          name: '电网示范基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '盟军发电厂', state: '运转', addons: ['智能电网潮流调度中心', '超导储能模组'] },
            { name: '盟军发电厂', state: '运转', addons: ['智能电网潮流调度中心'] },
          ],
        },
      ],
    });

    const overview = buildBuildingOverviewModel(snap, MOCK_CATALOG, { scope: 'base', activeBaseIndex: 0 });
    const powerFac = overview.systems.industry.builtList.find(f => f.name === '盟军发电厂')!;
    expect(powerFac.instances[0]?.addons).toEqual(['智能电网潮流调度中心', '超导储能模组']);
    expect(powerFac.instances[1]?.addons).toEqual(['智能电网潮流调度中心']);
    expect(powerFac.mountedAddons).toContain('智能电网潮流调度中心');
    expect(powerFac.mountedAddons).toContain('超导储能模组');
    expect(powerFac.mountedAddons?.filter(x => x === '智能电网潮流调度中心').length).toBe(1);

    const badges = resolveFacilityInstanceCoordBadges(powerFac, snap);
    expect(badges[0]?.addons).toEqual(['智能电网潮流调度中心', '超导储能模组']);
  });

  it('4. Base.sectors 分层解析、同层建筑关联 coLocatedBuildings、layerGroups 及 buildSectorActionOrder 指令生成', () => {
    const snap = Schema.parse({
      bases: [
        {
          id: 'base-sec',
          name: '青岚山北坡基地',
          status: '运转中',
          sectors: [
            { name: '洞口防红外伪装网', layer: '地表层', status: '正常', desc: '全波段红外与光学伪装屏蔽' },
            { name: '深层核电主空腔', layer: '地下层', status: '受损', desc: '花岗岩加固掩体，东壁局部渗水受损' },
            { name: '半山腰排风竖井', layer: '掩体入口', status: '施工中', desc: '三防过滤与热废气流散通道' },
          ],
          buildings: [
            { name: '盟军建造厂', state: '运转', layer: '地表层' },
            { name: '光棱塔', state: '运转', layer: '地表层' },
            { name: '盟军发电厂', state: '运转', layer: '地下层' },
          ],
        },
      ],
      queues: [
        {
          type: '建造',
          item: '盟军战车工厂',
          base: 'base-sec',
          progress: 45,
          status: 'active',
        },
      ],
    });

    const overview = buildBuildingOverviewModel(snap, MOCK_CATALOG, { scope: 'base', activeBaseIndex: 0 });
    const { sectors, layerGroups, availableLayers, underConstructionInstances } = overview.liveSandbox;

    expect(underConstructionInstances.length).toBe(1);
    expect(underConstructionInstances[0]?.name).toBe('盟军战车工厂');
    expect(underConstructionInstances[0]?.buildingIndex).toBe(-1);

    expect(sectors.length).toBe(3);
    expect(sectors[0]?.statusTone).toBe('ok');
    expect(sectors[0]?.coLocatedBuildings).toEqual(['盟军建造厂', '光棱塔']);
    expect(sectors[1]?.statusTone).toBe('danger');
    expect(sectors[1]?.coLocatedBuildings).toEqual(['盟军发电厂']);
    expect(sectors[2]?.statusTone).toBe('warn');

    expect(availableLayers).toContain('地表层');
    expect(availableLayers).toContain('地下层');
    expect(availableLayers).toContain('掩体入口');
    const surfaceGroup = layerGroups.find(g => g.layerName === '地表层')!;
    expect(surfaceGroup.sectors.length).toBe(1);
    expect(surfaceGroup.instances.length).toBe(2);
    expect(surfaceGroup.runningCount).toBe(2);

    const reinforceOrder = buildSectorActionOrder(
      '青岚山北坡基地',
      { name: '洞口防红外伪装网', layer: '地表层', status: '正常' },
      'reinforce',
    );
    expect(reinforceOrder).toBe('【指挥官战术指令】加固并扩建基地防区：洞口防红外伪装网（层级: 地表层） 基地: 青岚山北坡基地');

    const repairOrder = buildSectorActionOrder(
      '青岚山北坡基地',
      { name: '深层核电主空腔', layer: '地下层', status: '受损' },
      'repair',
    );
    expect(repairOrder).toBe('【指挥官战术指令】紧急抢修受损防区工程：深层核电主空腔 基地: 青岚山北坡基地');

    const createOrder = buildSectorActionOrder('青岚山北坡基地', undefined, 'create');
    expect(createOrder).toBe(
      '【指挥官战术指令】在「青岚山北坡基地」规划开辟新空间防区与环境工程（请参谋部结合当前基地地形提交防区改造方案）',
    );

    triggerSectorActionOrder('青岚山北坡基地', { name: '深层核电主空腔', layer: '地下层' }, 'repair');
    expect(mockFillHostSendInput).toHaveBeenCalledWith(repairOrder);
    expect(mockToastSuccess).toHaveBeenCalled();
  });
});
