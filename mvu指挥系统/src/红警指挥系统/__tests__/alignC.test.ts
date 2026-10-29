/**
 * 批 C 测试：简繁单字映射 / canon 增强 / alignName 匹配梯队 / 管道 authority 集成 / 无 authority 回归门。
 */
import { describe, expect, it } from 'vitest';
import { alignName, buildAlignIndex, canon, parseMessageText, type AuthorityInput } from '../parse/parsePipeline';
import { Schema } from '../core/schema';
import { toSimplified } from '../parse/t2s';

const zero = () => Schema.parse({});

describe('C1 · toSimplified 简繁单字映射', () => {
  it('繁体句整句转换', () => {
    expect(toSimplified('歐盟聯合防務學')).toBe('欧盟联合防务学');
    expect(toSimplified('湍流護盾')).toBe('湍流护盾');
  });
  it('简繁混杂文本逐字处理', () => {
    expect(toSimplified('磁暴線圈已建造完畢')).toBe('磁暴线圈已建造完毕');
  });
  it('无匹配（纯简体/ASCII/emoji）原样返回', () => {
    expect(toSimplified('相位折射涂层 MH-6 🟢')).toBe('相位折射涂层 MH-6 🟢');
    expect(toSimplified('')).toBe('');
  });
});

describe('C2 · canon 简繁归一', () => {
  it('繁简两侧 canon 相等', () => {
    expect(canon('歐盟聯合防務學')).toBe(canon('欧盟联合防务学'));
    expect(canon('　湍流護盾 ')).toBe(canon('湍流护盾'));
  });
});

describe('C3 · alignName 匹配梯队', () => {
  const authority: AuthorityInput = {
    names: ['欧盟联合防务学', '湍流护盾', '相位折射涂层', '磁暴线圈', '北坡主基地'],
    aliases: { 防务学速成: '欧盟联合防务学' },
  };
  const ai = buildAlignIndex(authority);

  it('精确命中', () => {
    expect(alignName('湍流护盾', ai)).toEqual({ name: '湍流护盾', hit: 'exact' });
  });
  it('canon 相等（繁体/全角空格变体）', () => {
    expect(alignName('湍流護盾', ai)).toEqual({ name: '湍流护盾', hit: 'canon' });
    expect(alignName('歐盟聯合防務學', ai)).toEqual({ name: '欧盟联合防务学', hit: 'canon' });
  });
  it('别名词典命中（canon 双侧比对）', () => {
    expect(alignName('防务学速成', ai)).toEqual({ name: '欧盟联合防务学', hit: 'alias' });
    expect(alignName('防務學速成', ai)).toEqual({ name: '欧盟联合防务学', hit: 'alias' }); // 变体的繁体写法也走 canon
  });
  it('编辑距离≤2 且候选唯一 → fuzzy', () => {
    expect(alignName('相位折射图层', ai)).toEqual({ name: '相位折射涂层', hit: 'fuzzy' });
  });
  it('包含关系唯一 → fuzzy', () => {
    expect(alignName('北坡基地', ai)).toEqual({ name: '北坡主基地', hit: 'fuzzy' });
  });
  it('多候选歧义 → miss 保留原名', () => {
    const ambiguous = buildAlignIndex({ names: ['北坡主基地', '北坡副基地'], aliases: {} });
    expect(alignName('北坡基地', ambiguous)).toEqual({ name: '北坡基地', hit: 'miss' });
  });
  it('全败 → miss 原名返回（新实体允许注册）', () => {
    expect(alignName('灵气涡轮增压器', ai)).toEqual({ name: '灵气涡轮增压器', hit: 'miss' });
  });
});

describe('C4 · 管道 authority 集成', () => {
  const authority: AuthorityInput = {
    names: ['湍流护盾', '相位折射涂层', '北坡主基地', '沈三刀'],
    aliases: {},
  };

  it('图鉴繁体变体名 → 已有条目 upsert 而非新建', () => {
    const base = Schema.parse({ codex: [{ name: '湍流护盾', kind: '科技', desc: '旧简介', params: {} }] });
    const r = parseMessageText('<图鉴>\n- 名称: 湍流護盾\n  简介: 新简介\n</图鉴>', base, { authority });
    expect(r.data.codex).toHaveLength(1);
    expect(r.data.codex[0].name).toBe('湍流护盾');
    expect(r.data.codex[0].desc).toBe('新简介');
    expect(r.events.some(e => e.light === '🟢' && /实体名对齐/.test(e.message))).toBe(true);
  });

  it('队列项繁体名对齐权威名入库', () => {
    const base = Schema.parse({ bases: [{ id: '北坡主基地', name: '北坡主基地', buildings: [] }] });
    const r = parseMessageText(
      '<战况>\n队列:\n  - 项目: 相位折射塗層\n    类型: 研究\n    基地: 北坡主基地\n    进度: 50\n</战况>',
      base,
      { authority },
    );
    expect(r.data.queues[0].item).toBe('相位折射涂层');
  });

  it('队列项全败 → 保留原名 + R19 info 留痕（不拦）', () => {
    const base = Schema.parse({ bases: [{ id: '北坡主基地', name: '北坡主基地', buildings: [] }] });
    const r = parseMessageText(
      '<战况>\n队列:\n  - 项目: 灵气涡轮增压器\n    类型: 研究\n    基地: 北坡主基地\n</战况>',
      base,
      { authority },
    );
    expect(r.data.queues[0].item).toBe('灵气涡轮增压器');
    expect(r.issues.some(i => i.rule === 'R19' && i.level === 'info')).toBe(true);
    expect(r.quarantine).toEqual([]);
  });

  it('基地定位名模糊命中 → 权威名定位不分裂 + R19 warn', () => {
    const base = Schema.parse({
      bases: [
        {
          id: '北坡主基地',
          name: '北坡主基地',
          location: '',
          status: '隐蔽中',
          power: { gen: 0, use: 0 },
          buildings: [],
          alerts: [],
        },
      ],
    });
    const r = parseMessageText('<战况>\n基地:\n  - 名称: 北坡基地\n    状态: 警戒\n</战况>', base, { authority });
    expect(r.data.bases).toHaveLength(1);
    expect(r.data.bases[0].name).toBe('北坡主基地');
    expect(r.data.bases[0].status).toBe('警戒');
    expect(r.issues.some(i => i.rule === 'R19' && i.level === 'warn')).toBe(true);
    expect(r.events.some(e => e.light === '🟡' && e.align?.from === '北坡基地' && e.align?.to === '北坡主基地')).toBe(
      true,
    );
  });

  it('操作:完成 目标繁体名对齐后收入收讫声明（F2-乙：入账归三色门）', () => {
    const base = Schema.parse({ queues: [{ type: '研究', item: '相位折射涂层', base: '', progress: 100, eta: '' }] });
    const r = parseMessageText('<战况>\n操作:\n  - 完成: 相位折射塗層\n</战况>', base, { authority });
    expect(r.operationCompletions).toEqual([expect.objectContaining({ item: '相位折射涂层' })]);
    expect(r.data.queues).toHaveLength(1);
    expect(r.data.tech.done).toHaveLength(0);
  });

  it('别名词典：已研科技变体直达🟢', () => {
    const r = parseMessageText('<战况>\n已研科技: [防务学速成]\n</战况>', zero(), {
      authority: { names: ['欧盟联合防务学'], aliases: { 防务学速成: '欧盟联合防务学' } },
    });
    expect(r.data.tech.done).toEqual(['欧盟联合防务学']);
    expect(r.issues.some(i => i.rule === 'R19' && i.level === 'warn')).toBe(false); // 别名是🟢不是🟡
  });
});

describe('C5 · 回归门：authority 缺省行为与旧版一致', () => {
  it('无 authority：图鉴新名照常注册，无 R19，无对齐事件', () => {
    const r = parseMessageText('<图鉴>\n- 名称: 灵气涡轮增压器\n  类别: 科技\n</图鉴>', zero(), {});
    expect(r.data.codex[0].name).toBe('灵气涡轮增压器');
    expect(r.issues.some(i => i.rule === 'R19')).toBe(false);
    expect(r.events.some(e => e.align)).toBe(false);
  });
  it('无 authority：队列/势力名原样入库', () => {
    const base = Schema.parse({ bases: [{ id: 'alpha-id', name: '测试基地', buildings: [] }] });
    const r = parseMessageText(
      '<战况>\n队列:\n  - 项目: 未知项目X\n    类型: 生产\n    基地: alpha-id\n势力:\n  - 名称: 錢家\n    态度: 敌意\n</战况>',
      base,
      {},
    );
    expect(r.data.queues[0].item).toBe('未知项目X');
    expect(r.data.factions[0].name).toBe('錢家');
    expect(r.issues.some(i => i.rule === 'R19')).toBe(false);
  });
});

describe('C6 · T2 真名单对齐（科技会命名核查 2026-09-01）', () => {
  // 名单源：T2科技总设计文档.md（50 研究 + 16 建筑），此处取危险对相关子集。
  // 互查脚本：artifacts/extract-tech.mjs → tech-names-report.txt
  const authority: AuthorityInput = {
    names: [
      '自主战斗平台工学',
      '自主步兵平台工学', // 危险对①：距离 2
      '高超声速打击工学',
      '高超声速拦截工学', // 危险对②：距离 2
      '自动化战车工厂',
      '战车工厂', // 危险对③：包含关系（旧 catalog 名）
      '光棱塔', // 危险对④：与隐藏科技“光谱塔”距离 1
      '低可观测技术工学',
    ],
    aliases: {},
  };
  const ai = buildAlignIndex(authority);

  it('距离2 危险对：中间字变体落双候选 → 歧义护栏 miss（不误吸附）', () => {
    // “自主作战平台工学”距战斗版/步兵版均为 2 → near.size=2 → miss
    expect(alignName('自主作战平台工学', ai).hit).toBe('miss');
  });
  it('危险对本名精确/繁体命中不受干扰', () => {
    expect(alignName('自主战斗平台工学', ai)).toEqual({ name: '自主战斗平台工学', hit: 'exact' });
    expect(alignName('高超聲速打擊工學', ai)).toEqual({ name: '高超声速打击工学', hit: 'canon' });
  });
  it('包含对：扩展名被唯一包含吸附（已知边界，R19 有痕可撤）', () => {
    // “战车工厂二号”仅包含“战车工厂”（与“自动化战车工厂”互不包含）→ 唯一包含 fuzzy
    expect(alignName('战车工厂二号', ai)).toEqual({ name: '战车工厂', hit: 'fuzzy' });
    // 本名各自精确命中不串
    expect(alignName('自动化战车工厂', ai).hit).toBe('exact');
    expect(alignName('战车工厂', ai).hit).toBe('exact');
  });
  it('隐藏科技命名雷（光谱塔↔光棱塔距离1）：未预注册时会被错误吸附——钉住现状，待科技会改名或预注册解雷', () => {
    // 现状：光谱塔不在名单（隐藏未解锁）→ 编辑距离层唯一候选→误吸“光棱塔”。
    // 解雷途径：①隐藏科技浮现即刻注册 codex/世界书条目名（exact 拦截）；②科技会改名拉开距离。
    expect(alignName('光谱塔', ai)).toEqual({ name: '光棱塔', hit: 'fuzzy' });
    // 预注册后（名单含光谱塔）→ exact 命中自己，不再误吸
    const ai2 = buildAlignIndex({ names: [...authority.names, '光谱塔'], aliases: {} });
    expect(alignName('光谱塔', ai2)).toEqual({ name: '光谱塔', hit: 'exact' });
  });
});
