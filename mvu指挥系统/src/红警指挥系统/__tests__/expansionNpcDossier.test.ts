import { describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import { parseMessageText } from '../parse/parsePipeline';
import {
  deriveCodexFromExpansion,
  makeExpansionComment,
  renderExpansionContent,
  stripExpansionCommentPrefix,
  upsertExpansionEntry,
} from '../worldbook/expansionFiler';

describe('FD-32 PKG-A: <扩展档案> 人物分支解析、动态信任度追踪与世界书渲染', () => {
  it('解析 <扩展档案> 类别: 人物（或 NPC 别名），提取立体设定与动态关系并同步至 codex', () => {
    const initial = Schema.parse({});
    const raw = `
<扩展档案>
- 名称: 维克托·科尔萨科夫
  类别: 人物
  代号: 铁砧上校
  所属势力: 极北铁道防卫旅
  身份: 防卫旅前线装甲指挥官
  态度: 合作
  信任度: 68
  信任变化: +8
  状态: 驻守新西伯利亚西段编组站
  简介: 经验老道的原苏军铁道装甲旅上校，掌握西伯利亚冻土带铁路网调度权。
  外貌特征: 左眼带旧弹片疤痕，身着深灰防寒装甲大衣，习惯咬着铜管烟斗。
  性格与口吻: 作风硬朗务实，说话简短干脆，重承诺。
  能力: 冻土带装甲集群机动调度、旧苏军战备仓库启封权限
  近期交集: 在西段编组站解围战中与北坡基地达成联防协定。
  设定: |
    维克托·科尔萨科夫曾任远东铁道防卫旅参谋长，大灾变后率残部依托新西伯利亚编组站建立独立防区。
  触发词: [维克托, 科尔萨科夫]
</扩展档案>
`;
    const res = parseMessageText(raw, initial);
    expect(res.quarantine).toHaveLength(0);
    expect(res.data.pending_expansions).toHaveLength(1);

    const exp = res.data.pending_expansions[0]!;
    expect(exp.name).toBe('维克托·科尔萨科夫');
    expect(exp.kind).toBe('人物');
    expect(exp.params['代号']).toBe('铁砧上校');
    expect(exp.params['所属势力']).toBe('极北铁道防卫旅');
    expect(exp.params['身份']).toBe('防卫旅前线装甲指挥官');
    expect(exp.params['态度']).toBe('合作');
    expect(exp.params['信任度']).toBe('68');
    expect(exp.params['信任变化']).toBe('+8');
    expect(exp.params['状态']).toBe('驻守新西伯利亚西段编组站');
    expect(exp.params['外貌特征']).toContain('左眼带旧弹片疤痕');
    expect(exp.params['性格与口吻']).toContain('作风硬朗务实');
    expect(exp.params['近期交集']).toContain('达成联防协定');
    // 自动将代号并入 keys
    expect(exp.keys).toContain('铁砧上校');

    // 同步至 stat_data.codex
    const codexNpc = res.data.codex.find(c => c.name === '维克托·科尔萨科夫');
    expect(codexNpc).toBeDefined();
    expect(codexNpc?.kind).toBe('人物');
    expect(codexNpc?.params['信任度']).toBe('68');
    expect(codexNpc?.params['态度']).toBe('合作');
  });

  it('支持跨轮次对既有 codex 人物按 信任变化 (±N) 增量累加并钳制单次 [-25, +25]', () => {
    const state1 = Schema.parse({
      codex: [
        {
          name: '维克托·科尔萨科夫',
          kind: '人物',
          desc: '极北铁道防卫旅装甲指挥官',
          params: {
            代号: '铁砧上校',
            所属势力: '极北铁道防卫旅',
            态度: '合作',
            信任度: '68',
            状态: '驻守新西伯利亚西段编组站',
          },
        },
      ],
    });

    const rawDelta = `
<扩展档案>
- 名称: 维克托·科尔萨科夫
  类别: NPC
  态度: 友善
  信任变化: +40
  状态: 率铁道装甲列车抵达北坡外围协防
  近期交集: 指挥官亲自增援解围，铁砧上校对北坡基地高度信赖。
</扩展档案>
`;
    const res = parseMessageText(rawDelta, state1);
    expect(res.quarantine).toHaveLength(0);
    // 单次 +40 被钳制为 +25，68 + 25 = 93
    const exp = res.data.pending_expansions[0]!;
    expect(exp.kind).toBe('人物');
    expect(exp.params['信任变化']).toBe('+25');
    expect(exp.params['信任度']).toBe('93');
    expect(exp.params['态度']).toBe('友善');
    expect(exp.params['状态']).toBe('率铁道装甲列车抵达北坡外围协防');
    // 继承既有代号与所属势力
    expect(exp.params['代号']).toBe('铁砧上校');
    expect(exp.params['所属势力']).toBe('极北铁道防卫旅');

    const codexNpc = res.data.codex.find(c => c.name === '维克托·科尔萨科夫');
    expect(codexNpc?.params['信任度']).toBe('93');
    expect(codexNpc?.params['态度']).toBe('友善');
  });

  it('expansionFiler 为 类别: 人物 生成规范注释 人物·{name}·设定 与立体速览头', () => {
    const dossier = {
      name: '维克托·科尔萨科夫',
      kind: '人物' as const,
      desc: '经验老道的原苏军铁道装甲旅上校。',
      params: {
        代号: '铁砧上校',
        所属势力: '极北铁道防卫旅',
        身份: '防卫旅前线装甲指挥官',
        态度: '合作',
        信任度: '68',
        状态: '驻守新西伯利亚西段编组站',
        性格与口吻: '作风硬朗务实，说话简短干脆。',
      },
      detail: '维克托曾任远东铁道防卫旅参谋长，手握三条干线铁路的道岔控制权。',
      keys: ['维克托', '铁砧上校'],
    };

    expect(makeExpansionComment(dossier)).toBe('人物·维克托·科尔萨科夫·设定');
    expect(stripExpansionCommentPrefix('人物·维克托·科尔萨科夫·设定')).toBe('维克托·科尔萨科夫');

    const content = renderExpansionContent(dossier);
    expect(content).toContain('[红警扩展·人物 | 维克托·科尔萨科夫]');
    expect(content).toContain('· 代号：铁砧上校');
    expect(content).toContain('· 所属势力：极北铁道防卫旅');
    expect(content).toContain('· 态度：合作');
    expect(content).toContain('· 信任度：68');
    expect(content).toContain('· 性格与口吻：作风硬朗务实，说话简短干脆。');
    expect(content).toContain('维克托曾任远东铁道防卫旅参谋长');

    const upserted = upsertExpansionEntry([], dossier);
    expect(upserted.action).toBe('created');
    expect(upserted.entryName).toBe('人物·维克托·科尔萨科夫·设定');

    const codex = deriveCodexFromExpansion(dossier);
    expect(codex.kind).toBe('人物');
    expect(codex.params['代号']).toBe('铁砧上校');
  });
});
