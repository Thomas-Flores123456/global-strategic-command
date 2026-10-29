import {
  SYSTEM_TAVERN_REGEX_REGISTRY,
  TACTICAL_INTEL_REGEX_ID,
  WORLD_EVOLUTION_STEALTH_REGEX_ID,
} from '../worldbook/tavernRegexPipeline';
import { describe, expect, it } from 'vitest';
import { Schema, SCHEMA_VERSION } from '../core/schema';
import {
  INTEL_CHAIN_ALIASES,
  INTEL_CHAIN_STEP_ALIASES,
  INTEL_NEXT_LEAD_ALIASES,
} from '../parse/parseDomainAppliers';
import { parseMessageText } from '../parse/parsePipeline';
import { deriveStrategicFeedforward, formatStrategicFeedforwardPrompt } from '../planning/strategicFeedforward';

describe('FD-33 PKG-A: <情报> 六源演进与 <世界演变> 五维 TTL 衰减及三级存储引擎', () => {
  it('1. 支持顶层 <情报> 与 <世界演变> 解析、六大情报来源渠道归一与四象限/四阶段映射', () => {
    const base = Schema.parse({});
    const raw = `
<情报>
- 标题: 铁道游击队关于装甲列车调动的传闻
  渠道: 暗网流言
  来源: 超维暗网灰区匿名线报
  可信度: 低
  状态: 待核实
  内容: 传闻荒坂远东分部正抽调两列重装甲列车向三号隧道集结。
</情报>

<世界演变>
- 标题: 太平洋环流异常磁暴与远洋航线断绝
  象限: 位面异象
  阶段: 萌芽
  热度: 5
  内容: 南太平洋海域出现持续性高能电离层空洞，多国远洋商船导航失灵。
  伏笔: 若磁暴带继续北移，可能影响高纬度天基卫星通讯并浮现高能裂隙矿脉。
</世界演变>
`;
    const res = parseMessageText(raw, base);
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.intel).toHaveLength(2);

    const tac = res.data.intel.find(i => i.scope === 'tactical')!;
    expect(tac.title).toBe('铁道游击队关于装甲列车调动的传闻');
    expect(tac.src_kind).toBe('暗网流言');
    expect(tac.cred).toBe('低');
    expect(tac.status).toBe('待核实');

    const evo = res.data.intel.find(i => i.scope === 'world')!;
    expect(evo.title).toBe('太平洋环流异常磁暴与远洋航线断绝');
    expect(evo.evo_domain).toBe('位面异象');
    expect(evo.stage).toBe('萌芽');
    expect(evo.ttl_floors).toBe(5);
    expect(evo.hook).toContain('若磁暴带继续北移');
  });

  it('2. 支持通过 演进自 (evolves_from) 跨轮原地升级可信度/状态，并支持对已证伪流言标记 已证伪', () => {
    const s0 = Schema.parse({});
    const r1 = parseMessageText(
      `
<情报>
- 标题: 铁道游击队关于装甲列车调动的传闻
  渠道: 暗网流言
  来源: 灰区线人
  可信度: 低
  内容: 传闻荒坂正抽调装甲列车向三号隧道集结。
- 标题: 北坡西侧林区出现天启坦克集群流言
  渠道: 前线目视
  来源: 惊慌失措的流民
  可信度: 低
  内容: 流民声称在西侧林区看到了十余辆天启坦克。
</情报>
`,
      s0,
    );
    expect(r1.data.intel).toHaveLength(2);

    const r2 = parseMessageText(
      `
<情报>
- 标题: 荒坂远东分部秘密押运车队实锤
  渠道: 电讯截获
  来源: 北坡通讯中心截获加密电报
  可信度: 高
  状态: 已证实
  演进自: 铁道游击队关于装甲列车调动的传闻
  内容: 截获加密电讯，证实荒坂将于48小时内经三号隧道押运高纯度超导核心。
- 标题: 西侧林区天启集群流言证伪
  渠道: 雷达侦察
  来源: 北坡雷达站热成像扫描
  可信度: 证伪
  演进自: 北坡西侧林区出现天启坦克集群流言
  内容: 经雷达热成像排查，西侧林区仅为废弃拖拉机残骸与声学诱饵，系敌方烟雾弹。
</情报>
`,
      r1.data,
    );

    expect(r2.quarantine).toHaveLength(0);
    // 原地演进更新，不重复膨胀条数
    expect(r2.data.intel).toHaveLength(2);

    const verified = r2.data.intel[0]!;
    expect(verified.title).toBe('荒坂远东分部秘密押运车队实锤');
    expect(verified.src_kind).toBe('电讯截获');
    expect(verified.cred).toBe('高');
    expect(verified.status).toBe('已证实');
    expect(verified.evolves_from).toBe('铁道游击队关于装甲列车调动的传闻');

    const debunked = r2.data.intel[1]!;
    expect(debunked.status).toBe('已证伪');
    expect(debunked.cred).toBe('低');
  });

  it('3. 世界演变 5 轮 TTL 自然衰减曲线：未续写每轮 -1 归零移入 intel_archived，续写则重置 TTL=5，置顶豁免衰减', () => {
    let state = Schema.parse({
      intel: [
        {
          title: '远东自由商团内部选举风波',
          scope: 'world',
          src: '宏观世界公报',
          src_kind: '宏观广播',
          content: '远东商团三大派系就北境通商税率爆发争执。',
          cred: '中',
          evo_domain: '社会黑市',
          stage: '萌芽',
          ttl_floors: 2,
          pinned: false,
        },
        {
          title: '极地磁暴异常',
          scope: 'world',
          src: '宏观世界公报',
          src_kind: '宏观广播',
          content: '极地电离层持续波动。',
          cred: '中',
          evo_domain: '位面异象',
          stage: '发酵',
          ttl_floors: 1,
          pinned: true, // 已置顶锁定，豁免衰减
        },
      ],
    });

    // 第 1 轮：仅输出普通 <态势>，未续写世界演变 -> 未置顶条 ttl 从 2 减为 1，置顶条保持 1
    state = parseMessageText(`<态势>\n地点: 北坡主基地\n</态势>`, state).data;
    const unpinnedAfter1 = state.intel.find(i => i.title === '远东自由商团内部选举风波');
    expect(unpinnedAfter1?.ttl_floors).toBe(1);
    const pinnedAfter1 = state.intel.find(i => i.title === '极地磁暴异常');
    expect(pinnedAfter1?.ttl_floors).toBe(1);

    // 第 2 轮：仍未续写 -> 未置顶条 ttl 从 1 减为 0，自动置为 stage: '平息' 并移入 intel_archived
    state = parseMessageText(`<态势>\n地点: 北坡主基地\n</态势>`, state).data;
    expect(state.intel.find(i => i.title === '远东自由商团内部选举风波')).toBeUndefined();
    expect(state.intel_archived).toHaveLength(1);
    expect(state.intel_archived[0]?.title).toBe('远东自由商团内部选举风波');
    expect(state.intel_archived[0]?.stage).toBe('平息');
    // 置顶条仍在活跃池
    expect(state.intel.find(i => i.title === '极地磁暴异常')).toBeDefined();
  });

  it('4. strategicFeedforward 注入情报渠道、待印证线报、在途世界演变与脉冲节律提示', () => {
    const data = Schema.parse({
      bases: [
        {
          id: 'base-1',
          name: '北坡主基地',
          status: '运转中',
          buildings: [{ name: '盟军建造厂', state: '运转' }, { name: '超维暗网中继站', state: '运转' }],
        },
      ],
      intel: [
        {
          title: '暗网超导核心流言',
          scope: 'tactical',
          src: '暗网',
          src_kind: '暗网流言',
          content: '暗网出现超导核心卖家。',
          cred: '低',
          status: '待核实',
        },
        {
          title: '南半球财阀代理人冲突',
          scope: 'world',
          src: '宏观广播',
          src_kind: '宏观广播',
          content: '两大财阀在南美矿区交火。',
          cred: '中',
          evo_domain: '远方地缘',
          stage: '发酵',
          ttl_floors: 4,
          hook: '军火订单需求激增',
        },
      ],
    });

    const feed = deriveStrategicFeedforward({ floorId: 16, schemaVersion: SCHEMA_VERSION, data }, []);
    expect(feed).not.toBeNull();
    const prompt = formatStrategicFeedforwardPrompt(feed!);
    expect(prompt).toContain('【情报渠道与世界暗流】');
    expect(prompt).toContain('暗网流言');
    expect(prompt).toContain('暗网超导核心流言');
    expect(prompt).toContain('[远方地缘·发酵·余4轮]南半球财阀代理人冲突');
  });

  it('5. FD-35 正则拆分：TACTICAL_INTEL_REGEX_ID 仅匹配 <情报>，WORLD_EVOLUTION_STEALTH_REGEX_ID 独立匹配 <世界演变> 并输出静默隐藏宿主', () => {
    const intelSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(r => r.id === TACTICAL_INTEL_REGEX_ID)!;
    const stealthSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(
      r => r.id === WORLD_EVOLUTION_STEALTH_REGEX_ID,
    )!;
    expect(intelSpec.find_regex).toContain('情报');
    expect(intelSpec.find_regex).not.toContain('世界演变');
    expect(new RegExp(intelSpec.find_regex).test('<情报>\n标题: 测试\n</情报>')).toBe(true);
    expect(stealthSpec.find_regex).toContain('世界演变');
    expect(new RegExp(stealthSpec.find_regex).test('<世界演变>\n标题: 测试\n</世界演变>')).toBe(true);
    expect(stealthSpec.replace_string).toContain('data-tw-card="world-evolution-stealth"');
  });
});

describe('FD-50 PKG-A: <情报> 多阶溯源链 (Intel Chain) 解析与同链原地升阶覆写', () => {
  it('1. 支持解析 <情报> 的 情报链 / 阶数 / 下一阶线索（含中英文别名与 hook 双向同步，以及第 2 阶起状态自动归为 演进中）', () => {
    expect(INTEL_CHAIN_ALIASES).toContain('情报链');
    expect(INTEL_CHAIN_STEP_ALIASES).toContain('阶数');
    expect(INTEL_NEXT_LEAD_ALIASES).toContain('下一阶线索');

    const base = Schema.parse({});
    const raw = `
<情报>
- 标题: 北郊废弃变电站断续脉冲传闻
  情报链: 北郊加密信标溯源
  阶数: 1/3
  渠道: 暗网流言
  来源: 灰区无线电发烧友
  可信度: 低
  下一阶线索: 调派雷达车对北郊扇区进行频谱三角定位
  内容: 传闻北郊废弃变电站每逢午夜便出现旧时代军工频段的短促脉冲。
- 标题: 灰区黑市货运车队异动排查
  侦察链: 灰区黑市暗桩甄别
  侦察阶数: 第2阶/共3阶
  渠道: 电讯截获
  来源: 北坡监听哨
  可信度: 中
  下一步核查: 顺藤摸瓜锁定黑市中间联络人藏身仓库
  内容: 截获灰区可疑频段通讯，确认黑市商队正与外围不明武装私下交割。
- 标题: 南麓矿坑高纯度矿脉遥感初探
  chain: 南麓特种矿脉勘测
  chain_step: 1/3
  src: 勘探组线报
  cred: 低
  伏笔: 需派遣工程采样组抵近核实矿脉纯度与辐射水平
  content: 南麓废弃矿坑深处疑似存在高纯度特种矿脉露头。
</情报>
`;
    const res = parseMessageText(raw, base);
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.intel).toHaveLength(3);

    const item1 = res.data.intel[0]!;
    expect(item1.chain).toBe('北郊加密信标溯源');
    expect(item1.chain_step).toBe('1/3');
    expect(item1.next_lead).toBe('调派雷达车对北郊扇区进行频谱三角定位');
    expect(item1.hook).toBe('调派雷达车对北郊扇区进行频谱三角定位');
    expect(item1.status).toBe('待核实');

    const item2 = res.data.intel[1]!;
    expect(item2.chain).toBe('灰区黑市暗桩甄别');
    expect(item2.chain_step).toBe('第2阶/共3阶');
    expect(item2.next_lead).toBe('顺藤摸瓜锁定黑市中间联络人藏身仓库');
    expect(item2.hook).toBe('顺藤摸瓜锁定黑市中间联络人藏身仓库');
    // 第 2 阶起且未显式给 status、cred !== '高' 时，自动归为 '演进中'
    expect(item2.status).toBe('演进中');

    const item3 = res.data.intel[2]!;
    expect(item3.chain).toBe('南麓特种矿脉勘测');
    expect(item3.chain_step).toBe('1/3');
    // 仅写 伏笔 (hook) 时向 next_lead 双向同步
    expect(item3.hook).toBe('需派遣工程采样组抵近核实矿脉纯度与辐射水平');
    expect(item3.next_lead).toBe('需派遣工程采样组抵近核实矿脉纯度与辐射水平');
  });

  it('2. 跨轮次同 情报链 (chain) 从第 1/3 阶(低·待核实) -> 第 2/3 阶(中·演进中) -> 第 3/3 阶(高·已证实) 原地升阶覆写，不制造重复条目且自动串联 evolves_from', () => {
    const s0 = Schema.parse({});

    // 第 1 轮：第 1/3 阶·捕风捉影（低·待核实）
    const r1 = parseMessageText(
      `
<情报>
- 标题: 北郊废弃变电站断续脉冲传闻
  情报链: 北郊加密信标溯源
  阶数: 1/3
  渠道: 暗网流言
  来源: 灰区匿名帖子
  可信度: 低
  下一阶线索: 调派雷达车对北郊扇区进行频谱三角定位
  内容: 传闻北郊废弃变电站每逢午夜出现旧时代军工频段脉冲。
</情报>
`,
      s0,
    );
    expect(r1.quarantine).toHaveLength(0);
    expect(r1.data.intel).toHaveLength(1);
    expect(r1.data.intel[0]?.title).toBe('北郊废弃变电站断续脉冲传闻');
    expect(r1.data.intel[0]?.chain).toBe('北郊加密信标溯源');
    expect(r1.data.intel[0]?.chain_step).toBe('1/3');
    expect(r1.data.intel[0]?.cred).toBe('低');
    expect(r1.data.intel[0]?.status).toBe('待核实');
    expect(r1.data.intel[0]?.evolves_from).toBeUndefined();

    // 第 2 轮：第 2/3 阶·交叉印证（中·演进中），未显式写 演进自 与 状态
    const r2 = parseMessageText(
      `
<情报>
- 标题: 北郊三号防空洞定向加密波束锁定
  情报链: 北郊加密信标溯源
  阶数: 2/3
  渠道: 雷达侦察
  来源: 北坡雷达站频谱测向
  可信度: 中
  下一阶线索: 派遣渗透小组潜入防空洞通风竖井破译门禁信标
  内容: 经雷达三角测向排除变电站表层诱饵，锁定加密脉冲源自三号防空洞地下三十米。
</情报>
`,
      r1.data,
    );
    expect(r2.quarantine).toHaveLength(0);
    // 同链原地升阶覆写，条数保持为 1
    expect(r2.data.intel).toHaveLength(1);
    expect(r2.data.intel[0]?.title).toBe('北郊三号防空洞定向加密波束锁定');
    expect(r2.data.intel[0]?.chain).toBe('北郊加密信标溯源');
    expect(r2.data.intel[0]?.chain_step).toBe('2/3');
    expect(r2.data.intel[0]?.src_kind).toBe('雷达侦察');
    expect(r2.data.intel[0]?.cred).toBe('中');
    expect(r2.data.intel[0]?.status).toBe('演进中');
    // 未手写 演进自 时，自动将第 1 阶旧 title 填入 evolves_from
    expect(r2.data.intel[0]?.evolves_from).toBe('北郊废弃变电站断续脉冲传闻');
    expect(r2.data.intel[0]?.next_lead).toBe('派遣渗透小组潜入防空洞通风竖井破译门禁信标');

    // 第 3 轮：第 3/3 阶·水落石出（高·已证实），同样未手写 演进自
    const r3 = parseMessageText(
      `
<情报>
- 标题: 北郊地下休眠军工掩体与MCV火种库实锤
  情报链: 北郊加密信标溯源
  阶数: 3/3
  渠道: 渗透内线
  来源: 潜伏特工抵近侦察回传
  可信度: 高
  下一阶线索: 立项开启北郊休眠重工掩体启封系列任务并回收特种蓝图
  内容: 渗透小组成功穿过通风竖井抵近核心气闸，确认内部封存有完好的休眠重工设施与基地车火种。
</情报>
`,
      r2.data,
    );
    expect(r3.quarantine).toHaveLength(0);
    expect(r3.data.intel).toHaveLength(1);
    expect(r3.data.intel[0]?.title).toBe('北郊地下休眠军工掩体与MCV火种库实锤');
    expect(r3.data.intel[0]?.chain).toBe('北郊加密信标溯源');
    expect(r3.data.intel[0]?.chain_step).toBe('3/3');
    expect(r3.data.intel[0]?.src_kind).toBe('渗透内线');
    expect(r3.data.intel[0]?.cred).toBe('高');
    expect(r3.data.intel[0]?.status).toBe('已证实');
    // 自动将第 2 阶旧 title 填入 evolves_from
    expect(r3.data.intel[0]?.evolves_from).toBe('北郊三号防空洞定向加密波束锁定');
    expect(r3.data.intel[0]?.next_lead).toBe('立项开启北郊休眠重工掩体启封系列任务并回收特种蓝图');
    expect(r3.data.intel[0]?.hook).toBe('立项开启北郊休眠重工掩体启封系列任务并回收特种蓝图');
  });

  it('3. 终局升格未重复传 next_lead 时保留上一阶 next_lead 供终局转化读取，且支持单对象载荷解包', () => {
    const s0 = Schema.parse({});
    const r1 = parseMessageText(
      `
<情报>
情报链: 西谷敌方装甲集结侦察
阶数: 2/3
标题: 西谷铁路编组站夜间热源异常
来源: 雷达站
可信度: 中
下一阶线索: 查明编组站防空火力配置并发起先发制人截击任务
内容: 雷达捕捉到西谷编组站夜间有十余处重型引擎热源集结。
</情报>
`,
      s0,
    );
    expect(r1.quarantine).toHaveLength(0);
    expect(r1.data.intel).toHaveLength(1);
    expect(r1.data.intel[0]?.chain).toBe('西谷敌方装甲集结侦察');
    expect(r1.data.intel[0]?.status).toBe('演进中');

    // 终局实锤未传新的 next_lead，保留上一阶 next_lead
    const r2 = parseMessageText(
      `
<情报>
情报链: 西谷敌方装甲集结侦察
阶数: 3/3
标题: 西谷编组站敌方重装突击群坐标实锤
来源: 前线侦察班
可信度: 高
内容: 确认敌方两个装甲连正在编组站卸载燃料，防空网存在东南角盲区。
</情报>
`,
      r1.data,
    );
    expect(r2.quarantine).toHaveLength(0);
    expect(r2.data.intel).toHaveLength(1);
    expect(r2.data.intel[0]?.status).toBe('已证实');
    expect(r2.data.intel[0]?.evolves_from).toBe('西谷铁路编组站夜间热源异常');
    expect(r2.data.intel[0]?.next_lead).toBe('查明编组站防空火力配置并发起先发制人截击任务');
  });

  it('4. 单条普通情报不写 chain / chain_step / next_lead 时 100% 保持向后兼容', () => {
    const s0 = Schema.parse({});
    const res = parseMessageText(
      `
<情报>
- 标题: 周边巡逻队常规路况通报
  渠道: 前线目视
  来源: 外围哨所
  可信度: 中
  内容: 二号公路积雪已清理完毕，视野良好。
</情报>
`,
      s0,
    );
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.intel).toHaveLength(1);
    const item = res.data.intel[0]!;
    expect(item.title).toBe('周边巡逻队常规路况通报');
    expect(item.src_kind).toBe('前线目视');
    expect(item.cred).toBe('中');
    expect(item.status).toBe('待核实');
    expect(item.chain).toBeUndefined();
    expect(item.chain_step).toBeUndefined();
    expect(item.next_lead).toBeUndefined();
    expect(item.hook).toBeUndefined();
  });
});

