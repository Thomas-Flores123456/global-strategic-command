/**
 * E3c 案甲 · 前沿工地 build.whitelist 挂载校验点测试（设计稿§六，R28 只警不拦）
 * 覆盖：readDeployBlock whitelist 读取（脏值过滤/缺席兼容）；白名单内静默通过；
 * 白名单外 🟡＋R28 warn 且队列照挂；正规建造厂豁免（通道A 名锚定/通道B build.full）；
 * whitelist 缺席不校验；deployIndex 缺席 fail-closed 不校验；非建造类型不触发；
 * canon 消歧；多工地并集；既有队列更新不追溯。
 */
import { describe, expect, it } from 'vitest';
import { parseMessageText, type DeployCatalogIndexLike } from '../parse/parsePipeline';
import { deployBlockIndexFromCatalog } from '../engines/deploymentEngine';
import { Schema } from '../core/schema';

/** 合成 catalog（production 数据块内 deploy 块；经索引工厂走 readDeployBlock 真链路） */
const POOLS = {
  productions: [
    {
      name: '前沿基地建设车',
      deploy: {
        into: '前沿工地',
        capabilities: ['build.whitelist'],
        reverse: true,
        whitelist: ['哨戒炮', '防御栅栏', '岗哨炮塔'],
      },
    },
  ],
};
const INDEX = deployBlockIndexFromCatalog(POOLS);

const mkBaseline = (buildings: string[], vehicles: string[] = []) =>
  Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1 },
    bases: [
      {
        id: '北坡主基地',
        name: '北坡主基地',
        location: '青岚山北坡',
        buildings: buildings.map(name => ({ name })),
      },
    ],
    forces: { vehicles },
  });

const war = (item: string, type = '建造') =>
  `<战况>\n队列:\n  - 项目: ${item}\n    类型: ${type}\n    基地: 北坡主基地\n</战况>`;

const mount = (
  item: string,
  baseline = mkBaseline(['前沿工地', '盟军发电站']),
  index: DeployCatalogIndexLike | null = INDEX,
) => parseMessageText(war(item), baseline, index === null ? {} : { deployIndex: index });

describe('E3c 案甲 · readDeployBlock whitelist 读取（经索引工厂）', () => {
  it('whitelist 读取并过滤非字符串；byInto 反查携带', () => {
    const hit = INDEX.byInto('前沿工地');
    expect(hit?.block.whitelist).toEqual(['哨戒炮', '防御栅栏', '岗哨炮塔']);
    const dirty = deployBlockIndexFromCatalog({
      productions: [
        {
          name: '脏车',
          deploy: { into: '脏工地', capabilities: ['build.whitelist'], whitelist: ['塔', 42, null, '墙'] },
        },
      ],
    });
    expect(dirty.byInto('脏工地')?.block.whitelist).toEqual(['塔', '墙']);
  });

  it('whitelist 缺席 → undefined（向后兼容，不启用校验）', () => {
    const legacy = deployBlockIndexFromCatalog({
      productions: [{ name: '旧建设车', deploy: { into: '旧工地', capabilities: ['build.whitelist'] } }],
    });
    expect(legacy.byInto('旧工地')?.block.whitelist).toBeUndefined();
  });
});

describe('E3c 案甲 · 挂载校验点（R28 只警不拦）', () => {
  it('白名单内项目挂载静默通过：无 R28、无 🟡 挂载警示，队列照挂', () => {
    const r = mount('哨戒炮');
    expect(r.issues.some(i => i.rule === 'R28')).toBe(false);
    expect(r.events.some(e => e.light === '🟡' && e.message.includes('白名单'))).toBe(false);
    expect(r.data.queues.map(q => q.item)).toContain('哨戒炮');
  });

  it('白名单外项目挂载：🟡 事件＋R28 warn（message 含项目/基地/名单摘要），队列照常挂载（只警不拦）', () => {
    const r = mount('特斯拉线圈');
    const r28 = r.issues.filter(i => i.rule === 'R28');
    expect(r28).toHaveLength(1);
    expect(r28[0]).toMatchObject({ level: 'warn', target: '队列[特斯拉线圈]' });
    expect(r28[0].message).toContain('特斯拉线圈');
    expect(r28[0].message).toContain('北坡主基地');
    expect(r28[0].message).toContain('哨戒炮');
    expect(r.events.some(e => e.light === '🟡' && e.message.includes('前沿工地'))).toBe(true);
    // 只警不拦：事务照挂（出生即 queued，F7）
    const q = r.data.queues.find(x => x.item === '特斯拉线圈');
    expect(q).toMatchObject({ type: '建造', base: '北坡主基地', status: 'queued' });
  });

  it('正规建造厂豁免·通道A：基地含「盟军建造厂」（名锚定 includes 建造厂/MCV）→ 白名单外不警', () => {
    const r = mount('特斯拉线圈', mkBaseline(['前沿工地', '盟军建造厂', '盟军发电站']));
    expect(r.issues.some(i => i.rule === 'R28')).toBe(false);
  });

  it('正规建造厂豁免·通道B：deploy 产物建筑授予 build.full（名字不含锚定词）→ 豁免（对照组：无它则警）', () => {
    const dual = deployBlockIndexFromCatalog({
      productions: [
        { name: '建设车', deploy: { into: '前沿工地', capabilities: ['build.whitelist'], whitelist: ['哨戒炮'] } },
        { name: '重型指挥车', deploy: { into: '方舟核心', capabilities: ['build.full'] } },
      ],
    });
    const exempt = mount('特斯拉线圈', mkBaseline(['前沿工地', '方舟核心']), dual);
    expect(exempt.issues.some(i => i.rule === 'R28')).toBe(false);
    const control = mount('特斯拉线圈', mkBaseline(['前沿工地']), dual);
    expect(control.issues.filter(i => i.rule === 'R28')).toHaveLength(1);
  });

  it('whitelist 缺席（旧数据）→ 不校验不警示', () => {
    const legacy = deployBlockIndexFromCatalog({
      productions: [{ name: '前沿基地建设车', deploy: { into: '前沿工地', capabilities: ['build.whitelist'] } }],
    });
    const r = mount('特斯拉线圈', mkBaseline(['前沿工地']), legacy);
    expect(r.issues.some(i => i.rule === 'R28')).toBe(false);
    expect(r.data.queues.map(q => q.item)).toContain('特斯拉线圈');
  });

  it('deployIndex 缺席 → fail-closed 不校验（与部署段同纪律）', () => {
    const r = mount('特斯拉线圈', mkBaseline(['前沿工地']), null);
    expect(r.issues.some(i => i.rule === 'R28')).toBe(false);
    expect(r.data.queues.map(q => q.item)).toContain('特斯拉线圈');
  });

  it('非建造类型队列元素不触发（研究/生产）', () => {
    for (const type of ['研究', '生产']) {
      const r = parseMessageText(war('特斯拉线圈', type), mkBaseline(['前沿工地']), { deployIndex: INDEX });
      expect(r.issues.some(i => i.rule === 'R28')).toBe(false);
    }
  });

  it('canon 消歧：whitelist「岗哨炮塔」vs 项目繁体/带空白变体命中（全半角·繁简·trim）', () => {
    const r = parseMessageText(
      `<战况>\n队列:\n  - 项目: 岗哨炮塔\u3000\n    类型: 建造\n    基地: 北坡主基地\n</战况>`,
      mkBaseline(['前沿工地']),
      { deployIndex: INDEX },
    );
    expect(r.issues.some(i => i.rule === 'R28')).toBe(false);
    expect(r.data.queues.map(q => q.item)).toContain('岗哨炮塔');
  });

  it('多工地并集：项目落在第二工地名单 → 放行', () => {
    const dual = deployBlockIndexFromCatalog({
      productions: [
        { name: '车甲', deploy: { into: '工地甲', capabilities: ['build.whitelist'], whitelist: ['哨戒炮'] } },
        { name: '车乙', deploy: { into: '工地乙', capabilities: ['build.whitelist'], whitelist: ['特斯拉线圈'] } },
      ],
    });
    const r = mount('特斯拉线圈', mkBaseline(['工地甲', '工地乙']), dual);
    expect(r.issues.some(i => i.rule === 'R28')).toBe(false);
  });

  it('既有队列更新不追溯：同项目二次挂载（进度更新）不再重复警示', () => {
    const baseline = mkBaseline(['前沿工地']);
    const first = parseMessageText(war('特斯拉线圈'), baseline, { deployIndex: INDEX });
    expect(first.issues.filter(i => i.rule === 'R28')).toHaveLength(1);
    const second = parseMessageText(
      `<战况>\n队列:\n  - 项目: 特斯拉线圈\n    类型: 建造\n    基地: 北坡主基地\n    进度: 40\n</战况>`,
      first.data,
      { deployIndex: INDEX },
    );
    expect(second.issues.some(i => i.rule === 'R28')).toBe(false);
    expect(second.data.queues.find(q => q.item === '特斯拉线圈')).toMatchObject({ progress: 40 });
  });
});
