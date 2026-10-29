/**
 * EVT-PARSE-01 · <事件> 报文提取器与三色裁决门 —— 专项单测
 * 真源：《事件系统与资金链状态机总设计案》§2.2/§2.3（CTRL-EVENT-PARSE-01）/《MVP 任务包》§3.3·§6
 * 覆盖：六动词绿通道全谱（§2.2 样例逐条）、归一化黄通道（繁体/额度后缀/缺来源/非法枚举/未知键）、
 *       越权与残缺红通道（credits 剥权/资金重置动词/缺必填/负额度/非法流向）、块级失败、
 *       Q9 单楼 5 条硬配额（块内截断＋跨块累计）、parseMessageText 集成与不动账本断言。
 */
import { describe, expect, it } from 'vitest';
import { extractEvents, parseMessageText } from '../parse/parsePipeline';
import { settleFloor } from '../engines/settleFloor';

describe('G04-01 · 混合绿黄事件遵守原文顺序', () => {
  it.each([
    ['黄建立→绿断裂', '"+600点"', '资金链断裂'],
    ['绿建立→黄断裂', '600', '資金鏈斷裂'],
  ])('%s：最终 broken，当期零收益', (_label, rate, breakVerb) => {
    const block = `- 类型: 资金链建立\n  对象: 商路甲\n  额度: ${rate}\n- 类型: ${breakVerb}\n  对象: 商路甲`;
    const gate = extractEvents(block);
    expect(gate.greenEvents).toHaveLength(1);
    expect(gate.yellowEvents).toHaveLength(1);
    const raw = `<timePast>1D</timePast>\n<事件>\n${block}\n</事件>`;
    const parsed = parseMessageText(raw, { economy: { credits: 1000 } });
    expect(parsed.eventDeclarations.map(d => d.verb)).toEqual(['资金链建立', '资金链断裂']);
    const settled = settleFloor(undefined, parsed.data, raw, { eventDeclarations: parsed.eventDeclarations });
    expect(settled.deltaMinutes).toBe(1440);
    expect(settled.data.economy.chains).toHaveLength(1);
    expect(settled.data.economy.chains[0]).toMatchObject({ name: '商路甲', status: 'broken', eff: 0 });
    expect(settled.data.economy.credits).toBe(1000);
  });

  it.each([
    ['势力', '势力发现', '勢力發現', '情报', 'faction'],
    ['任务', '任务接取', '任務接取', '详情', 'quest'],
  ] as const)('同名%s更新：颜色不改变后声明覆盖前声明', (_label, greenVerb, yellowVerb, field, kind) => {
    for (const verbs of [[yellowVerb, greenVerb], [greenVerb, yellowVerb]]) {
      const block = `- 类型: ${verbs[0]}\n  名称: 同名对象\n  ${field}: 旧内容\n- 类型: ${verbs[1]}\n  名称: 同名对象\n  ${field}: 新内容`;
      const gate = extractEvents(block);
      expect(gate.greenEvents).toHaveLength(1);
      expect(gate.yellowEvents).toHaveLength(1);
      const parsed = parseMessageText(`<事件>\n${block}\n</事件>`, {});
      expect(parsed.eventDeclarations.map(d => kind === 'faction' ? d.faction?.intel : d.quest?.detail))
        .toEqual(['旧内容', '新内容']);
      if (kind === 'faction') {
        expect(parsed.data.factions).toHaveLength(1);
        expect(parsed.data.factions[0].intel).toBe('新内容');
      } else {
        expect(parsed.data.quests.active).toHaveLength(1);
        expect(parsed.data.quests.active[0].detail).toBe('新内容');
      }
    }
  });
});

/* ═══════════════ §2.2 标准样例（真源逐字） ═══════════════ */

const SAMPLE_CHAIN_ESTABLISH = `
- 类型: 资金链建立
  对象: 灵石走私走廊
  流向: 收入
  额度: 600
  周期: 日
  依赖:
    - 基地: 1号前哨站
    - 设施: 隐蔽仓库
  理由: 与当地修真家族达成私下供货协议
`;

const SAMPLE_CHAIN_BREAK = `
- 类型: 资金链断裂
  对象: 旧城废料回收线
  原因: 分拣厂被恶意焚毁，链条停摆
`;

const SAMPLE_FACTION = `
- 类型: 势力发现
  名称: 极光生物科技
  态度: 警觉
  风险: 中
  情报: 驻扎于第三工业区的外资安保集团
`;

const SAMPLE_INTEL = `
- 类型: 情报获取
  来源: 无线电监听
  可信度: 高
  内容: 敌方巡林队将于三日后换防，防线出现 6 小时空窗
`;

const SAMPLE_QUEST = `
- 类型: 任务接取
  名称: 猎取高纯微晶样本
  详情: 渗透敌方精炼厂获取 5 份样本
  进度: 0/3
`;

/* ═══════════════ 🟢 绿通道：六动词全谱 ═══════════════ */

describe('EVT-PARSE-01 · 🟢 绿通道（合法报文零修复入库）', () => {
  it('资金链建立：§2.2 样例逐字段命中（依赖为单键映射列表形态，base/设施 双吸收）', () => {
    const r = extractEvents(SAMPLE_CHAIN_ESTABLISH);
    expect(r.greenEvents).toHaveLength(1);
    expect(r.yellowEvents).toHaveLength(0);
    expect(r.quarantineEvents).toHaveLength(0);
    expect(r.admitted).toBe(1);
    expect(r.greenEvents[0]).toEqual({
      verb: '资金链建立',
      kind: 'chain',
      chain: {
        name: '灵石走私走廊',
        flow: '收入',
        rate_daily: 600,
        base_id: '1号前哨站',
        buildings: ['隐蔽仓库'],
        reason: '与当地修真家族达成私下供货协议',
      },
    });
  });

  it('资金链断裂：定位＋叙事，额度占位 0', () => {
    const r = extractEvents(SAMPLE_CHAIN_BREAK);
    expect(r.greenEvents[0]).toEqual({
      verb: '资金链断裂',
      kind: 'chain',
      chain: {
        name: '旧城废料回收线',
        flow: '收入',
        rate_daily: 0,
        base_id: '',
        buildings: [],
        reason: '分拣厂被恶意焚毁，链条停摆',
      },
    });
  });

  it('势力发现：名称/态度/风险/情报 四字段面', () => {
    const r = extractEvents(SAMPLE_FACTION);
    expect(r.greenEvents[0]).toEqual({
      verb: '势力发现',
      kind: 'faction',
      faction: { name: '极光生物科技', attitude: '警觉', risk: '中', intel: '驻扎于第三工业区的外资安保集团' },
    });
  });

  it('情报获取：来源/可信度/内容', () => {
    const r = extractEvents(SAMPLE_INTEL);
    expect(r.greenEvents[0]).toEqual({
      verb: '情报获取',
      kind: 'intel',
      intel: { src: '无线电监听', cred: '高', content: '敌方巡林队将于三日后换防，防线出现 6 小时空窗' },
    });
  });

  it('任务接取：名称/详情/进度（0/3 保持字符串形态）', () => {
    const r = extractEvents(SAMPLE_QUEST);
    expect(r.greenEvents[0]).toEqual({
      verb: '任务接取',
      kind: 'quest',
      quest: { name: '猎取高纯微晶样本', detail: '渗透敌方精炼厂获取 5 份样本', progress: '0/3' },
    });
  });

  it('组合报文：§2.2 五条样例同块 → 全绿且恰好打满配额（admitted=5）', () => {
    const r = extractEvents(SAMPLE_CHAIN_ESTABLISH + SAMPLE_CHAIN_BREAK + SAMPLE_FACTION + SAMPLE_INTEL + SAMPLE_QUEST);
    expect(r.greenEvents).toHaveLength(5);
    expect(r.yellowEvents).toHaveLength(0);
    expect(r.quarantineEvents).toHaveLength(0);
    expect(r.admitted).toBe(5);
    expect(r.greenEvents.map(d => d.verb)).toEqual(['资金链建立', '资金链断裂', '势力发现', '情报获取', '任务接取']);
  });

  it('资金链受挫：六动词补全（§3.3 工况联动动词）', () => {
    const r = extractEvents('- 类型: 资金链受挫\n  对象: 灵石走私走廊\n  原因: 暴风雪封路');
    expect(r.greenEvents[0].verb).toBe('资金链受挫');
    expect(r.greenEvents[0].chain?.name).toBe('灵石走私走廊');
  });

  it('代码围栏容忍：```yaml 围栏包裹的事件数组照常解析', () => {
    const r = extractEvents('```yaml\n' + SAMPLE_CHAIN_ESTABLISH + '```');
    expect(r.greenEvents).toHaveLength(1);
  });
});

/* ═══════════════ 🟡 黄通道：轻度瑕疵归一化 ═══════════════ */

describe('EVT-PARSE-01 · 🟡 黄通道（轻度瑕疵归一化并记 repairs）', () => {
  it('额度带文字后缀：“+600点” → 600（归一修复留痕）', () => {
    const r = extractEvents('- 类型: 资金链建立\n  对象: 灵石走私走廊\n  额度: +600点');
    expect(r.yellowEvents).toHaveLength(1);
    expect(r.greenEvents).toHaveLength(0);
    expect(r.yellowEvents[0].declaration.chain?.rate_daily).toBe(600);
    expect(r.yellowEvents[0].repairs.join()).toContain('600');
  });

  it('繁体动词自动归一：類型/資金鏈建立 → 资金链建立', () => {
    const r = extractEvents('- 類型: 資金鏈建立\n  對象: 靈石走私走廊\n  額度: 600');
    expect(r.yellowEvents[0].declaration.verb).toBe('资金链建立');
    expect(r.yellowEvents[0].declaration.chain?.name).toBe('靈石走私走廊');
    expect(r.yellowEvents[0].repairs.join()).toContain('归一');
  });

  it('情报来源未注名：按「未知来源」折算（§2.3 黄例）', () => {
    const r = extractEvents('- 类型: 情报获取\n  内容: 换防空窗情报');
    expect(r.yellowEvents[0].declaration.intel?.src).toBe('未知来源');
    expect(r.yellowEvents[0].repairs.join()).toContain('未知来源');
  });

  it('非法枚举降级：态度→未接触、风险→未知、可信度→中（各记修复）', () => {
    const faction = extractEvents('- 类型: 势力发现\n  名称: X集团\n  态度: 极度仇视\n  风险: 极高');
    expect(faction.yellowEvents[0].declaration.faction?.attitude).toBe('未接触');
    expect(faction.yellowEvents[0].declaration.faction?.risk).toBe('未知');
    const intel = extractEvents('- 类型: 情报获取\n  来源: A\n  可信度: 百分之百\n  内容: B');
    expect(intel.yellowEvents[0].declaration.intel?.cred).toBe('中');
  });

  it('非法依赖形态：字符串依赖按空依赖处理并记修复', () => {
    const r = extractEvents('- 类型: 资金链建立\n  对象: 走廊\n  额度: 100\n  依赖: 就靠我自己');
    expect(r.yellowEvents[0].declaration.chain?.base_id).toBe('');
    expect(r.yellowEvents[0].declaration.chain?.buildings).toEqual([]);
    expect(r.yellowEvents[0].repairs.join()).toContain('依赖形态非法');
  });

  it('未知键轻瑕疵：忽略并留痕，不隔离', () => {
    const r = extractEvents('- 类型: 任务接取\n  名称: T\n  奖励: 500');
    expect(r.yellowEvents).toHaveLength(1);
    expect(r.yellowEvents[0].declaration.quest?.name).toBe('T');
    expect(r.yellowEvents[0].repairs.join()).toContain('「奖励」');
  });

  it('非日周期：记修复后按日额度折算', () => {
    const r = extractEvents('- 类型: 资金链建立\n  对象: 走廊\n  额度: 600\n  周期: 周');
    expect(r.yellowEvents[0].declaration.chain?.rate_daily).toBe(600);
    expect(r.yellowEvents[0].repairs.join()).toContain('周期');
  });
});

/* ═══════════════ 🔴 红通道：越权/残缺/非法 100% 隔离 ═══════════════ */

describe('EVT-PARSE-01 · 🔴 红通道（越权与严重破损整项隔离）', () => {
  it('越权剥权（Q2）：事件条目直写 credits: 999999 → 100% 隔离，绝不动账', () => {
    const r = extractEvents('- 类型: 任务接取\n  名称: T\n  credits: 999999');
    expect(r.greenEvents).toHaveLength(0);
    expect(r.yellowEvents).toHaveLength(0);
    expect(r.quarantineEvents).toHaveLength(1);
    expect(r.quarantineEvents[0].error).toContain('越权');
    expect(r.quarantineEvents[0].error).toContain('credits');
  });

  it('越权中文键：资金: 999999 同样拒收', () => {
    const r = extractEvents('- 类型: 任务接取\n  名称: T\n  资金: 999999');
    expect(r.quarantineEvents[0].error).toContain('越权');
  });

  it('越权动词：类型: 资金重置 → 未知动词拒收并注记疑似越权', () => {
    const r = extractEvents('- 类型: 资金重置\n  对象: 测试链');
    expect(r.quarantineEvents).toHaveLength(1);
    expect(r.quarantineEvents[0].error).toContain('资金重置');
    expect(r.quarantineEvents[0].error).toContain('越权');
  });

  it('残缺：资金链建立缺对象 / 缺额度 → 隔离', () => {
    expect(extractEvents('- 类型: 资金链建立\n  额度: 600').quarantineEvents[0].error).toContain('缺链条名');
    expect(extractEvents('- 类型: 资金链建立\n  对象: 走廊').quarantineEvents[0].error).toContain('额度');
  });

  it('残缺：缺类型键 / 势力缺名称 / 情报缺内容 / 任务缺名称 → 隔离', () => {
    expect(extractEvents('- 对象: 走廊').quarantineEvents[0].error).toContain('类型');
    expect(extractEvents('- 类型: 势力发现\n  态度: 中立').quarantineEvents[0].error).toContain('名称');
    expect(extractEvents('- 类型: 情报获取\n  来源: A').quarantineEvents[0].error).toContain('内容');
    expect(extractEvents('- 类型: 任务接取\n  进度: 0/3').quarantineEvents[0].error).toContain('名称');
  });

  it('额度为负 → 隔离（rate_daily ≥ 0）', () => {
    const r = extractEvents('- 类型: 资金链建立\n  对象: 走廊\n  额度: -600');
    expect(r.quarantineEvents[0].error).toContain('负');
  });

  it('额度不可解析 → 隔离', () => {
    const r = extractEvents('- 类型: 资金链建立\n  对象: 走廊\n  额度: 面议');
    expect(r.quarantineEvents[0].error).toContain('不可解析');
  });

  it('流向非法（非 收入/支出）→ 隔离', () => {
    const r = extractEvents('- 类型: 资金链建立\n  对象: 走廊\n  额度: 600\n  流向: 双向');
    expect(r.quarantineEvents[0].error).toContain('流向');
  });

  it('标量/数组条目 → 隔离', () => {
    expect(extractEvents('- 裸字符串条目').quarantineEvents[0].error).toContain('非键值映射');
    expect(extractEvents('- [a, b]').quarantineEvents[0].error).toContain('非键值映射');
  });
});

/* ═══════════════ 块级失败与 Q9 配额 ═══════════════ */

describe('EVT-PARSE-01 · 块级失败', () => {
  it('非数组 YAML（键值映射形态）→ 整块隔离', () => {
    const r = extractEvents('类型: 资金链建立\n对象: 走廊\n额度: 600');
    expect(r.quarantineEvents).toHaveLength(1);
    expect(r.quarantineEvents[0].error).toContain('数组');
    expect(r.admitted).toBe(0);
  });

  it('不可解析乱码 → 整块隔离（零入库）', () => {
    const r = extractEvents('["unclosed');
    expect(r.greenEvents).toHaveLength(0);
    expect(r.yellowEvents).toHaveLength(0);
    expect(r.quarantineEvents).toHaveLength(1);
  });

  it('空文本 → 隔离（fail-closed）', () => {
    const r = extractEvents('   ');
    expect(r.quarantineEvents).toHaveLength(1);
  });
});

describe('EVT-PARSE-01 · Q9 单楼 5 条硬配额', () => {
  const entry = (n: number) => `- 类型: 任务接取\n  名称: 任务${n}`;

  it('8 条输入：前 5 条正常裁决入库，第 6~8 条安全截断隔离（admitted=5）', () => {
    const text = Array.from({ length: 8 }, (_v, i) => entry(i + 1)).join('\n');
    const r = extractEvents(text);
    expect(r.greenEvents).toHaveLength(5);
    expect(r.quarantineEvents).toHaveLength(3);
    expect(r.admitted).toBe(5);
    expect(r.quarantineEvents.every(q => q.error.includes('配额超限'))).toBe(true);
    // 截断条目带原文留痕
    expect(r.quarantineEvents[0].source).toContain('任务6');
  });

  it('超额截断不吞噬裁决：前 5 条中混入的越权条目仍按红通道隔离', () => {
    const text =
      '- 类型: 任务接取\n  名称: T1\n' +
      '- 类型: 任务接取\n  名称: T2\n  credits: 1\n' +
      Array.from({ length: 6 }, (_v, i) => entry(i + 10)).join('\n');
    const r = extractEvents(text);
    expect(r.greenEvents).toHaveLength(4); // T1 ＋ 截断前 3 条任务（T2 越权占额不入库）
    expect(r.quarantineEvents).toHaveLength(4); // 1 越权（占配额）＋ 3 超额截断
    expect(r.admitted).toBe(5);
  });

  it('跨块累计：admitted 起点已满 5 → 本批全部截断', () => {
    const r = extractEvents('- 类型: 任务接取\n  名称: T', { admitted: 5 });
    expect(r.greenEvents).toHaveLength(0);
    expect(r.quarantineEvents).toHaveLength(1);
    expect(r.admitted).toBe(0);
  });
});

/* ═══════════════ parseMessageText 集成（标签注册与收集槽） ═══════════════ */

describe('EVT-PARSE-01 · parseMessageText 集成', () => {
  it('<事件> 一级标签注册：绿/黄/红三通道留痕齐备，eventDeclarations 收集槽就位', () => {
    const raw = [
      '<事件>',
      SAMPLE_CHAIN_ESTABLISH.trim(),
      '- 类型: 任务接取\n  名称: T\n  credits: 999', // 🔴 越权
      '- 类型: 情报获取\n  内容: X', // 🟡 缺来源
      '</事件>',
    ].join('\n');
    const r = parseMessageText(raw, {});
    expect(r.eventDeclarations).toHaveLength(2); // 🟢 建立 + 🟡 情报
    expect(r.eventDeclarations[0].chain?.name).toBe('灵石走私走廊');
    expect(r.quarantine.some(q => q.tag === '事件' && q.error.includes('越权'))).toBe(true);
    expect(r.issues.some(i => i.target === '事件' && i.level === 'error')).toBe(true);
    expect(r.events.some(e => e.message.includes('资金链建立'))).toBe(true);
    // EVT-PARSE-02：事件通道入账认知账本（情报已入流水 → applied true）；
    // 但经济账本仍是红线——解析层不建链、不动 credits（Q2，链类结转 settleFloor 第四齿轮）
    expect(r.applied).toBe(true);
    expect((r.data.economy as { chains?: unknown[] }).chains).toEqual([]);
    expect((r.data.economy as { credits?: number }).credits).toBe(0);
  });

  it('英文别名 <event> 同样命中（TAG_SYNONYMS）', () => {
    const raw = `<event>\n${SAMPLE_QUEST.trim()}\n</event>`;
    const r = parseMessageText(raw, {});
    expect(r.eventDeclarations).toHaveLength(1);
    expect(r.eventDeclarations[0].quest?.name).toBe('猎取高纯微晶样本');
  });

  it('多 <事件> 块共享单楼配额：4＋4 → 第二块仅 1 条入库、3 条截断', () => {
    const raw = [
      '<事件>',
      ...Array.from({ length: 4 }, (_v, i) => `- 类型: 任务接取\n  名称: A${i + 1}`),
      '</事件>',
      '<事件>',
      ...Array.from({ length: 4 }, (_v, i) => `- 类型: 任务接取\n  名称: B${i + 1}`),
      '</事件>',
    ].join('\n');
    const r = parseMessageText(raw, {});
    expect(r.eventDeclarations).toHaveLength(5);
    expect(r.eventDeclarations[4].quest?.name).toBe('B1');
    expect(r.quarantine.filter(q => q.tag === '事件' && q.error.includes('配额超限'))).toHaveLength(3);
  });

  it('与 <战况> 同楼共存：战况照常合并，事件照常收集，互不污染', () => {
    const raw = [
      '<战况>',
      '日期: 2087-03-05',
      '资金: 5000',
      '</战况>',
      '<事件>',
      SAMPLE_CHAIN_ESTABLISH.trim(),
      '</事件>',
    ].join('\n');
    const r = parseMessageText(raw, {});
    expect(r.applied).toBe(true); // 战况账本写入
    expect((r.data.economy as { credits?: number }).credits).toBe(5000);
    expect(r.eventDeclarations).toHaveLength(1);
    expect((r.data.economy as { chains?: unknown[] }).chains).toEqual([]); // 事件不直接建链
  });

  it('旧楼零注入：无 <事件> 的楼层 eventDeclarations 恒空（零行为变化）', () => {
    const r = parseMessageText('<战况>\n日期: 2087-03-05\n</战况>', {});
    expect(r.eventDeclarations).toEqual([]);
    expect(r.quarantine.filter(q => q.tag === '事件')).toEqual([]);
  });
});

/* ═══════════════ EVT-PARSE-02 · 势力/情报/任务标准化入账（真源 §5.1/§6.1、Q4） ═══════════════ */

describe('EVT-PARSE-02 · 势力发现入账（factions + Q4 暂存门）', () => {
  it('新势力：注册标准 Faction 实体＋同步产出 pending_lore 暂存门结构实体（延迟确认）', () => {
    const r = parseMessageText(`<事件>\n${SAMPLE_FACTION.trim()}\n</事件>`, {
      meta: { date: '2042-03-14', day_count: 5 },
    });
    expect(r.data.factions).toEqual([
      { name: '极光生物科技', attitude: '警觉', risk: '中', intel: '驻扎于第三工业区的外资安保集团' },
    ]);
    // Q4 暂存门结构实体（pendingLoreGate.readPendingLore 可回收同构）：id 派生 canon、kind 势力、
    // 摘要取认知概要；时空锚哨兵 -1（解析层无楼层/分支上下文，与读回侧归一口径一致）
    expect(r.data.pending_lore).toHaveLength(1);
    expect(r.data.pending_lore[0]).toMatchObject({
      id: 'lore_极光生物科技',
      kind: '势力',
      name: '极光生物科技',
      summary: '驻扎于第三工业区的外资安保集团',
      is_new: true,
      source_floor: -1,
      source_swipe: -1,
      created_day: 5,
    });
    expect(r.events.some(e => e.message.includes('新势力「极光生物科技」已注册'))).toBe(true);
  });

  it('在册势力：增量更新态势字段（键缺席不覆写）、不重复注册、不再进暂存门', () => {
    const baseline = {
      meta: { date: '2042-03-14', day_count: 5 },
      factions: [{ name: '极光生物科技', attitude: '中立', risk: '低', intel: '旧认知' }],
    };
    const r = parseMessageText('<事件>\n- 类型: 势力发现\n  名称: 极光生物科技\n  态度: 警觉\n</事件>', baseline);
    expect(r.data.factions).toEqual([
      { name: '极光生物科技', attitude: '警觉', risk: '低', intel: '旧认知' }, // 风险/情报未被空声明覆写
    ]);
    expect(r.data.pending_lore).toEqual([]); // 已知势力不走 Q4 暂存
  });

  it('权威名单模糊对齐：「极光生物」与「极光生物科技」归一到同一条档案，不生分叉（§6.1.3）', () => {
    const baseline = {
      factions: [{ name: '极光生物科技', attitude: '中立', risk: '低', intel: '旧认知' }],
    };
    const authority = { names: ['极光生物科技'], aliases: {} };
    const r = parseMessageText('<事件>\n- 类型: 势力发现\n  名称: 极光生物\n  态度: 敌意\n</事件>', baseline, {
      authority,
    });
    expect(r.data.factions).toHaveLength(1); // 唯一包含命中→归一权威名→在册更新
    expect(r.data.factions[0]).toMatchObject({ name: '极光生物科技', attitude: '敌意' });
    expect(r.data.pending_lore).toEqual([]);
    expect(r.issues.some(i => i.rule === 'R19' && i.message.includes('极光生物'))).toBe(true); // 🟡低置信留痕可记别名
  });

  it('完全未知新实体：保留原文注册并交由暂存门接管（无权威名单时零对齐零分叉误判）', () => {
    const r = parseMessageText('<事件>\n- 类型: 势力发现\n  名称: 独眼离队佣兵团\n</事件>', {});
    expect(r.data.factions).toEqual([{ name: '独眼离队佣兵团', attitude: '未接触', risk: '未知', intel: '' }]);
    expect(r.data.pending_lore[0]).toMatchObject({ id: 'lore_独眼离队佣兵团', kind: '势力', is_new: true });
    expect(String(r.data.pending_lore[0].summary)).toContain('新发现势力');
  });

  it('🟡 黄通道归一枚举同样入账：非法态度/风险按兑底入库并暂存', () => {
    const r = parseMessageText('<事件>\n- 类型: 势力发现\n  名称: X集团\n  态度: 极度仇视\n  风险: 极高\n</事件>', {});
    expect(r.data.factions).toEqual([{ name: 'X集团', attitude: '未接触', risk: '未知', intel: '' }]);
    expect(r.data.pending_lore).toHaveLength(1);
  });
});

describe('EVT-PARSE-02 · 情报获取入账（intel 标准快照）', () => {
  it('标准情报快照条目：IntelItem 字段面（src/content/cred＋date 取本楼公历、未读不置顶）', () => {
    const r = parseMessageText(`<事件>\n${SAMPLE_INTEL.trim()}\n</事件>`, {
      meta: { date: '2042-03-14', day_count: 5 },
    });
    expect(r.data.intel).toEqual([
      {
        src: '无线电监听',
        content: '敌方巡林队将于三日后换防，防线出现 6 小时空窗',
        date: '2042-03-14',
        cred: '高',
        read: false,
        pinned: false,
      },
    ]);
    expect(r.events.some(e => e.message.includes('情报已入流水'))).toBe(true);
  });

  it('canon(content) 跨楼判重：同内容情报重复声明不重复入流水', () => {
    const first = parseMessageText(`<事件>\n${SAMPLE_INTEL.trim()}\n</事件>`, {});
    const second = parseMessageText(`<事件>\n${SAMPLE_INTEL.trim()}\n</事件>`, first.data);
    expect(second.data.intel).toHaveLength(1);
  });

  it('BUG-LIVE-27b（#78楼实机复现）：情报获取事件省略「内容」键时支持从「目标 + 原因」组装内容并消费「价值」为可信度', () => {
    const r = parseMessageText(
      `<事件>
- 类型: 情报获取
  目标: 盟军前线防空网与超时空节点
  价值: 高
  原因: 经高分光学遥感星座与截获电文交叉比对确认坐标
</事件>`,
      { meta: { date: '2042-05-01', day_count: 20 } },
    );
    expect(r.quarantine).toHaveLength(0);
    expect(r.data.intel).toEqual([
      {
        src: '未知来源',
        content: '盟军前线防空网与超时空节点：经高分光学遥感星座与截获电文交叉比对确认坐标',
        date: '2042-05-01',
        cred: '高',
        read: false,
        pinned: false,
      },
    ]);
  });
});

describe('EVT-PARSE-02 · 任务接取入账（quests.active）', () => {
  it('新任务：接取入编 active（note 兑底空串、进度/详情逃逃实入）', () => {
    const r = parseMessageText(`<事件>\n${SAMPLE_QUEST.trim()}\n</事件>`, {});
    expect(r.data.quests.active).toEqual([
      { name: '猎取高纯微晶样本', progress: '0/3', note: '', detail: '渗透敌方精炼厂获取 5 份样本' },
    ]);
    expect(r.events.some(e => e.message.includes('新任务「猎取高纯微晶样本」已接取入编'))).toBe(true);
  });

  it('在编任务增量更新：同任务再声明只更新进度，不重建条目', () => {
    const first = parseMessageText(`<事件>\n${SAMPLE_QUEST.trim()}\n</事件>`, {});
    const second = parseMessageText(
      '<事件>\n- 类型: 任务接取\n  名称: 猎取高纯微晶样本\n  进度: 2/3\n</事件>',
      first.data,
    );
    expect(second.data.quests.active).toHaveLength(1);
    expect(second.data.quests.active[0]).toMatchObject({ progress: '2/3', detail: '渗透敌方精炼厂获取 5 份样本' });
  });
});

describe('EVT-PARSE-02 · 红线与经济账本隔离', () => {
  it('Q9 配额联动：8 条任务仅前 5 条入编，超额安全截断不入账', () => {
    const text = Array.from({ length: 8 }, (_v, i) => `- 类型: 任务接取\n  名称: 任务${i + 1}`).join('\n');
    const r = parseMessageText(`<事件>\n${text}\n</事件>`, {});
    expect(r.data.quests.active).toHaveLength(5);
    expect(r.quarantine.filter(q => q.tag === '事件' && q.error.includes('配额超限'))).toHaveLength(3);
  });

  it('Q2 越权条目零入账：credits 键整项隔离，认知账本分毫未动', () => {
    const r = parseMessageText('<事件>\n- 类型: 势力发现\n  名称: X集团\n  credits: 999999\n</事件>', {
      factions: [{ name: '旧势力', attitude: '中立', risk: '低', intel: '' }],
    });
    expect(r.data.factions).toHaveLength(1); // 只有基线旧势力，越权新势力未入账
    expect(r.data.pending_lore).toEqual([]);
    expect(r.data.economy.credits).toBe(0);
  });

  it('链类声明仍不在解析层建链：纯资金链楼层 applied false、chains/credits 零变化（结转第四齿轮）', () => {
    const r = parseMessageText(`<事件>\n${SAMPLE_CHAIN_ESTABLISH.trim()}\n</事件>`, {});
    expect(r.eventDeclarations).toHaveLength(1);
    expect(r.applied).toBe(false);
    expect(r.data.economy.chains).toEqual([]);
    expect(r.data.economy.credits).toBe(0);
  });

  it('同楼混合声明分道入账：势力/情报/任务进认知账本，链类结转结算（互不污染）', () => {
    const raw = [
      '<事件>',
      SAMPLE_FACTION.trim(),
      SAMPLE_INTEL.trim(),
      SAMPLE_QUEST.trim(),
      SAMPLE_CHAIN_ESTABLISH.trim(),
      '</事件>',
    ].join('\n');
    const r = parseMessageText(raw, {});
    expect(r.data.factions).toHaveLength(1);
    expect(r.data.intel).toHaveLength(1);
    expect(r.data.quests.active).toHaveLength(1);
    expect(r.data.pending_lore).toHaveLength(1);
    expect(r.data.economy.chains).toEqual([]); // 链类不入账
    expect(r.eventDeclarations).toHaveLength(4);
  });

  it('BUG-R2-09：① <事件> 资金链受挫/恢复提取可选 eff（0~2）且无冗余字段修复告警；② <资金链> 块尊重 exhausted 终态锁（除非显式扩容 remaining_cap > 0）', () => {
    // ① <事件> 资金链受挫/恢复提取 eff
    const rEvt = parseMessageText(
      [
        '<事件>',
        '- 类型: 资金链受挫',
        '  名称: 北坡走私通道',
        '  效率: 0.3',
        '  理由: 护卫队遭伏击',
        '- 类型: 资金链恢复',
        '  名称: 远东矿石专线',
        '  eff: 1.5',
        '  理由: 增派双倍押运车队超额运转',
        '</事件>',
      ].join('\n'),
      {},
    );
    expect(rEvt.quarantine).toHaveLength(0);
    expect(rEvt.eventDeclarations).toHaveLength(2);
    expect(rEvt.eventDeclarations[0]).toMatchObject({
      verb: '资金链受挫',
      kind: 'chain',
      chain: { name: '北坡走私通道', eff: 0.3, reason: '护卫队遭伏击' },
    });
    expect(rEvt.eventDeclarations[1]).toMatchObject({
      verb: '资金链恢复',
      kind: 'chain',
      chain: { name: '远东矿石专线', eff: 1.5, reason: '增派双倍押运车队超额运转' },
    });

    // ② <资金链> 块 exhausted 终态锁
    const baseWithExhausted = {
      economy: {
        chains: [
          {
            id: 'chain_北坡浅层灵脉',
            name: '北坡浅层灵脉',
            flow: '收入' as const,
            rate_daily: 500,
            status: 'exhausted' as const,
            eff: 0,
            deps: { base_id: '北坡主基地', buildings: ['矿石精炼厂'], world_resource: '' },
            capacity: { total_yield: 1000, extracted: 1000 },
            reason: '矿脉已采空',
            updated_at_day: 3,
          },
        ],
      },
    };

    // 未显式扩容时，即使 LLM 报 状态: 活跃 / 效率: 1，仍保持 exhausted 且 eff=0
    const rLocked = parseMessageText(
      [
        '<资金链>',
        '- 名称: 北坡浅层灵脉',
        '  日产量: 500',
        '  状态: 活跃',
        '  效率: 1',
        '  原因: 误报恢复',
        '</资金链>',
      ].join('\n'),
      baseWithExhausted,
    );
    expect(rLocked.data.economy.chains[0].status).toBe('exhausted');
    expect(rLocked.data.economy.chains[0].eff).toBe(0);

    // 显式扩容（剩余储量 / 总储量 > 已开采）时，允许解除枯竭恢复为 active
    const rExpanded = parseMessageText(
      [
        '<资金链>',
        '- 名称: 北坡浅层灵脉',
        '  日产量: 500',
        '  状态: 活跃',
        '  效率: 1',
        '  剩余储量: 800',
        '  原因: 勘探发现深层富矿脉扩容',
        '</资金链>',
      ].join('\n'),
      baseWithExhausted,
    );
    expect(rExpanded.data.economy.chains[0].status).toBe('active');
    expect(rExpanded.data.economy.chains[0].eff).toBe(1);
    expect(rExpanded.data.economy.chains[0].capacity.total_yield).toBe(1800);
  });

  it('BUG-R2-21：① <资金链> 日产/剩余容量别名与筹建 (establishing) 状态及 <事件> 资金链开通闭环；② <态势>.资源 六柱矿物/材料/粮食/军火/燃料别名；③ <世界演变>/<情报> 紧急度/趋势/影响零隔离映射', () => {
    // Floor #42：声明 <资金链>（含 日产、剩余容量、状态: 筹建）、<态势>.资源（矿物、材料、粮食、军火、燃料）、<世界演变>（紧急度、趋势、影响）
    const floor42Raw = [
      '<资金链>',
      '- 名称: 红峰高品位赤铁伴生矿脉',
      '  日产: 5000',
      '  状态: 活跃',
      '- 名称: 荒坂废弃芯片厂残料拆解线',
      '  日产: 1000',
      '  剩余容量: 2000',
      '  状态: 活跃',
      '- 名称: 夜之城恶土黑市军火走私线',
      '  日产: 3200',
      '  状态: 筹建',
      '</资金链>',
      '<态势>',
      '资源:',
      '  矿物: {"铁矿": 500, "铜矿": 300}',
      '  材料: {"特种合金": 500, "电子元件": 500}',
      '  粮食: {"压缩军粮": 200}',
      '  军火: {"步兵制式弹药": 400}',
      '  燃料: {"航空煤油": 150}',
      '</态势>',
      '<世界演变>',
      '- 标题: 恶土游击队破袭预警',
      '  紧急度: "高"',
      '  趋势: "恶化"',
      '  影响: "矿区运输线与精炼设施面临游击队破袭威胁"',
      '</世界演变>',
    ].join('\n');

    const r42 = parseMessageText(floor42Raw, { economy: { credits: 10000 } });
    expect(r42.quarantine).toEqual([]);

    // 校验 <资金链> 日产、剩余容量与筹建 (establishing) 状态
    const cMine = r42.data.economy.chains.find(c => c.name === '红峰高品位赤铁伴生矿脉')!;
    const cScrap = r42.data.economy.chains.find(c => c.name === '荒坂废弃芯片厂残料拆解线')!;
    const cSmuggle = r42.data.economy.chains.find(c => c.name === '夜之城恶土黑市军火走私线')!;
    expect(cMine.rate_daily).toBe(5000);
    expect(cMine.status).toBe('active');
    expect(cScrap.rate_daily).toBe(1000);
    expect(cScrap.capacity).toEqual({ total_yield: 2000, extracted: 0 });
    expect(cSmuggle.rate_daily).toBe(3200);
    expect(cSmuggle.status).toBe('establishing');
    expect(cSmuggle.eff).toBe(0);

    // 校验 <态势>.资源 六柱同义词
    expect(r42.data.economy.resources?.minerals['铁矿']).toBe(500);
    expect(r42.data.economy.resources?.minerals['铜矿']).toBe(300);
    expect(r42.data.economy.resources?.materials['特种合金']).toBe(500);
    expect(r42.data.economy.resources?.materials['电子元件']).toBe(500);
    expect(r42.data.economy.resources?.logistics['压缩军粮']).toBe(200);
    expect(r42.data.economy.resources?.munitions['步兵制式弹药']).toBe(400);
    expect(r42.data.economy.resources?.fuel['航空煤油']).toBe(150);

    // 校验 <世界演变> 紧急度、趋势、影响入库且零隔离
    const worldItem = r42.data.intel.find(i => i.title === '恶土游击队破袭预警')!;
    expect(worldItem).toBeDefined();
    expect(worldItem.scope).toBe('world');
    expect(worldItem.content).toBe('矿区运输线与精炼设施面临游击队破袭威胁');
    expect(worldItem.hook).toBe('矿区运输线与精炼设施面临游击队破袭威胁');

    // Floor #44：触发 <事件> 资金链开通（不带 额度/日产），将 establishing 链条激活为 active 并保留原有的 rate_daily (3200)，同时推进 2 天使有限容量拆解线耗尽转入 exhausted
    const floor44Raw = [
      '<timePast>2D</timePast>',
      '<事件>',
      '- 类型: "资金链开通"',
      '  名称: "夜之城恶土黑市军火走私线"',
      '  详情: "与恶土中间人完成武装押运交接，走私线正式投产运行"',
      '</事件>',
    ].join('\n');

    const r44Parsed = parseMessageText(floor44Raw, r42.data);
    expect(r44Parsed.quarantine).toEqual([]);
    expect(r44Parsed.eventDeclarations).toHaveLength(1);
    const smuggleAfterParse = r44Parsed.data.economy.chains.find(c => c.name === '夜之城恶土黑市军火走私线')!;
    expect(smuggleAfterParse.status).toBe('active');
    expect(smuggleAfterParse.rate_daily).toBe(3200);

    const r44Settled = settleFloor(r42.data, r44Parsed.data, floor44Raw, {
      eventDeclarations: r44Parsed.eventDeclarations,
    });
    const smuggleAfterSettle = r44Settled.data.economy.chains.find(c => c.name === '夜之城恶土黑市军火走私线')!;
    const scrapAfterSettle = r44Settled.data.economy.chains.find(c => c.name === '荒坂废弃芯片厂残料拆解线')!;
    expect(smuggleAfterSettle.status).toBe('active');
    expect(smuggleAfterSettle.eff).toBe(1);
    expect(smuggleAfterSettle.rate_daily).toBe(3200);
    // 有限容量拆解线（1000/日 × 2天 = 2000）恰好采空并自动跃迁为 exhausted
    expect(scrapAfterSettle.capacity.extracted).toBe(2000);
    expect(scrapAfterSettle.status).toBe('exhausted');
    expect(scrapAfterSettle.eff).toBe(0);
  });

  it('BUG-R2-24(1)：<情报> 块含 TTL/紧急度/可信度:确认 仍保持 scope: tactical（不误判为 world），<世界演变> 阶段: 显化 正确落盘为 stage: 显化', () => {
    const floor60Raw = [
      '<情报>',
      '- 编号: INTEL-R2-02',
      '  标题: 升阳帝国远洋潜航母舰与纳米核心抵达夜之城外海',
      '  来源: 恶土鹰眼一号天基侦察',
      '  可信度: 确认',
      '  紧急度: 高',
      '  TTL: 6',
      '  详情: 侦测到升阳帝国制式「纳米核心（MCV）」与伴生机娘信号正在恶土西侧海岸线秘密登陆。',
      '</情报>',
      '<世界演变>',
      '- 编号: WEVO-03',
      '  标题: 太平洋远东升阳帝国介入北美西海岸战局',
      '  阶段: 显化',
      '  趋势: 升级',
      '  紧急度: 高',
      '  TTL: 8',
      '  影响: 第四阵营升阳帝国的变形载具与波能科技即将进入战场',
      '</世界演变>',
    ].join('\n');

    const res60 = parseMessageText(floor60Raw, { economy: { credits: 10000 } });
    expect(res60.quarantine).toEqual([]);
    expect(res60.data.intel).toHaveLength(2);

    const tacIntel = res60.data.intel.find(i => i.id === 'INTEL-R2-02')!;
    expect(tacIntel).toBeDefined();
    expect(tacIntel.scope).toBe('tactical');
    expect(tacIntel.cred).toBe('高');
    expect(tacIntel.status).toBe('已证实');
    expect(tacIntel.stage).toBeUndefined();
    expect(tacIntel.evo_domain).toBeUndefined();
    expect(tacIntel.ttl_floors).toBe(6);

    const wevo = res60.data.intel.find(i => i.id === 'WEVO-03')!;
    expect(wevo).toBeDefined();
    expect(wevo.scope).toBe('world');
    expect(wevo.stage).toBe('显化');
    expect(wevo.ttl_floors).toBe(8);
    expect(wevo.hook).toBe('第四阵营升阳帝国的变形载具与波能科技即将进入战场');
  });
});

