import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCatalogStore } from '../../红警指挥系统/composables/useCatalog';
import { detail, openLookup } from '../../红警指挥系统/composables/useDetail';
import { Schema } from '../../红警指挥系统/core/schema';
import { buildBuildingOverviewModel } from '../models/buildingSystemModel';
import {
  buildProjectDetailPayload,
  resolveRetrofitTargetPreview,
} from '../modals/modalEngineeringHelpers';

describe('FD-22 Track D (BLD-MOD-MODAL-01): 建筑模态框母体升级/挂件收纳、工程改装预览与详情抽屉联动', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { search: '' } });
    setActivePinia(createPinia());
  });

  it('1. buildBuildingOverviewModel：母体建筑自动聚合原位升阶项（补差价）、可挂载扩建模块与已挂载挂件收纳', () => {
    const snap = Schema.parse({
      bases: [
        {
          id: 'base_1',
          name: '第一基地',
          status: '运转中',
          buildings: [
            { name: '苏联建造厂', state: '运转' },
            { name: '苏联战车工厂', state: '运转' },
            { name: '天启超重总装跨', state: '运转' },
            { name: '光棱塔', state: '运转' },
          ],
        },
      ],
      tech: {
        done: ['重型机械化自动装配学', '超重型装甲突破总成', '高能聚焦光学防卫理论'],
      },
    });

    const mockCatalog = {
      buildings: [
        { name: '苏联战车工厂', cost: 2000, power: 100, desc: '战车工厂', tags: ['工业'] },
        {
          name: '扩大版自动化战车工厂',
          cost: 3500,
          power: 200,
          research: '重型机械化自动装配学',
          standalone: true,
          host_building: ['战车工厂', '盟军战车工厂', '苏联战车工厂'],
          upgrade_mode: 'replace' as const,
          desc: '高阶战车工厂',
          tags: ['工业'],
        },
        {
          name: '天启超重总装跨',
          cost: 1500,
          power: 120,
          research: '超重型装甲突破总成',
          standalone: false,
          host_building: ['苏联战车工厂', '战车工厂'],
          upgrade_mode: 'addon' as const,
          desc: '天启挂件',
          tags: ['工业'],
        },
        { name: '光棱塔', cost: 1200, power: 75, desc: '光棱防御', tags: ['防御'] },
        {
          name: '先进光棱塔升级',
          cost: 400,
          power: 35,
          research: '高能聚焦光学防卫理论',
          standalone: false,
          host_building: '光棱塔',
          upgrade_mode: 'replace' as const,
          upgraded_name: '先进光棱塔',
          desc: '光棱塔原位升级包',
          tags: ['防御'],
        },
      ],
    };

    const overview = buildBuildingOverviewModel(snap, mockCatalog, { scope: 'base', activeBaseIndex: 0 });

    // 1a. 天启超重总装跨已被收纳进母体「苏联战车工厂」的 mountedAddons，不再在顶层 allBuiltFacilities 重复单列
    const wfFac = overview.allBuiltFacilities.find(f => f.name === '苏联战车工厂');
    expect(wfFac).toBeDefined();
    expect(wfFac?.mountedAddons).toContain('天启超重总装跨');
    expect(overview.allBuiltFacilities.some(f => f.name === '天启超重总装跨')).toBe(false);

    // 1b. 苏联战车工厂的跨代替换升级项「扩大版自动化战车工厂」自动计算补差价 3500 - 2000 = 1500
    const wfUpg = wfFac?.upgradeOptions?.find(u => u.name === '扩大版自动化战车工厂');
    expect(wfUpg).toBeDefined();
    expect(wfUpg?.deltaCost).toBe(1500);
    expect(wfUpg?.standalone).toBe(true);

    // 1c. 光棱塔的原位升阶包「先进光棱塔升级」显示升级后正式名称「先进光棱塔」及升级包费用 400
    const prismFac = overview.allBuiltFacilities.find(f => f.name === '光棱塔');
    expect(prismFac).toBeDefined();
    const prismUpg = prismFac?.upgradeOptions?.find(u => u.name === '先进光棱塔升级');
    expect(prismUpg).toBeDefined();
    expect(prismUpg?.displayName).toBe('先进光棱塔');
    expect(prismUpg?.deltaCost).toBe(400);
  });

  it('2. modalEngineeringHelpers：解析 V1 现代化改装工程的改装对象与完工后高级型号', () => {
    const previewUnit = resolveRetrofitTargetPreview({
      kind: 'retrofit',
      name: 'M1A2 SEPv3灰熊混动改装工程',
      cost: 1500,
      research: 'M1A2 SEPv3灰熊混动改装包',
      grade: '小改',
      scope: 'base',
      desc: '灰熊混动改装',
    });
    expect(previewUnit).toEqual({
      targetLabel: 'M1A1灰熊主战坦克',
      upgradedLabel: 'M1A2 SEPv3混动灰熊主战坦克',
      isBuildingRetrofit: false,
    });

    const detailPayload = buildProjectDetailPayload(
      {
        id: 'proj_1',
        ref: 'M1A2 SEPv3灰熊混动改装工程',
        scope: 'base',
        bases: ['base_1'],
        lead_base: 'base_1',
        grade: '小改',
        status: '在建',
        phases: [{ idx: 0, name: '换装', status: '进行中', queue_index: null }],
        outcome: { type: 'mark' },
        schema_version: 1,
      },
      'M1A2 SEPv3灰熊混动改装工程',
      {
        kind: 'retrofit',
        name: 'M1A2 SEPv3灰熊混动改装工程',
        cost: 1500,
        research: 'M1A2 SEPv3灰熊混动改装包',
        grade: '小改',
        scope: 'base',
        desc: '灰熊混动改装',
      },
      [{ id: 'base_1', name: '第一基地' }],
    );
    expect(detailPayload.params).toContainEqual(['改装对象', 'M1A1灰熊主战坦克']);
    expect(detailPayload.params).toContainEqual(['升级后型号', 'M1A2 SEPv3混动灰熊主战坦克']);
  });

  it('3. useDetail.openLookup：支持按现代改高级型号名反查基础单位档案并保留高级型号下达标题', () => {
    const catalog = useCatalogStore();
    catalog.productions.push({
      name: 'M1A1灰熊主战坦克',
      cost: 700,
      need_building: '盟军战车工厂',
      prereqs: ['复合装甲与主战坦克工程'],
      desc: '盟军主力主战坦克',
    });
    catalog.buildings.push({
      name: '先进光棱塔升级',
      cost: 400,
      power: 35,
      research: '高能聚焦光学防卫理论',
      standalone: false,
      host_building: '光棱塔',
      upgrade_mode: 'replace',
      upgraded_name: '先进光棱塔',
      desc: '光棱塔升阶包',
    });

    openLookup('M1A2 SEPv3混动灰熊主战坦克', []);
    expect(detail.open).toBe(true);
    expect(detail.data?.title).toBe('M1A2 SEPv3混动灰熊主战坦克');
    expect(detail.data?.kind).toBe('生产');
    expect(detail.data?.params).toContainEqual(['基础原型', 'M1A1灰熊主战坦克']);
    expect(detail.data?.params).toContainEqual(['现代改套件', 'M1A2 SEPv3灰熊混动改装工程']);

    openLookup('先进光棱塔升级', []);
    expect(detail.data?.kind).toBe('建筑');
    expect(detail.data?.params).toContainEqual(['部署类型', '原位升阶替换包']);
    expect(detail.data?.params).toContainEqual(['附着母体', '光棱塔']);
    expect(detail.data?.params).toContainEqual(['升级后型号', '先进光棱塔']);
  });
});
