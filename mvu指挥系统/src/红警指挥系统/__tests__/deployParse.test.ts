/**
 * E3a · CTRL-DEPLOY-PARSE-01 部署块两段式解析测试（仿 dispatchParse 版型）
 * 覆盖：正例（展开现有基地/当场建新基地/收起反查回填）、块别名（部署/展开/deploy）、
 * 宽进严出各拒收分支、跳过账本直写、索引未注入 fail-closed。
 */
import { describe, expect, it } from 'vitest';
import { parseMessageText, type DeployCatalogIndexLike } from '../parse/parsePipeline';
import { Schema } from '../core/schema';

const VEHICLE_BLOCK = { into: '前沿工地', duration_min: 360, reverse: true, capacity_ratio: 0.5, deploy_limit: 1 };

function mkIndex(
  table: Record<string, typeof VEHICLE_BLOCK | undefined> = {
    前沿基地建设车: VEHICLE_BLOCK,
  },
): DeployCatalogIndexLike {
  return {
    byVehicle: name => table[name],
    byInto: name => {
      for (const [vehicle, block] of Object.entries(table)) {
        if (block && block.into === name) return { vehicle, block };
      }
      return undefined;
    },
  };
}

const mkBaseline = (buildings: string[] = ['盟军建造厂'], vehicles = ['前沿基地建设车']) =>
  Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1 },
    bases: [
      { id: '北坡主基地', name: '北坡主基地', location: '青岚山北坡', buildings: buildings.map(name => ({ name })) },
    ],
    forces: { vehicles },
  });

const war = (inner: string) => `<战况>\n${inner}\n</战况>`;

describe('E3a · 部署块两段式解析（正例与账本纪律）', () => {
  it('展开·现有基地：deployOrders 槽构造（base 归一 Base.id、into/duration 读 catalog），跳过账本直写', () => {
    const r = parseMessageText(war('部署:\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地'), mkBaseline(), {
      deployIndex: mkIndex(),
    });
    expect(r.deployOrders).toEqual([
      { vehicle: '前沿基地建设车', action: '展开', base: '北坡主基地', into: '前沿工地', duration_min: 360 },
    ]);
    // 跳过账本直写：vehicles/buildings/pending_deployments 均不动
    expect(r.data.forces.vehicles).toContain('前沿基地建设车');
    expect(r.data.bases[0].buildings.map(b => b.name)).not.toContain('前沿工地');
    expect(r.data.pending_deployments).toBeUndefined();
    expect(r.events.some(e => e.light === '🟢' && e.message.includes('部署令「展开」'))).toBe(true);
  });

  it('块别名：部署/展开/deploy 三键同义认领', () => {
    for (const key of ['部署', '展开', 'deploy']) {
      const r = parseMessageText(war(`${key}:\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地`), mkBaseline(), {
        deployIndex: mkIndex(),
      });
      expect(r.deployOrders).toHaveLength(1);
    }
  });

  it("展开·当场建新基地：new_base 字段齐（位置缺省兑底 ''）", () => {
    const r = parseMessageText(
      war('部署:\n  - 展开: 前沿基地建设车\n    新基地: 灰谷前进基地\n    位置: 灰谷东麓'),
      mkBaseline(),
      { deployIndex: mkIndex() },
    );
    expect(r.deployOrders).toEqual([
      {
        vehicle: '前沿基地建设车',
        action: '展开',
        base: '灰谷前进基地',
        into: '前沿工地',
        new_base: { name: '灰谷前进基地', location: '灰谷东麓' },
        duration_min: 360,
      },
    ]);
  });

  it('收起：LLM 写建筑名，反查 deploy.into 命中回填载具原名；耗时＝同块 duration_min（D6）', () => {
    const r = parseMessageText(war('部署:\n  - 收起: 前沿工地\n    基地: 北坡主基地'), mkBaseline(['前沿工地']), {
      deployIndex: mkIndex(),
    });
    expect(r.deployOrders).toEqual([
      { vehicle: '前沿基地建设车', action: '收起', base: '北坡主基地', into: '前沿工地', duration_min: 360 },
    ]);
  });
});

describe('E3a · 部署块宽进严出（拒收分支）', () => {
  const reject = (inner: string, baseline = mkBaseline(), index: DeployCatalogIndexLike | null = mkIndex()) =>
    parseMessageText(war(inner), baseline, index === null ? {} : { deployIndex: index });

  it('拒收：载具不在车队', () => {
    const r = reject('部署:\n  - 展开: 幻影建设车\n    基地: 北坡主基地');
    expect(r.deployOrders).toHaveLength(0);
    expect(r.issues.some(i => i.rule === 'R18' && i.level === 'warn' && i.message.includes('不在车队'))).toBe(true);
  });

  it('拒收：catalog 无以该车为 production 的 deploy 块', () => {
    const r = reject('部署:\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地', mkBaseline(), mkIndex({}));
    expect(r.deployOrders).toHaveLength(0);
  });

  it('拒收：基地不存在；基地与新基地同时申报；两者均缺席', () => {
    expect(reject('部署:\n  - 展开: 前沿基地建设车\n    基地: 幻影基地').deployOrders).toHaveLength(0);
    expect(
      reject('部署:\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地\n    新基地: 灰谷前进基地').deployOrders,
    ).toHaveLength(0);
    expect(reject('部署:\n  - 展开: 前沿基地建设车').deployOrders).toHaveLength(0);
  });

  it('拒收：deploy_limit 满（在场同名部署建筑达上限）', () => {
    const r = reject('部署:\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地', mkBaseline(['前沿工地']));
    expect(r.deployOrders).toHaveLength(0);
    expect(r.issues.some(i => i.message.includes('deploy_limit'))).toBe(true);
  });

  it('拒收：capacity_ratio 满（在场部署建筑占比合计>1；既有完工建筑不占容量）', () => {
    const index = mkIndex({
      前沿基地建设车: VEHICLE_BLOCK,
      机动科研车: { into: '机动科研前哨', duration_min: 100, reverse: true, capacity_ratio: 0.7, deploy_limit: 1 },
    });
    // 有部署建筑 0.7 + 新申报 0.5 > 1 → 拒收
    const r = reject('部署:\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地', mkBaseline(['机动科研前哨']), index);
    expect(r.deployOrders).toHaveLength(0);
    // 对照：既有完工建筑（非 deploy.into 产物）不占容量 → 放行
    const ok = reject('部署:\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地', mkBaseline(['盟军发电站']), index);
    expect(ok.deployOrders).toHaveLength(1);
  });

  it('拒收：reverse=false 不支持收起；建筑不在场；非 deploy.into 产物无法反查', () => {
    const noReverse = mkIndex({ 前沿基地建设车: { ...VEHICLE_BLOCK, reverse: false } });
    expect(
      reject('部署:\n  - 收起: 前沿工地\n    基地: 北坡主基地', mkBaseline(['前沿工地']), noReverse).deployOrders,
    ).toHaveLength(0);
    expect(
      reject('部署:\n  - 收起: 幻影工地\n    基地: 北坡主基地', mkBaseline(['前沿工地'])).deployOrders,
    ).toHaveLength(0);
    expect(
      reject('部署:\n  - 收起: 盟军建造厂\n    基地: 北坡主基地', mkBaseline(['盟军建造厂'])).deployOrders,
    ).toHaveLength(0);
  });

  it('fail-closed：deploy 目录索引未注入 → warn 拒收（防幻影），不构造不执行', () => {
    const r = reject('部署:\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地', mkBaseline(), null);
    expect(r.deployOrders).toHaveLength(0);
    expect(r.issues.some(i => i.rule === 'R18' && i.message.includes('未注入'))).toBe(true);
  });

  it('隔离：未知部署动词 / 元素非对象 / 残键 leftovers', () => {
    const r = reject(
      '部署:\n  - 变形: 前沿基地建设车\n  - "纯字符串"\n  - 展开: 前沿基地建设车\n    基地: 北坡主基地\n    耗时: 999',
    );
    expect(r.quarantine.some(q => q.error.includes('未知部署动词'))).toBe(true);
    expect(r.quarantine.some(q => q.error.includes('非对象'))).toBe(true);
    // 残键「耗时」属 LLM 重复申报参数（deploy 块唯一事实源）→ leftovers 隔离，但声明本体照收
    expect(r.quarantine.some(q => q.raw.includes('耗时'))).toBe(true);
    expect(r.deployOrders).toHaveLength(1);
  });
});

/** E3b：<部署> 标签块（仿 <生产> 形制、置于 <战况> 内队列元素之后） */
const tag = (body: string, name = '部署') => `<${name}>\n${body}\n</${name}>`;

describe('E3b · <部署> 标签块预提取（设计稿§三指令面）', () => {
  const MCV_BLOCK = { into: '盟军建造厂', duration_min: 720, reverse: true };
  const tagIndex = () => mkIndex({ 前沿基地建设车: VEHICLE_BLOCK, 'MCV（盟军）': MCV_BLOCK });

  it('真机原文回归：标签块置于战况队列元素之后 → deployOrders 正出＋🟢 事件＋零隔离', () => {
    const r = parseMessageText(
      war(
        '队列:\n  - 项目: 前沿勘测车\n    类型: 生产\n    基地: 北坡主基地\n<部署>\n展开: 前沿基地建设车 | 新基地: 灰谷前进基地 | 位置: 灰谷东麓\n</部署>',
      ),
      mkBaseline(),
      { deployIndex: mkIndex() },
    );
    expect(r.deployOrders).toEqual([
      {
        vehicle: '前沿基地建设车',
        action: '展开',
        base: '灰谷前进基地',
        into: '前沿工地',
        new_base: { name: '灰谷前进基地', location: '灰谷东麓' },
        duration_min: 360,
      },
    ]);
    expect(r.events.some(e => e.light === '🟢' && e.message.includes('部署令「展开」'))).toBe(true);
    expect(r.quarantine).toEqual([]);
  });

  it('三形制：展开·现有基地（单声明块）', () => {
    const r = parseMessageText(war(tag('展开: 前沿基地建设车 | 基地: 北坡主基地')), mkBaseline(), {
      deployIndex: mkIndex(),
    });
    expect(r.deployOrders).toEqual([
      { vehicle: '前沿基地建设车', action: '展开', base: '北坡主基地', into: '前沿工地', duration_min: 360 },
    ]);
    expect(r.quarantine).toHaveLength(0);
  });

  it('三形制：收起·LLM 写建筑名，反查回填载具原名', () => {
    const r = parseMessageText(war(tag('收起: 前沿工地 | 基地: 北坡主基地')), mkBaseline(['前沿工地']), {
      deployIndex: mkIndex(),
    });
    expect(r.deployOrders).toEqual([
      { vehicle: '前沿基地建设车', action: '收起', base: '北坡主基地', into: '前沿工地', duration_min: 360 },
    ]);
  });

  it('多行混排：单块多声明（展开·现有基地＋收起）同楼齐达', () => {
    const r = parseMessageText(
      war(tag('展开: MCV（盟军） | 基地: 北坡主基地\n收起: 前沿工地 | 基地: 北坡主基地')),
      mkBaseline(['前沿工地'], ['MCV（盟军）']),
      { deployIndex: tagIndex() },
    );
    expect(r.deployOrders).toEqual([
      { vehicle: 'MCV（盟军）', action: '展开', base: '北坡主基地', into: '盟军建造厂', duration_min: 720 },
      { vehicle: '前沿基地建设车', action: '收起', base: '北坡主基地', into: '前沿工地', duration_min: 360 },
    ]);
    expect(r.quarantine).toHaveLength(0);
  });

  it('块别名：部署/展开/deploy 作块名同义认领（含大写、全角括号、全角冒号与全角管道）', () => {
    for (const name of ['部署', '展开', 'deploy', 'DEPLOY']) {
      const r = parseMessageText(war(tag('展开: 前沿基地建设车 | 基地: 北坡主基地', name)), mkBaseline(), {
        deployIndex: mkIndex(),
      });
      expect(r.deployOrders).toHaveLength(1);
    }
    const fullWidth = parseMessageText(
      war('＜部署＞\n展开：前沿基地建设车 ｜ 基地：北坡主基地\n＜/部署＞'),
      mkBaseline(),
      { deployIndex: mkIndex() },
    );
    expect(fullWidth.deployOrders).toHaveLength(1);
  });

  it('标签行剔除：同楼不再出现「无法映射的键」误隔离；非部署标签与正文不误伤', () => {
    const r = parseMessageText(
      war('完成任务数: 2\n<部署>\n展开: 前沿基地建设车 | 基地: 北坡主基地\n</部署>\n<备注>: 西线侦察进行中'),
      mkBaseline(),
      { deployIndex: mkIndex() },
    );
    expect(r.deployOrders).toHaveLength(1);
    expect(r.data.quests.done_count).toBe(2);
    // 标签块行已剥离：不再有「战况.<部署> 展开」类垃圾键隔离
    expect(r.quarantine.some(q => q.raw.includes('<部署>'))).toBe(false);
    expect(r.quarantine.some(q => q.error === '无法映射的键' && q.raw.includes('展开'))).toBe(false);
    // 非部署标签不剥离，仍走既有 YAML 路径隔离（行为不变）
    expect(r.quarantine.some(q => q.raw.includes('<备注>') && q.error === '无法映射的键')).toBe(true);
  });

  it('异常行不静默：未知动词／缺首字段／字段畸形／空块 → 隔离留痕', () => {
    const r = parseMessageText(
      war(
        [
          tag('变形: 前沿基地建设车 | 基地: 北坡主基地'),
          tag('前沿基地建设车 | 基地: 北坡主基地'),
          tag('展开: 前沿基地建设车 | 基地 北坡主基地'),
          tag(''),
        ].join('\n'),
      ),
      mkBaseline(),
      { deployIndex: mkIndex() },
    );
    expect(r.deployOrders).toHaveLength(0);
    expect(r.quarantine.some(q => q.error.includes('未知部署动词'))).toBe(true);
    expect(r.quarantine.some(q => q.error.includes('声明行畸形'))).toBe(true);
    expect(r.quarantine.some(q => q.error.includes('畸形（应为 键: 值）'))).toBe(true);
    expect(r.quarantine.some(q => q.error.includes('部署标签块为空'))).toBe(true);
  });

  it('双路并存：YAML 键形＋标签块同楼齐达互不吞；块内重复申报参数（耗时）进 leftovers 但声明照收', () => {
    const r = parseMessageText(
      war(
        '部署:\n  - 展开: 前沿基地建设车\n    新基地: 灰谷前进基地\n<部署>\n收起: 前沿工地 | 基地: 北坡主基地 | 耗时: 360\n</部署>',
      ),
      mkBaseline(['前沿工地']),
      { deployIndex: mkIndex() },
    );
    expect(r.deployOrders).toEqual([
      {
        vehicle: '前沿基地建设车',
        action: '展开',
        base: '灰谷前进基地',
        into: '前沿工地',
        new_base: { name: '灰谷前进基地', location: '' },
        duration_min: 360,
      },
      { vehicle: '前沿基地建设车', action: '收起', base: '北坡主基地', into: '前沿工地', duration_min: 360 },
    ]);
    // 残键「耗时」由段一既有 leftovers 纪律隔离，不静默吞
    expect(r.quarantine.some(q => q.raw.includes('耗时') && q.error === '无法映射的键')).toBe(true);
  });

  it('未闭合 <部署> 块：🟡 留痕＋原文保留交 YAML 路径隔离（不静默、不误提取）', () => {
    const r = parseMessageText(war('<部署>\n展开: 前沿基地建设车 | 基地: 北坡主基地'), mkBaseline(), {
      deployIndex: mkIndex(),
    });
    expect(r.deployOrders).toHaveLength(0);
    expect(r.events.some(e => e.light === '🟡' && e.message.includes('未闭合'))).toBe(true);
    expect(r.quarantine.length).toBeGreaterThan(0);
  });

  it('BUG-R2-03b（#14/#16楼实机复现）：<态势> 支持 兵力/驻军 与 战损/伤亡/损失 子块，正/负数与带量词值一律按 -Math.abs(n) 扣减 troops/vehicles 并同步核减 base.forces', () => {
    const baseline14 = Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1 },
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          location: '恶土裂谷',
          buildings: [{ name: '盟军建造厂' }, { name: '兵营' }],
          forces: {
            troops: { 美国大兵: 6, 工程兵: 3 },
            vehicles: ['M1A1灰熊主战坦克', 'M1A1灰熊主战坦克', '多功能步兵车'],
          },
        },
      ],
      forces: {
        troops: { 美国大兵: 6, 工程兵: 3 },
        vehicles: ['M1A1灰熊主战坦克', 'M1A1灰熊主战坦克', '多功能步兵车'],
      },
    });

    const raw16 = `<态势>
基地:
  - 名称: 恶土前哨主基地
    状态: 交战中
兵力:
  步兵:
    美国大兵: 6
    工程兵: 3
战损:
  步兵:
    美国大兵: 2名
    工程兵: -1
  载具:
    M1A1灰熊主战坦克: 1辆
    多功能步兵车: -1
</态势>`;

    const r16 = parseMessageText(raw16, baseline14);
    expect(r16.quarantine).toHaveLength(0);
    expect(r16.data.bases[0].status).toBe('暴露');
    expect(r16.data.forces.troops).toEqual({ 美国大兵: 4, 工程兵: 2 });
    expect(r16.data.forces.vehicles).toEqual(['M1A1灰熊主战坦克']);
    // base.forces 同步核减，未被 syncGlobalForcesFloorFromBases 复活
    expect(r16.data.bases[0].forces?.troops).toEqual({ 美国大兵: 4, 工程兵: 2 });
    expect(r16.data.bases[0].forces?.vehicles).toEqual(['M1A1灰熊主战坦克']);
  });

  it('BUG-R2-15（#4/#6/#10/#18/#20楼实机复现）：资源.纳米、基地状态交战中/正常、事件副官任命、作战实验室别名与顶层独立 <部署> YAML 数组项桥接 pending_deployments', () => {
    const baseline18 = Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-03-18', day_count: 5 },
      bases: [
        {
          id: '红峰矿道前哨分基地',
          name: '红峰矿道前哨分基地',
          location: '红峰矿道',
          buildings: [{ name: '盟军建造厂', state: '运转' }],
        },
      ],
      forces: {
        vehicles: ['MCV（盟军）'],
      },
    });

    const raw18And20 = `<态势>
资源:
  纳米:
    通用纳米工料: +500
    电子特种纳米虫: +120
基地:
  - 名称: 红峰矿道前哨分基地
    状态: 正常
</态势>
<事件>
- 类型: 副官任命
  岗位: 参谋副官
  阵营: 盟军
  身份: 人类精英
  姓名: 伊娃·李
  头衔: 战区首席情报官
  专长预设: 高压电网调谐
  理由: 统筹前线侦察与通讯
</事件>
<排产计划>
基地: 红峰矿道前哨分基地
动作:
  - 动作: 入队
    类别: 建造
    项目: 盟军作战实验室
</排产计划>
<部署>
- 动作: 收起, 基地: 红峰矿道前哨分基地, 建筑: 盟军建造厂
- 动作: 展开
  车辆: MCV（盟军）
  基地: 铁砧重矿前哨分基地
</部署>`;

    const r = parseMessageText(raw18And20, baseline18, {
      authority: {
        names: ['盟军战斗实验室'],
        aliases: {},
      },
    });

    expect(r.quarantine).toHaveLength(0);
    expect(r.data.economy.resources?.nanites?.['通用纳米工料']).toBe(500);
    expect(r.data.economy.resources?.nanites?.['电子特种纳米虫']).toBe(120);
    expect(r.data.bases[0].status).toBe('警戒');
    expect(r.eventDeclarations.some(e => e.verb === '副官指派' && e.adjutant?.name === '伊娃·李')).toBe(true);
    expect(r.planningDecls[0]?.actions[0]?.catalog_ref).toBe('盟军战斗实验室');
    expect(r.deployOrders).toHaveLength(2);
    expect(r.deployOrders[0]).toMatchObject({
      action: '收起',
      base: '红峰矿道前哨分基地',
      into: '盟军建造厂',
      vehicle: 'MCV（盟军）',
    });
    expect(r.deployOrders[1]).toMatchObject({
      action: '展开',
      base: '铁砧重矿前哨分基地',
      into: '盟军建造厂',
      vehicle: 'MCV（盟军）',
      new_base: { name: '铁砧重矿前哨分基地' },
    });
    expect(r.data.pending_deployments?.length).toBeGreaterThan(0);
  });
});
