/**
 * FD-FF-PREVIEW · 设置面板「实时报文预览」分区模型测试
 *
 * 核心契约：分区只是形态识别，解析后逐行拼回必须与原文逐字等价（不丢行、不改字）。
 */
import { describe, expect, it } from 'vitest';
import { parseFeedforwardPreview, splitPipeSegments } from '../panels/feedforwardPreviewModel';

const SAMPLE = [
  '[战区全局态势与参谋部八维组合诊断 · 只读前馈视图]',
  '来源：第 24 楼 stat_data（schema_version 2）｜本段为中控台自动计算',
  '· 当前战役阶段：阶段4 · 多产线协同与战区博弈期｜前馈模式：slow_sim',
  '【一、战区宏观态势】日期：2042-12-28（第 195 日 09:35）｜天气：阴',
  '· 驻地民生与环保屏障：在役民生设施(2)',
  '【本轮最新竣工与待收讫里程碑（参谋部重点督办）】',
  '· 🎉 [本轮刚竣工入账] 新突破科技《便携反装甲系统工学》',
  '  ※ 防错铁律：严禁重复输出 <生产> 收讫标签',
  '【三、基地群与排产上下文（共 3 座基地）】',
  '· 基地「暗河地下主基地」（ID:base_1｜状态:隐蔽中）：已建建筑(20)',
  '  - 防区工程：温水池、靶场',
  '  - 已开通产线(7)：主建筑建造线(容量1)',
  '【六、前端八维组合战术诊断】',
  '1. [P0·任务推进] 在途主线任务待推进（当前进度：3/4） —— 诊断：首优任务需收口',
  '2. [P2·后勤与资源] 战区资金流偏紧 —— 诊断：当前资金 225210',
].join('\n');

/** 把解析结果拼回近似原文，用于验证不丢内容 */
function flatten(doc: ReturnType<typeof parseFeedforwardPreview>): string[] {
  const out: string[] = [`[${doc.title}]`, ...doc.meta];
  for (const sec of doc.sections) {
    out.push(`【${sec.index ? `${sec.index}、` : ''}${sec.title}】${sec.lead}`);
    let diagNo = 0;
    for (const ln of sec.lines) {
      if (ln.kind === 'diag') {
        diagNo++;
        out.push(`${diagNo}. [${ln.priority}·${ln.label}] ${ln.text}${ln.detail ? ` —— 诊断：${ln.detail}` : ''}`);
      } else {
        out.push(ln.text);
      }
    }
  }
  return out;
}

describe('parseFeedforwardPreview', () => {
  it('标题、元信息、分区按原文顺序识别', () => {
    const doc = parseFeedforwardPreview(SAMPLE);
    expect(doc.title).toBe('战区全局态势与参谋部八维组合诊断 · 只读前馈视图');
    expect(doc.meta).toHaveLength(2);
    expect(doc.meta[0]).toContain('来源：第 24 楼');
    expect(doc.meta[1]).toContain('当前战役阶段');
    expect(doc.sections.map(s => s.title)).toEqual([
      '战区宏观态势',
      '本轮最新竣工与待收讫里程碑（参谋部重点督办）',
      '基地群与排产上下文（共 3 座基地）',
      '前端八维组合战术诊断',
    ]);
    expect(doc.sections.map(s => s.index)).toEqual(['一', '', '三', '六']);
  });

  it('分区标题同行正文进 lead，条目/子项/注记分别归类', () => {
    const doc = parseFeedforwardPreview(SAMPLE);
    expect(doc.sections[0].lead).toContain('日期：2042-12-28');
    expect(doc.sections[1].lines.map(l => l.kind)).toEqual(['item', 'note']);
    expect(doc.sections[2].lines.map(l => l.kind)).toEqual(['item', 'sub', 'sub']);
    expect(doc.sections[2].lines[1].text).toBe('防区工程：温水池、靶场');
  });

  it('P0/P1 诊断拆出优先级、领域标签与「—— 诊断：」正文', () => {
    const doc = parseFeedforwardPreview(SAMPLE);
    const [p0, p2] = doc.sections[3].lines;
    expect(p0).toMatchObject({ kind: 'diag', priority: 'P0', label: '任务推进' });
    expect(p0.text).toBe('在途主线任务待推进（当前进度：3/4）');
    expect(p0.detail).toBe('首优任务需收口');
    expect(p2.priority).toBe('P2');
    expect(p2.detail).toBe('当前资金 225210');
  });

  it('逐行拼回与原文等价（不丢行、不改字）', () => {
    const doc = parseFeedforwardPreview(SAMPLE);
    const back = flatten(doc);
    const origin = SAMPLE.split('\n').map(s =>
      s
        .trim()
        .replace(/^·\s*/, '')
        .replace(/^-\s*/, '')
        .replace(/^※\s*/, ''),
    );
    expect(back).toHaveLength(origin.length);
    for (let i = 0; i < back.length; i++) expect(back[i]).toBe(origin[i]);
  });

  it('无法识别的行按 text 保留，空行忽略', () => {
    const doc = parseFeedforwardPreview('[标题]\n\n【一、甲】\n裸行内容\n· 条目');
    expect(doc.sections[0].lines.map(l => l.kind)).toEqual(['text', 'item']);
    expect(doc.sections[0].lines[0].text).toBe('裸行内容');
  });

  it('空输入 / 非报文文本不炸也不造分区', () => {
    expect(parseFeedforwardPreview('')).toEqual({ title: '', meta: [], sections: [] });
    expect(parseFeedforwardPreview('// 暂无可生成的战略前馈视图').sections).toEqual([]);
  });

  it('splitPipeSegments 保留原字符，只做分段', () => {
    expect(splitPipeSegments('a｜b｜c')).toEqual(['a', 'b', 'c']);
    expect(splitPipeSegments('a｜b｜c').join('｜')).toBe('a｜b｜c');
    expect(splitPipeSegments('no-pipe')).toEqual(['no-pipe']);
  });
});
