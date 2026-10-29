import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildEntityCredibilityIndex } from '../core/entityCredibility';
import { parseMessageText } from '../parse/parsePipeline';
import { extractPlanningIntent, normalizeActionKind } from '../planning/planningParser';
import { normalizeFlatProtocolBlocks } from '../worldbook/tavernRegexPipeline';
import { parseProductionSchedulePayload } from '../../中控悬浮窗/cards/floorCardExtraParsers';

describe('PKG-D · <排产计划> 科研扩充、<战况> 旁路收口与世界书 uid=18 规约修正', () => {
  describe('1. <排产计划> 科研立项解析与对齐入队', () => {
    it('normalizeActionKind 支持将 研究/科研/研发/科技/research 归一为 研究', () => {
      expect(normalizeActionKind('研究')).toBe('研究');
      expect(normalizeActionKind('科研')).toBe('研究');
      expect(normalizeActionKind('研发')).toBe('研究');
      expect(normalizeActionKind('科技')).toBe('研究');
      expect(normalizeActionKind('research')).toBe('研究');
      expect(normalizeActionKind('TECH')).toBe('研究');
      expect(normalizeActionKind('生产')).toBe('生产');
      expect(normalizeActionKind('建造')).toBe('建造');
    });

    it('extractPlanningIntent 支持 kind: 研究 且未写 count/数量 时自动缺省为 1', () => {
      const yaml = `
模式: 委托
基地: 前沿第一基地
动作:
  - 类别: 科研
    项目: 小型模块化核能工学
  - 操作: 研发
    名称: 低可观测技术工学
    数量: ""
`;
      const res = extractPlanningIntent(yaml);
      expect(res.quarantine).toHaveLength(0);
      expect(res.intent).not.toBeNull();
      expect(res.intent!.actions).toHaveLength(2);
      expect(res.intent!.actions[0]).toMatchObject({
        op: 'enqueue',
        kind: '研究',
        catalog_ref: '小型模块化核能工学',
        quantity: 1,
      });
      expect(res.intent!.actions[1]).toMatchObject({
        op: 'enqueue',
        kind: '研究',
        catalog_ref: '低可观测技术工学',
        quantity: 1,
      });
    });

    it('parseMessageText 能将 <排产计划> 中的科技变体名（如 模块化小型核能技术）对齐为 小型模块化核能工学 并排入 data.queues', () => {
      const raw = `
<排产计划>
模式: 委托
动作:
  - 类别: 研究
    项目: 模块化小型核能技术
    基地: 北坡主基地
</排产计划>
`;
      const credibilityIndex = buildEntityCredibilityIndex({
        names: ['小型模块化核能工学', '低可观测技术工学', '基础步兵训练学'],
      });
      const r = parseMessageText(
        raw,
        {
          bases: [{ id: '北坡主基地', name: '北坡主基地', status: '警戒', buildings: [] }],
        },
        {
          authority: {
            names: ['小型模块化核能工学', '低可观测技术工学', '北坡主基地'],
            aliases: {},
            credibilityIndex,
          },
        },
      );

      expect(r.quarantine).toHaveLength(0);
      expect(r.planningDecls).toHaveLength(1);
      expect(r.planningDecls[0].actions[0]).toMatchObject({
        op: 'enqueue',
        kind: '研究',
        catalog_ref: '小型模块化核能工学',
        quantity: 1,
      });
      expect(r.data.queues).toHaveLength(1);
      expect(r.data.queues[0]).toMatchObject({
        type: '研究',
        item: '小型模块化核能工学',
        base: '北坡主基地',
        status: 'queued',
        qty: 1,
      });
      expect(
        r.events.some(
          e => e.light === '🟡' && e.align?.from === '模块化小型核能技术' && e.align?.to === '小型模块化核能工学',
        ),
      ).toBe(true);
    });

    it('已在 data.tech.done 中的科技在 <排产计划> 中重复立项时自动防重跳过并留痕', () => {
      const raw = `
<排产计划>
动作:
  - 类别: 研究
    项目: 模块化小型核能技术
</排产计划>
`;
      const r = parseMessageText(raw, {
        tech: { done: ['小型模块化核能工学'], unlocked: [] },
      });

      expect(r.data.queues).toHaveLength(0);
      expect(
        r.events.some(e => e.light === '🟡' && e.message.includes('已在已研科技列表中')),
      ).toBe(true);
    });
  });

  describe('2. 同楼 <排产计划> 研究与 <战况> 队列重复时的防重行为', () => {
    it('同楼 <战况> 队列已申报同一科研项目（含变体名）时，<排产计划> 自动标记冲突且不重复入队', () => {
      const raw = `
<战况>
日期: 秋·九月二十
队列:
  - 项目: 小型模块化核能工学
    类型: 研究
    基地: 北坡主基地
    进度: 20
</战况>

<排产计划>
模式: 委托
动作:
  - 类别: 科研
    项目: 模块化小型核能技术
</排产计划>
`;
      const r = parseMessageText(raw, {
        bases: [{ id: '北坡主基地', name: '北坡主基地', status: '警戒', buildings: [] }],
      });
      expect(r.planningDecls).toHaveLength(1);
      expect(r.planningDecls[0].conflict_with_legacy_queue).toBe(true);
      // 队列中仅保留 1 条「小型模块化核能工学」，绝不分裂出第 2 条重复项
      expect(r.data.queues).toHaveLength(1);
      expect(r.data.queues[0].item).toBe('小型模块化核能工学');
      expect(
        r.events.some(e => e.light === '🟡' && e.message.includes('已在队列中，跳过重复入队')),
      ).toBe(true);
    });
  });

  describe('3. <战况> 资金旁路收口与存量向后兼容', () => {
    it('默认向后兼容模式下保留 <战况> 资金入账，并在非首楼留下旁路提示事件', () => {
      const raw = '<战况>\n资金: 5000\n</战况>';
      const r = parseMessageText(raw, { economy: { credits: 1000, credits_daily: 0, chains: [], wallet: {} } });
      expect(r.data.economy.credits).toBe(5000);
      expect(
        r.events.some(e => e.path === 'economy.credits' && e.message.includes('遗产资金旁路兼容入账')),
      ).toBe(true);
    });

    it('开启 disallowLegacyWarStatCredits 时拦截非首楼 <战况> 资金/经费旁路写入，首楼照常放行', () => {
      const raw = '<战况>\n资金: 8888\n经费变化: +500\n</战况>';
      const nonFirst = parseMessageText(
        raw,
        { economy: { credits: 1200, credits_daily: 0, chains: [], wallet: {} } },
        { isFirstFloor: false, disallowLegacyWarStatCredits: true },
      );
      expect(nonFirst.data.economy.credits).toBe(1200);
      expect(nonFirst.quarantine).toHaveLength(0);
      expect(
        nonFirst.events.some(e => e.light === '🟡' && e.path === 'economy.credits' && e.message.includes('已收口拦截')),
      ).toBe(true);

      const firstFloor = parseMessageText(
        '<战况>\n资金: 8888\n</战况>',
        { economy: { credits: 1200, credits_daily: 0, chains: [], wallet: {} } },
        { isFirstFloor: true, disallowLegacyWarStatCredits: true },
      );
      expect(firstFloor.data.economy.credits).toBe(8888);
    });
  });

  describe('4. 世界书 <战况> 标签彻底退役与无 <战况> 全链路战报解析', () => {
    it('全域战略指挥系统_世界书.json 已彻底退役 <战况> 标签，全面切换为 <态势> + <事件> + <排产计划> + <选项>', () => {
      const wbPath = path.resolve(
        __dirname,
        '../../../../worldbooks/全域战略指挥系统_世界书.json',
      );
      const rawJson = fs.readFileSync(wbPath, 'utf8');
      const parsed = JSON.parse(rawJson) as {
        entries: Record<string, { uid: number; comment: string; content: string }>;
      };
      const uid18 =
        parsed.entries['18'] ?? Object.values(parsed.entries).find(e => e.uid === 18);
      expect(uid18).toBeDefined();
      expect(uid18.comment).toContain('91·战报输出规约');

      // 1) 全书零残留 <战况>
      for (const entry of Object.values(parsed.entries)) {
        expect(entry.content).not.toContain('<战况>');
        expect(entry.content).not.toContain('</战况>');
      }

      // 2) 不再把系统标准科技「低可观测技术工学」作为 <图鉴> 示例
      expect(uid18.content).not.toContain('低可观测技术工学');
      expect(uid18.content).toContain('灰熊坦克战地附加反应装甲型');

      // 3) 包含禁重复建档醒目铁律
      expect(uid18.content).toMatch(/严禁.*(?:标准科技|已有)/);

      // 4) 包含 <态势>、<排产计划> 与 <选项> 规约
      expect(uid18.content).toContain('<态势>');
      expect(uid18.content).toContain('<选项>');
      expect(uid18.content).toContain('<排产计划>');
    });

    it('无 <战况> 的新一代战报（<态势> + <事件> + <排产计划> + <选项>）可完整驱动全套状态树更新', () => {
      const raw = `
<正文>
北坡风雪渐息，工程排完成了防空阵地检修。
</正文>

<摘要>
时间: 秋·九月廿一
纪要: 北坡主基地完成防空检修并启动隐身涂层科研。
关键词: [北坡主基地, 防空检修, 低可观测技术工学]
</摘要>

<timePast>0 D 6 H 0 M</timePast>

<态势>
日期: 秋·九月廿一
天气: 阴转多云
暴露度变化: -0.5
资源:
  矿产:
    原矿: 150
</态势>

<事件>
- 类型: 情报获取
  来源: 电子侦察哨
  可信度: 高
  内容: 发现东侧山谷敌军巡逻队撤离
</事件>

<排产计划>
模式: 委托
基地: 北坡主基地
动作:
  - 类别: 研究
    项目: 低可观测技术工学
</排产计划>

<选项>
- 文本: 派遣灰熊坦克小队前出占领东侧山谷哨卡
  标记: 推进控制
  代价: 燃油×15
- 文本: 集中算力加速低可观测技术攻关
  标记: 科研优先
  代价: 电力负荷+10
</选项>
`;
      const r = parseMessageText(raw, {
        meta: { date: '秋·九月二十', location: '北坡', weather: '暴风雪', day_count: 1, world_id: 'w1' },
        exposure: { value: 2.5, trend: '平稳', last_change: '' },
        bases: [{ id: '北坡主基地', name: '北坡主基地', status: '警戒', buildings: [] }],
      });

      expect(r.quarantine).toHaveLength(0);
      expect(r.data.meta.date).toBe('秋·九月廿一');
      expect(r.data.meta.weather).toBe('阴转多云');
      expect(r.data.exposure.value).toBeCloseTo(2.0);
      expect(r.data.economy.resources.minerals['原矿']).toBe(150);
      expect(r.data.intel).toHaveLength(1);
      expect(r.data.intel[0].content).toBe('发现东侧山谷敌军巡逻队撤离');
      expect(r.data.queues).toHaveLength(1);
      expect(r.data.queues[0]).toMatchObject({
        type: '研究',
        item: '低可观测技术工学',
        base: '北坡主基地',
        qty: 1,
      });
      expect(r.data.options).toEqual([
        {
          text: '派遣灰熊坦克小队前出占领东侧山谷哨卡',
          tag: '推进控制',
          cost: '燃油×15',
        },
        {
          text: '集中算力加速低可观测技术攻关',
          tag: '科研优先',
          cost: '电力负荷+10',
        },
      ]);
    });

    it('normalizeFlatProtocolBlocks 支持对 <态势> 与 <选项> 自动补齐空行隔离并提平嵌套子块', () => {
      const tight = '<态势>\n日期: 秋·九月廿一\n  <事件>\n  - 类型: 情报获取\n  </事件>\n</态势><选项>\n- 文本: 继续隐蔽\n</选项>';
      const normalized = normalizeFlatProtocolBlocks(tight);
      expect(normalized).toContain('</态势>\n\n<事件>');
      expect(normalized).toContain('</事件>\n\n<选项>');
    });

    it('实机第 6 楼回归：顶层 YAML 数组格式的 <排产计划>（含 状态: 建造中/候列中 且省略数量）可正确解析入队且楼层卡片精确识别为 2 批', () => {
      const floor6Raw = `
<摘要>
时间: 2042-03-14
纪要: 白凌汇报了基准电网与兵营投产后的待命工况，指挥官确认下达盟军碉堡建造与基础步兵训练学立项指令，相关工序进入排期。
关键词: [供电汇报, 兵营待命, 盟军碉堡, 步兵训练学]
</摘要>

<timePast>0 D 0 H 15 M</timePast>

<态势>
日期: 2042-03-14
地点: 前沿第一基地
天气: 阴
暴露度变化: 0.0
</态势>

<排产计划>
- 类别: 建造
  项目: 盟军碉堡
  基地: 前沿第一基地
  消耗: 500
  工期: 0 D 0 H 30 M
  状态: 建造中
- 类别: 研发
  项目: 基础步兵训练学
  基地: 前沿第一基地
  槽位: 主建筑槽
  消耗: 200
  工期: 2 D 0 H 0 M
  状态: 候列中
</排产计划>

<机娘>
名称: 白凌
代号: 白凌
编号: MCV-01
原名: 待授名
型号: 机动建设车（盟军）
序列: 1号原型机
阵营: 盟军
状态: 运转中
驻地: 前沿第一基地
好感: 50
服从: 100
</机娘>

<选项>
- 文本: 派遣战斗工兵对周边废弃货运铁路实施基础勘测与静默排查
  标记: 态势感知
  代价: 工兵离队巡逻
- 文本: 调整电网微调模块，压缩非关键照明以储备调峰裕度
  标记: 能源管控
  代价: 无额外消耗
</选项>
`;
      const r = parseMessageText(floor6Raw, {
        bases: [{ id: '前沿第一基地', name: '前沿第一基地', status: '警戒', buildings: [] }],
      });

      expect(r.quarantine).toHaveLength(0);
      expect(r.planningDecls).toHaveLength(1);
      expect(r.planningDecls[0].mode).toBe('delegate_once');
      expect(r.planningDecls[0].actions).toHaveLength(2);
      expect(r.data.queues).toHaveLength(2);
      expect(r.data.queues[0]).toMatchObject({
        type: '建造',
        item: '盟军碉堡',
        base: '前沿第一基地',
        qty: 1,
      });
      expect(r.data.queues[1]).toMatchObject({
        type: '研究',
        item: '基础步兵训练学',
        base: '前沿第一基地',
        qty: 1,
      });
      expect(r.data.options).toHaveLength(2);

      // 楼层卡片解析器不再拆成 13 批，而是精确识别为 2 批
      const cardParsed = parseProductionSchedulePayload(`
- 类别: 建造
  项目: 盟军碉堡
  基地: 前沿第一基地
  消耗: 500
  工期: 0 D 0 H 30 M
  状态: 建造中
- 类别: 研发
  项目: 基础步兵训练学
  基地: 前沿第一基地
  槽位: 主建筑槽
  消耗: 200
  工期: 2 D 0 H 0 M
  状态: 候列中
`);
      expect(cardParsed.items).toHaveLength(2);
      expect(cardParsed.items[0].unit).toBe('盟军碉堡');
      expect(cardParsed.items[1].unit).toBe('基础步兵训练学');
    });
  });
});
