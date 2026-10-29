import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setCachedDynamicCatalog } from '../composables/useCatalog';
import { Schema } from '../core/schema';
import {
  STARTER_HUMAN_ROSTER_NAMES,
  STARTER_MAIDEN_NAMES,
} from '../parse/parseDomainAppliers';
import { parseMessageText } from '../parse/parsePipeline';
import type { ParsedWorldbookCatalog } from '../../中控悬浮窗/models/worldbookCatalogParser';

function createMockStandardCatalog(): ParsedWorldbookCatalog {
  return {
    researches: [
      {
        id: 'tech_armor',
        name: '装甲载具工学',
        line: '装甲工业线',
        tier: 1,
        cost_credits: 1000,
        duration_days: 2,
        prerequisites: [],
        unlocks: ['灰熊坦克', '犀牛坦克'],
        description: '基础履带装甲战车制造技术。',
      },
    ],
    buildings: [
      {
        id: 'bld_wf',
        name: '盟军战车工厂',
        category: '生产',
        faction: '盟军',
        cost_credits: 2000,
        power_delta: -50,
        duration_days: 2,
        prerequisites: [],
        description: '生产盟军装甲载具。',
      },
    ],
    productions: [
      {
        id: 'unit_grizzly',
        name: '灰熊坦克',
        category: '装甲',
        faction: '盟军',
        cost_credits: 700,
        duration_days: 1,
        lane: '战车工厂',
        prerequisites: [],
        description: '盟军标准主战坦克。',
      },
      {
        id: 'unit_rhino',
        name: '犀牛坦克',
        category: '装甲',
        faction: '苏联',
        cost_credits: 900,
        duration_days: 1,
        lane: '战车工厂',
        prerequisites: [],
        description: '苏军标准重型主战坦克。',
      },
      {
        id: 'unit_conscript',
        name: '动员兵',
        category: '步兵',
        faction: '苏联',
        cost_credits: 100,
        duration_days: 1,
        lane: '兵营',
        prerequisites: [],
        description: '苏军基础步兵班组。',
      },
    ],
    retrofits: [],
    projects: [],
    protocols: [],
    warnings: [],
    errors: [],
  } as unknown as ParsedWorldbookCatalog;
}

describe('FD-49 PKG-C · 解析层防乱写拦截扩围（已入册机娘/随行人员/标准单位局部改装后缀）', () => {
  beforeEach(() => {
    setCachedDynamicCatalog(createMockStandardCatalog());
  });

  afterEach(() => {
    setCachedDynamicCatalog(null);
  });

  it('1. 常量集合完整性：导出 STARTER_MAIDEN_NAMES 与 STARTER_HUMAN_ROSTER_NAMES', () => {
    expect([...STARTER_MAIDEN_NAMES]).toEqual([
      '白凌',
      '喀秋莎',
      '尤里卡',
      '凛冬妮娅',
      '妮娅',
      '薇拉',
    ]);
    expect([...STARTER_HUMAN_ROSTER_NAMES]).toEqual([
      '萧栖雪',
      '杜月欣',
      '陆玉凝',
      '林晚',
      '苏晓',
    ]);
  });

  it('2. 拦截把已在册核心机娘塞进 <图鉴> 或 <扩展档案>：不进 pending_lore / pending_expansions 并记录 green 审计事件', () => {
    const baseline = Schema.parse({
      codex: [
        {
          name: '白凌',
          kind: '人员',
          desc: '盟军MCV核心副官',
          params: { 阵营: '盟军', 型号: 'MCV' },
        },
      ],
    });

    const raw = `
<图鉴>
- 名称: 白凌
  类别: 人员
  简介: 试图在图鉴中重复建档白凌
- 名称: 凛冬妮娅
  类别: 人物
  简介: 试图在图鉴中建档凛冬妮娅
</图鉴>
<扩展档案>
- 名称: 喀秋莎
  类别: 人员
  简介: 试图在扩展档案中重复建档喀秋莎
  设定: 苏联MCV首席机娘。
- 名称: 尤里卡
  类别: 人物
  简介: 试图以人物类别在扩展档案中建档尤里卡
  设定: 尤里MCV机娘。
</扩展档案>
`;

    const res = parseMessageText(raw, baseline);
    expect(res.applied).toBe(true);
    expect(res.quarantine).toEqual([]);
    expect(res.data.pending_lore).toEqual([]);
    expect(res.data.pending_expansions).toEqual([]);
    // 原有 codex 中的白凌保持完好，且未新增凛冬妮娅/喀秋莎/尤里卡
    expect(res.data.codex).toHaveLength(1);
    expect(res.data.codex[0].name).toBe('白凌');
    expect(res.data.codex[0].desc).toBe('盟军MCV核心副官');

    for (const maidenName of ['白凌', '凛冬妮娅', '喀秋莎', '尤里卡']) {
      expect(
        res.events.some(
          e =>
            e.light === '🟢' &&
            e.message ===
              `[扩展档案/图鉴] 「${maidenName}」属于已在册核心机娘，日常状态变动请走 <机娘> 标签，跳过重复建档`,
        ),
      ).toBe(true);
    }
  });

  it('3. 拦截对开局随行人类人员（STARTER_HUMAN_ROSTER_NAMES）按 类别: 人员 无动态关系增量重复初建档案；有动态关系字段时仅更新 codex.params 不进 pending_expansions', () => {
    const baseline = Schema.parse({
      codex: [
        {
          name: '萧栖雪',
          kind: '人员',
          desc: '指挥官贴身战术保镖',
          params: {
            席位任命: '近卫统领',
            随行渊源: '旧识护卫',
            态度: '合作',
            信任度: '70',
          },
        },
        {
          name: '杜月欣',
          kind: '人员',
          desc: '精明干练的后勤主管',
          params: {
            席位任命: '后勤总管',
            态度: '友善',
            信任度: '65',
          },
        },
      ],
    });

    // 场景 A：萧栖雪以 类别: 人员 被重复输出静态初设（无信任变化/态度/近期交集）-> 直接拦截跳过
    // 场景 B：杜月欣以 类别: 人员 输出但附带 信任变化/态度/近期交集 -> 更新 codex.params，但不塞入 pending_expansions
    const raw = `
<扩展档案>
- 名称: 萧栖雪
  类别: 人员
  简介: 被 LLM 当成新兵种重复初建的萧栖雪
  设定: 冗余初设段落。
- 名称: 杜月欣
  类别: 人员
  态度: 效忠
  信任变化: +15
  近期交集: 连夜统筹北坡防寒物资调配，对指挥官愈发信服。
</扩展档案>
`;

    const res = parseMessageText(raw, baseline);
    expect(res.applied).toBe(true);
    expect(res.quarantine).toEqual([]);
    // 两者均不得作为未入档量产兵种进入 pending_expansions
    expect(res.data.pending_expansions).toEqual([]);

    const xiao = res.data.codex.find(c => c.name === '萧栖雪');
    expect(xiao).toBeDefined();
    expect(xiao?.desc).toBe('指挥官贴身战术保镖');
    expect(xiao?.params['信任度']).toBe('70');

    const du = res.data.codex.find(c => c.name === '杜月欣');
    expect(du).toBeDefined();
    expect(du?.params['态度']).toBe('效忠');
    expect(du?.params['信任度']).toBe('80'); // 65 + 15
    expect(du?.params['信任变化']).toBe('+15');
    expect(du?.params['近期交集']).toContain('连夜统筹北坡防寒物资调配');
    // 原有席位任命保留
    expect(du?.params['席位任命']).toBe('后勤总管');
  });

  it('4. 拦截世界书标准单位加简单括号/分隔符改装后缀冒充新单位（如 灰熊坦克（战地加挂版）、动员兵·雪地型），引导走 <数据更新>', () => {
    const baseline = Schema.parse({});
    const raw = `
<扩展档案>
- 名称: 灰熊坦克（战地加挂版）
  类别: 载具
  简介: 加挂外置推土铲与反应装甲的灰熊坦克。
  设定: 在标准灰熊坦克车体前部焊装战地推土铲。
- 名称: 动员兵·雪地型
  类别: 人员
  简介: 配发白色伪装斗篷与防冻靴的动员兵。
  设定: 针对极寒战区适应性改装的动员兵班组。
- 名称: 犀牛坦克(复合装甲型)
  类别: 载具
  简介: 换装复合装甲插板的犀牛坦克。
  设定: 局部装甲强化版本。
- 名称: 极北雪原重型破冰钻探车
  类别: 载具
  简介: 北坡矿务局遗留的巨型特种热融钻探工程车。
  设定: 全新原创特种非标工程载具。
</扩展档案>
`;

    const res = parseMessageText(raw, baseline);
    expect(res.applied).toBe(true);
    expect(res.quarantine).toEqual([]);

    // 3 个标准单位局部改装版被全部拦截，仅真正原创的「极北雪原重型破冰钻探车」进入 pending_expansions
    expect(res.data.pending_expansions).toHaveLength(1);
    expect(res.data.pending_expansions[0].name).toBe('极北雪原重型破冰钻探车');

    expect(
      res.events.some(
        e =>
          e.light === '🟢' &&
          e.path === '扩展档案.灰熊坦克（战地加挂版）' &&
          e.message ===
            '[扩展档案] 「灰熊坦克（战地加挂版）」基底属于世界书既有载具「灰熊坦克」，局部改装请走 <数据更新>，跳过重复建档',
      ),
    ).toBe(true);

    expect(
      res.events.some(
        e =>
          e.light === '🟢' &&
          e.path === '扩展档案.动员兵·雪地型' &&
          e.message ===
            '[扩展档案] 「动员兵·雪地型」基底属于世界书既有人员「动员兵」，局部改装请走 <数据更新>，跳过重复建档',
      ),
    ).toBe(true);

    expect(
      res.events.some(
        e =>
          e.light === '🟢' &&
          e.path === '扩展档案.犀牛坦克(复合装甲型)' &&
          e.message ===
            '[扩展档案] 「犀牛坦克(复合装甲型)」基底属于世界书既有载具「犀牛坦克」，局部改装请走 <数据更新>，跳过重复建档',
      ),
    ).toBe(true);
  });

  it('5. 当 LLM 在一级 <机娘> 标签中附带 special_skills 与 special_equipment（主副武器）时，自动兜底桥接同步至 pending_lore 写入世界书 <数据> 块', () => {
    const baseline = Schema.parse({
      forces: {
        troops: {},
        vehicles: [],
        girls: [
          {
            name: '待授名·犀牛-02',
            serial: '犀牛-02',
            model: '犀牛主战坦克',
            hp: '完好',
          },
        ],
      },
    });

    const raw = `
<机娘>
- 名称: 赤星
  原名: 待授名·犀牛-02
  编号: 犀牛-02
  型号: 犀牛主战坦克
  阵营: 苏联
  形态机制: 纳米武装展开与载具完全体切换
  special_skills:
    - name: 滑膛极限过载连射
      kind: 核心权能
      desc: 短时超频装弹机倾泻高穿深穿甲弹幕。
  special_equipment:
    - name: 125mm高膛压纳米滑膛炮
      slot: 主武器
      desc: 集成激光测距火控的坦克主炮。
    - name: PKT同轴机枪与反应装甲披风
      slot: 副武器
      desc: 近距压制与破甲偏折副武器套件。
</机娘>
`;

    const res = parseMessageText(raw, baseline);
    expect(res.applied).toBe(true);
    expect(res.quarantine).toEqual([]);
    expect(res.data.forces?.girls?.[0]?.name).toBe('赤星');
    expect(res.data.pending_lore).toHaveLength(1);
    const lore = res.data.pending_lore[0] as Record<string, any>;
    expect(lore.name).toBe('赤星');
    expect(lore.special_skills).toEqual([
      {
        name: '滑膛极限过载连射',
        kind: '核心权能',
        desc: '短时超频装弹机倾泻高穿深穿甲弹幕。',
      },
    ]);
    expect(lore.special_equipment).toEqual([
      {
        name: '125mm高膛压纳米滑膛炮',
        slot: '主武器',
        desc: '集成激光测距火控的坦克主炮。',
      },
      {
        name: 'PKT同轴机枪与反应装甲披风',
        slot: '副武器',
        desc: '近距压制与破甲偏折副武器套件。',
      },
    ]);
  });

  it('6. 当 LLM 在 <扩展档案> 顶层平铺全新科技/载具/人员机制字段或漏填工期时，自动零隔离收拢进 params 并从同轮队列桥接补齐工期', () => {
    const baseline = Schema.parse({
      queues: [
        {
          type: '研究',
          item: '相控阵激光折射学',
          base: '1号主基地',
          progress: 25,
          eta: '3日',
        },
      ],
    });

    const raw = `
<扩展档案>
- 名称: 相控阵激光折射学
  类别: 科技
  简介: 多棱镜固态激光相控阵聚焦与大气热晕补偿理论。
  造价: 1500
  科技层级: T2
  研究线: 盟军特色
  所需建筑: 盟军战斗实验室
  前置科技: 高能激光学
  解锁产物: 棱镜折射巡洋车
  设定: |
    相控阵激光折射学解决了高湿度山地环境下激光束长距散射衰减难题。
  触发词: [相控阵激光折射学]
- 名称: 棱镜折射巡洋车
  类别: 载具
  简介: 搭载折返式相控阵反射镜的伴随支援载具。
  造价: 1300
  工期: 2日
  科技层级: T2
  所属阵营: 盟军
  生产建筑: 盟军战车工厂
  前置科技: 相控阵激光折射学
  主武器: 双波段相控阵激光发射器
  副武器: 近防烟幕弹射器
  战术特长: 光束中继折射, 视野压制
  设定: |
    棱镜折射巡洋车作为光棱集群的移动端节点，可将后方光棱塔的主光束折射入掩体死角。
  触发词: [棱镜折射巡洋车]
</扩展档案>
`;

    const res = parseMessageText(raw, baseline);
    expect(res.applied).toBe(true);
    expect(res.quarantine).toEqual([]);
    expect(res.data.pending_expansions).toHaveLength(2);

    const techExp = res.data.pending_expansions.find(e => e.name === '相控阵激光折射学')!;
    expect(techExp.params).toMatchObject({
      造价: '1500',
      工期: '3日', // 从 baseline.queues 同名项目自动桥接补齐
      科技层级: 'T2',
      研究线: '盟军特色',
      所需建筑: '盟军战斗实验室',
      前置科技: '高能激光学',
      解锁产物: '棱镜折射巡洋车',
    });

    const vehicleExp = res.data.pending_expansions.find(e => e.name === '棱镜折射巡洋车')!;
    expect(vehicleExp.params).toMatchObject({
      造价: '1300',
      工期: '2日',
      科技层级: 'T2',
      所属阵营: '盟军',
      生产建筑: '盟军战车工厂',
      前置科技: '相控阵激光折射学',
      主武器: '双波段相控阵激光发射器',
      副武器: '近防烟幕弹射器',
      战术特长: '光束中继折射, 视野压制',
    });
  });
});
