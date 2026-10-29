/**
 * CTRL-PARSE-L0-01 · L0 清洗回归夹具
 * - B 线真机原文 #4 / #10 / #18（fixtures/parseL0-bline.json，2026-09-23 抓取）
 * - 思考容器 / 正文容器 / 行首认领的边缘情况
 */
import { describe, expect, it } from 'vitest';
import { maskBody, sanitizeFloorText, stripThinking } from '../parse/floorSanitize';
import { parseMessageText } from '../parse/parsePipeline';
import { Schema } from '../core/schema';
import { parseTimePast } from '../parse/timePastParser';
import blineFixture from './fixtures/parseL0-bline.json';

const zero = () => Schema.parse({});
/** B 线世界为 cyber2042（钱包键「标准信用币 / 加密币」只在该世界合法） */
const cyber = () => Schema.parse({ meta: { world_id: 'cyber2042' } });
const bline: { floor4: string; floor10: string; floor18: string } = blineFixture;
const THINK_MARKERS = /complète|Blocs YAML|en YAML strict|Conception narrative|<\/think>|<正文>|emotion_check|-->/;
const isBiz = (n: string) => ['战况', '图鉴', '扩展档案', '数据更新', '机娘档案', '初始状态'].includes(n);

function noThinkLeak(r: ReturnType<typeof parseMessageText>) {
  for (const q of r.quarantine) {
    expect(q.raw).not.toMatch(THINK_MARKERS);
    expect(q.path ?? '').not.toMatch(THINK_MARKERS);
  }
}

describe('L0-01 · B 线真机回归夹具', () => {
  it('#4：思考段 5 条噪声全部消失，正文后的四个块照常入库', () => {
    const r = parseMessageText(bline.floor4, cyber(), {});
    noThinkLeak(r);
    expect(r.quarantine).toEqual([]);
    expect(r.data.meta.date).toBe('2042-03-14');
    expect(r.data.queues.map(q => q.item)).toContain('静默折光伪装网试制');
    expect(r.data.pending_expansions.length).toBeGreaterThan(0);
    expect(r.data.pending_data_patches).toHaveLength(1);
    expect(r.data.pending_data_patches[0]).toMatchObject({ target: '白凌', patch: { 现场修复距离: '15步' } });
    expect(r.events.some(e => e.layer === 'L0' && /已剥离思考段/.test(e.message))).toBe(true);
  });

  it('#10：正文不再被吞进 <战况>，战况键全部正常映射', () => {
    const r = parseMessageText(bline.floor10, cyber(), {});
    noThinkLeak(r);
    expect(r.quarantine).toEqual([]);
    expect(r.data.economy.credits).toBe(1400);
    expect(r.data.meta.day_count).toBe(1);
  });

  it('#18：思考段 <timePast> 被忽略，只读正文后的那一个；正文内注释不再污染战况', () => {
    const r = parseMessageText(bline.floor18, cyber(), {});
    noThinkLeak(r);
    expect(r.quarantine).toEqual([]);
    expect(r.data.meta).toMatchObject({ date: '2042-03-16', day_count: 3 });
    expect(r.data.economy.credits).toBe(900);
    expect(r.data.queues.find(q => q.item === '基础步兵训练学')).toMatchObject({ progress: 98 });

    const think = bline.floor18.indexOf('</think>');
    const firstTp = bline.floor18.indexOf('<timePast>');
    expect(firstTp).toBeLessThan(think); // 夹具前提：思考段里确实先出现了一次
    const t = parseTimePast(bline.floor18);
    expect(t).toMatchObject({ success: true, deltaMinutes: 360 });
    expect(sanitizeFloorText(bline.floor18, isBiz).thinkFree.match(/<timePast>/g)).toHaveLength(1);
  });

  it('三楼剥离后的业务文本都不含思考段与正文', () => {
    for (const raw of [bline.floor4, bline.floor10, bline.floor18]) {
      const s = sanitizeFloorText(raw, isBiz);
      expect(s.business).not.toMatch(/<\/?think>|<\/?正文>|Blocs|Conception/);
      expect(s.business).toMatch(/^<战况>$/m);
    }
  });
});

describe('L0-01 · 思考容器边缘情况', () => {
  const tail = '<战况>\n资金: 500\n</战况>';

  it.each(['think', 'thinking', 'reasoning', 'thought', '思考', '思考过程', '思维链', 'THINK', 'Think'])(
    '容器名 <%s> 被剥离',
    name => {
      const raw = `<${name}>\n计划：输出 <战况>, <图鉴>\n<战况>\n资金: 1\n</战况>\n</${name}>\n${tail}`;
      const r = parseMessageText(raw, zero(), {});
      expect(r.data.economy.credits).toBe(500);
      expect(r.quarantine).toEqual([]);
    },
  );

  it('思考容器带属性 / 全角括号', () => {
    const r1 = parseMessageText(`<think type="plan">\n<战况>\n资金: 1\n</战况>\n</think>\n${tail}`, zero(), {});
    expect(r1.data.economy.credits).toBe(500);
    const r2 = parseMessageText(`＜think＞\n<战况>\n资金: 1\n</战况>\n＜/think＞\n${tail}`, zero(), {});
    expect(r2.data.economy.credits).toBe(500);
  });

  it('残缺：只有 </think>（开头被宿主截掉），之前的全部内容丢弃', () => {
    const raw = `Blocs YAML finaux :\n<战况>\n资金: 1\n</战况>\n</think>\n${tail}`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(500);
    expect(r.events.some(e => /think-orphan-close/.test(e.message))).toBe(true);
  });

  it('残缺闭标签紧贴 <正文>（#4 / #10 真机形态）', () => {
    const raw = `plan : bloc <战况> en YAML.</think><正文>\n在地底两小时。\n</正文>\n${tail}`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(500);
    expect(r.quarantine).toEqual([]);
  });

  it('残缺闭标签后面什么都没有 → 视为尾部垃圾，不删前文', () => {
    const { text, notes } = stripThinking(`${tail}\n</think>`);
    expect(text).toContain('资金: 500');
    expect(notes).toEqual([]);
  });

  it('句中提到 </think> 不算残缺闭标签', () => {
    const raw = `${tail}\n她说 </think> 这个词很奇怪，然后继续。`;
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(500);
  });

  it('句中提到 <think> 不开容器', () => {
    const raw = `模型会写 <think> 标签，但这里只是叙述。\n${tail}`;
    const { notes } = stripThinking(raw);
    expect(notes).toEqual([]);
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(500);
  });

  it('容器内再次提到 <think> 不算嵌套，第一个闭标签结束容器', () => {
    const raw = `<think>\n注意 <think> 与 </think> 的写法\n还有 <战况>\n</think>\n${tail}`;
    const s = stripThinking(raw);
    expect(s.text).not.toContain('注意');
    expect(s.text).toContain('写法');
  });

  it('多个思考容器都被剥离', () => {
    const raw = `<think>\n<战况>\n资金: 1\n</战况>\n</think>\n正文一\n<thinking>\n<战况>\n资金: 2\n</战况>\n</thinking>\n${tail}`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(500);
    expect(r.applied).toBe(true);
  });

  it('未闭合思考容器 + 行首 <正文>：截到 <正文>，记 🟡', () => {
    const raw = `<think>\n<战况>\n资金: 1\n</战况>\n<正文>\n故事\n</正文>\n${tail}`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(500);
    expect(r.events.some(e => e.light === '🟡' && /思考段未闭合/.test(e.message))).toBe(true);
  });

  it('未闭合思考容器且没有 <正文>：fail-closed 全部截掉，不入库思考里的战况', () => {
    const r = parseMessageText('<think>\n<战况>\n资金: 1\n</战况>', zero(), {});
    expect(r.data.economy.credits).toBe(0);
    expect(r.issues.some(i => i.rule === 'R17' && i.target === 'think')).toBe(true);
  });

  it('CRLF 换行也能识别行首', () => {
    const raw = '<think>\r\n<战况>\r\n资金: 1\r\n</战况>\r\n</think>\r\n<战况>\r\n资金: 500\r\n</战况>';
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(500);
  });

  it('非思考标签（interactive_input / 注释）不受影响', () => {
    const raw = `<interactive_input>\n玩家输入\n</interactive_input>\n<!-- emotion_check: ok -->\n${tail}`;
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(500);
  });

  it('空 / 非字符串输入安全', () => {
    expect(stripThinking('').text).toBe('');
    expect(stripThinking(undefined as unknown as string).text).toBe('');
    expect(parseMessageText(undefined as unknown as string, zero(), {}).applied).toBe(false);
  });
});

describe('L0-01 · 行首认领 / 句中提及', () => {
  it('句中列举标签名不再切出逗号块（#4 形态，无思考容器包裹）', () => {
    const raw = `Blocs YAML finaux : <战况>, <图鉴>, <扩展档案>, <数据更新>.\n<战况>\n资金: 500\n</战况>`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.quarantine).toEqual([]);
    expect(r.data.economy.credits).toBe(500);
    expect(r.events.some(e => /忽略句中提及的业务标签 4 处/.test(e.message))).toBe(true);
  });

  it('块内容里提到其他业务标签，不截断当前块', () => {
    const raw = '<图鉴>\n- 名称: 磁暴线圈\n  类别: 建筑\n  简介: 数值见 <战况> 的电力栏\n</图鉴>';
    const r = parseMessageText(raw, zero(), {});
    expect(r.quarantine).toEqual([]);
    expect(r.data.codex[0]).toMatchObject({ name: '磁暴线圈', desc: '数值见 <战况> 的电力栏' });
  });

  it('前导空白 / 全角空格的行首标签照常认领', () => {
    expect(parseMessageText('   <战况>\n资金: 501\n</战况>', zero(), {}).data.economy.credits).toBe(501);
    expect(parseMessageText('\u3000<战况>\n资金: 502\n</战况>', zero(), {}).data.economy.credits).toBe(502);
  });

  it('紧跟另一标签闭合（同一行）照常认领', () => {
    const r = parseMessageText('</正文><战况>\n资金: 503\n</战况><图鉴>\n- 名称: X\n  类别: 科技\n</图鉴>', zero(), {});
    expect(r.data.economy.credits).toBe(503);
    expect(r.data.codex[0]).toMatchObject({ name: 'X' });
  });

  it('句末黏连「。<战况>⏎」不认领，但给 🟡 提示', () => {
    const r = parseMessageText('故事结束。<战况>\n资金: 504\n</战况>', zero(), {});
    expect(r.data.economy.credits).toBe(0);
    expect(r.issues.some(i => i.rule === 'R17' && /黏连/.test(i.message))).toBe(true);
  });

  it('单行块 <战况>资金: 505</战况> 在行首仍可读', () => {
    expect(parseMessageText('<战况>资金: 505</战况>', zero(), {}).data.economy.credits).toBe(505);
  });
});

describe('L0-01 · 正文容器', () => {
  const tail = '<战况>\n资金: 500\n</战况>';

  it('战报在正文之后（标准形态）', () => {
    const raw = `<正文>\n故事。\n</正文>\n\n${tail}`;
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(500);
  });

  it('正文内部行首的战报块不提取', () => {
    const raw = `<正文>\n示例：\n<战况>\n资金: 1\n</战况>\n</正文>\n${tail}`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(500);
    expect(r.quarantine).toEqual([]);
  });

  it('正文内部只有示例、正文外无战报 → 不入库', () => {
    const r = parseMessageText('<正文>\n<战况>\n资金: 1\n</战况>\n</正文>', zero(), {});
    expect(r.data.economy.credits).toBe(0);
  });

  it('未闭合 <正文> 只延伸到下一个行首业务标签（驾驶员认可的兜底）', () => {
    const raw = `<正文>\n故事写完了但忘了闭合。\n${tail}\n<图鉴>\n- 名称: Y\n  类别: 科技\n</图鉴>`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(500);
    expect(r.data.codex[0]).toMatchObject({ name: 'Y' });
  });

  it('未闭合 <正文> 里句中提到 <战况> 不算边界', () => {
    const raw = `<正文>\n她看着 <战况> 面板发呆。\n${tail}`;
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(500);
    expect(r.quarantine).toEqual([]);
  });

  it('未闭合 <正文> 且后面没有业务标签 → 屏蔽到文末', () => {
    const { text, notes } = maskBody('<正文>\n故事。\n<!-- 注释 -->', isBiz);
    expect(text.trim()).toBe('');
    expect(notes[0].kind).toBe('body-unclosed');
  });

  it('句中提到 <正文> 不开容器', () => {
    const raw = `规则：不要在 <正文> 里写战报\n${tail}`;
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(500);
  });

  it('多段正文各自屏蔽', () => {
    const raw = `<正文>\n一\n</正文>\n${tail}\n<正文>\n<战况>\n资金: 9\n</战况>\n</正文>`;
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(500);
  });
});

describe('L0-01 · 代码围栏', () => {
  it('围栏包在战报块外面', () => {
    const raw = '```yaml\n<战况>\n资金: 600\n</战况>\n```';
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(600);
  });

  it('围栏与开标签同一行', () => {
    const raw = '```<战况>\n资金: 601\n</战况>```';
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(601);
  });

  it('块内部的围栏（既有行为）', () => {
    const raw = '<战况>\n```yaml\n资金: 602\n```\n</战况>';
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(602);
  });

  it('思考段里的围栏战报不入库', () => {
    const raw = '<think>\n```yaml\n<战况>\n资金: 1\n</战况>\n```\n</think>\n```yaml\n<战况>\n资金: 603\n</战况>\n```';
    expect(parseMessageText(raw, zero(), {}).data.economy.credits).toBe(603);
  });

  it('句中两个反引号后的标签不算行首', () => {
    const raw = '写成 ``<战况>`` 即可。\n<战况>\n资金: 604\n</战况>';
    const r = parseMessageText(raw, zero(), {});
    expect(r.data.economy.credits).toBe(604);
    expect(r.quarantine).toEqual([]);
  });
});

describe('L0-01 · timePast 只读清洗后文本', () => {
  it('思考段与正文后各一个：取正文后的', () => {
    const raw =
      '<think>\n- <timePast>9 D 0 H 0 M</timePast> placé avant <战况>.\n</think>\n<正文>\n故事\n</正文>\n<timePast>0 D 2 H 0 M</timePast>';
    expect(parseTimePast(raw).deltaMinutes).toBe(120);
  });

  it('只在思考段里出现：视为缺失（兜底由调用方决定）', () => {
    const r = parseTimePast('<think>\n<timePast>1 D</timePast>\n</think>\n故事', { defaultMinutes: 0 });
    expect(r).toMatchObject({ success: false, isFallback: true, deltaMinutes: 0 });
  });

  it('残缺 </think> 前的 timePast 被丢弃', () => {
    const r = parseTimePast('<timePast>1 D</timePast></think>\n<timePast>30 M</timePast>');
    expect(r.deltaMinutes).toBe(30);
  });

  it('无思考段时行为不变', () => {
    expect(parseTimePast('<timePast>1 D 2 H 30 M</timePast>').deltaMinutes).toBe(1590);
  });
});
