import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import { parseMessageText } from '../parse/parsePipeline';

describe('baseLifecycleAndSectorsParse · 基地防区词条、原位更名级联与多座同名建筑并存测试 (FD-38 PKG-A)', () => {
  it('旧档零新增键契约：未声明 sectors 的基地经 Schema.parse 与 <态势> 解析后不注入空 sectors 键', () => {
    const baseline = Schema.parse({
      bases: [
        {
          id: '1号主基地',
          name: '1号主基地',
          location: '恶土东裂隙转运库',
          status: '运转中',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
    });

    expect('sectors' in baseline.bases[0]).toBe(false);

    const res = parseMessageText(
      `<态势>\n基地:\n  - 名称: 1号主基地\n    状态: 运转中\n</态势>`,
      baseline,
    );
    expect(res.quarantine).toHaveLength(0);
    expect('sectors' in res.data.bases[0]).toBe(false);
  });

  it('Base.sectors 解析：支持字符串数组简写与对象数组，并按 canon(name) 增量合并去重', () => {
    const baseline = Schema.parse({
      bases: [
        {
          id: '1号主基地',
          name: '1号主基地',
          location: '恶土东裂隙转运库',
          status: '运转中',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
    });

    const floor1 = parseMessageText(
      `<态势>
基地:
  - 名称: 1号主基地
    防区:
      - 洞口防红外伪装网与探针阵线
      - 半山腰排风竖井管网（地下层·正常）
    环境工程:
      - 名称: 山崖凹槽 C-5M 隐蔽机坪
        层级: 山体掩体
        状态: 施工中
        描述: 利用天然岩壁凹槽隐藏战略运输机
</态势>`,
      baseline,
    );

    expect(floor1.quarantine).toHaveLength(0);
    const sectors1 = floor1.data.bases[0].sectors;
    expect(sectors1).toBeDefined();
    expect(sectors1).toHaveLength(3);
    expect(sectors1).toEqual([
      {
        name: '洞口防红外伪装网与探针阵线',
        layer: '',
        status: '正常',
        desc: '',
      },
      {
        name: '半山腰排风竖井管网',
        layer: '地下层',
        status: '正常',
        desc: '',
      },
      {
        name: '山崖凹槽 C-5M 隐蔽机坪',
        layer: '山体掩体',
        status: '施工中',
        desc: '利用天然岩壁凹槽隐藏战略运输机',
      },
    ]);

    // 下一楼增量更新既有防区状态并追加新基础设施
    const floor2 = parseMessageText(
      `<态势>
基地:
  - 名称: 1号主基地
    子区域:
      - 名称: 山崖凹槽 C-5M 隐蔽机坪
        状态: 正常
      - 东侧石渠深层活水取水点（地下层·正常）
</态势>`,
      floor1.data,
    );

    expect(floor2.quarantine).toHaveLength(0);
    const sectors2 = floor2.data.bases[0].sectors!;
    expect(sectors2).toHaveLength(4);
    const airfield = sectors2.find(s => s.name === '山崖凹槽 C-5M 隐蔽机坪');
    expect(airfield).toEqual({
      name: '山崖凹槽 C-5M 隐蔽机坪',
      layer: '山体掩体',
      status: '正常',
      desc: '利用天然岩壁凹槽隐藏战略运输机',
    });
    expect(sectors2.find(s => s.name === '东侧石渠深层活水取水点')).toEqual({
      name: '东侧石渠深层活水取水点',
      layer: '地下层',
      status: '正常',
      desc: '',
    });
  });

  it('基地原位更名与级联同步：已展开的 1号主基地 赋予正式名称（单基地同址演进 & 显式原名称锚定）时原位更新并同步 queues/girls/chains/projects', () => {
    const baseline = Schema.parse({
      bases: [
        {
          id: '1号主基地',
          name: '1号主基地',
          location: '恶土东裂隙转运库',
          status: '运转中',
          power: { gen: 50, use: 0 },
          buildings: [{ name: '盟军建造厂', layer: '地下层', state: '运转' }],
        },
      ],
      queues: [
        {
          type: '建造',
          item: '盟军发电厂',
          base: '1号主基地',
          progress: 40,
          eta: '余1日',
          status: 'active',
        },
      ],
      forces: {
        girls: [
          {
            name: '埃ги斯',
            model: '盟军基地车（MCV）首台',
            duty: '主基地总控',
            hp: '完好',
            base: '1号主基地',
          },
        ],
      },
      economy: {
        credits: 3000,
        chains: [
          {
            id: 'chain_salvage_01',
            name: '裂隙废金属回收链',
            flow: '收入',
            rate_daily: 300,
            status: 'active',
            deps: {
              base_id: '1号主基地',
              buildings: ['盟军建造厂'],
            },
          },
        ],
      },
      projects: [
        {
          schema_version: 2,
          id: 'proj:orbital_01',
          ref: 'all.project.orbital_shipyard',
          scope: 'base',
          bases: ['1号主基地'],
          lead_base: '1号主基地',
          grade: '巨构',
          status: '在建',
          modules: [
            {
              id: 'mod_core',
              name: '核心舱',
              status: '进行中',
              base: '1号主基地',
              queue_index: null,
            },
          ],
        },
      ],
      pending_deployments: [
        {
          vehicle: '苏联基地车',
          action: '展开',
          base: '1号主基地',
          into: '苏联建造厂',
          remaining_minutes: 120,
        },
      ],
      pending_mode_switches: [
        {
          base: '1号主基地',
          building: '盟军建造厂',
          target_mode: '加速',
          remaining_minutes: 360,
        },
      ],
    });

    // 途径 2：单基地同址演进直接赋予正式名称
    const res1 = parseMessageText(
      `<态势>
基地:
  - 名称: 东裂隙地下主基地
    位置: 恶土东裂隙深层空腔
    状态: 运转中
</态势>`,
      baseline,
    );

    expect(res1.quarantine).toHaveLength(0);
    expect(res1.data.bases).toHaveLength(1);
    expect(res1.data.bases[0].name).toBe('东裂隙地下主基地');
    expect(res1.data.bases[0].id).toBe('东裂隙地下主基地');
    expect(res1.data.bases[0].buildings).toHaveLength(1);
    expect(res1.data.queues[0].base).toBe('东裂隙地下主基地');
    expect(res1.data.forces.girls[0].base).toBe('东裂隙地下主基地');
    expect(res1.data.economy.chains[0].deps.base_id).toBe('东裂隙地下主基地');
    expect(res1.data.projects?.[0].lead_base).toBe('东裂隙地下主基地');
    expect(res1.data.projects?.[0].bases).toEqual(['东裂隙地下主基地']);
    expect(res1.data.pending_deployments?.[0].base).toBe('东裂隙地下主基地');
    expect(res1.data.pending_mode_switches?.[0].base).toBe('东裂隙地下主基地');

    // 途径 1：显式 原名称 / 曾用名 锚定再次更名（即使原名已非通用编号名）
    const res2 = parseMessageText(
      `<态势>
基地:
  - 名称: 塔尔塔罗斯地下要塞
    原名称: 东裂隙地下主基地
    状态: 运转中
</态势>`,
      res1.data,
    );

    expect(res2.quarantine).toHaveLength(0);
    expect(res2.data.bases).toHaveLength(1);
    expect(res2.data.bases[0].name).toBe('塔尔塔罗斯地下要塞');
    expect(res2.data.queues[0].base).toBe('塔尔塔罗斯地下要塞');
    expect(res2.data.forces.girls[0].base).toBe('塔尔塔罗斯地下要塞');
    expect(res2.data.economy.chains[0].deps.base_id).toBe('塔尔塔罗斯地下要塞');
  });

  it('upsertBuildings 支持同一基地内多座不同坐标（或带 #2/二号）的同名建筑并存不覆盖', () => {
    const baseline = Schema.parse({
      bases: [
        {
          id: '1号主基地',
          name: '1号主基地',
          status: '运转中',
          buildings: [
            { name: '盟军建造厂', layer: '地下层', state: '运转', coord: { x: 0, y: 0 } },
            { name: '盟军发电厂', layer: '地下层', state: '运转', coord: { x: -2, y: 1 } },
          ],
        },
      ],
    });

    // 在不同坐标 (2, -1) 增建第 2 座盟军发电厂，同时更新第 1 座的层位描述
    const res1 = parseMessageText(
      `<态势>
基地:
  - 名称: 1号主基地
    建筑:
      - 名称: 盟军发电厂
        层位: 地下层西段
        状态: 运转
        坐标: [-2, 1]
      - 名称: 盟军发电厂
        层位: 地下层东段
        状态: 运转
        坐标: [2, -1]
</态势>`,
      baseline,
    );

    expect(res1.quarantine).toHaveLength(0);
    const powerPlants = res1.data.bases[0].buildings.filter(b => b.name === '盟军发电厂');
    expect(powerPlants).toHaveLength(2);
    expect(powerPlants[0].coord).toEqual({ x: -2, y: 1 });
    expect(powerPlants[0].layer).toBe('地下层西段');
    expect(powerPlants[1].coord).toEqual({ x: 2, y: -1 });
    expect(powerPlants[1].layer).toBe('地下层东段');

    // 支持带 #3 或（三号）显式序号追加第 3 座同名建筑
    const res2 = parseMessageText(
      `<态势>
基地:
  - 名称: 1号主基地
    建筑:
      - 名称: 盟军发电厂（三号）
        层位: 地下层北段
        状态: 建造中
        进度: 50
</态势>`,
      res1.data,
    );

    expect(res2.quarantine).toHaveLength(0);
    const powerPlantsAfter = res2.data.bases[0].buildings.filter(b => b.name === '盟军发电厂');
    expect(powerPlantsAfter).toHaveLength(3);
    expect(powerPlantsAfter[2].state).toBe('建造中');
    expect(powerPlantsAfter[2].progress).toBe(50);
  });

  it('<排产计划> 委托执行（delegate_once）建造入队时同步向目标基地挂载 state: 建造中 占位建筑', () => {
    const baseline = Schema.parse({
      bases: [
        {
          id: '1号主基地',
          name: '1号主基地',
          status: '运转中',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
    });

    const res = parseMessageText(
      `<排产计划>
模式: 委托
动作:
  - 操作: 入队
    类型: 建造
    项目: 盟军发电厂
    基地: 1号主基地
    数量: 1
</排产计划>`,
      baseline,
    );

    expect(res.quarantine).toHaveLength(0);
    expect(res.data.queues.some(q => q.item === '盟军发电厂' && q.type === '建造')).toBe(true);
    const underConst = res.data.bases[0].buildings.find(
      b => b.name === '盟军发电厂' && b.state === '建造中',
    );
    expect(underConst).toBeDefined();
  });
});
