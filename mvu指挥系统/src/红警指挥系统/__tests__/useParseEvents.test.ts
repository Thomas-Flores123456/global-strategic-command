/**
 * EVT-PIPE-01 · useParse 生产链路端到端闭环 —— 专项单测
 * 真源：《事件系统与资金链状态机总设计案》§6.2/§3.3（CTRL-EVENT-01）/《MVP 任务包》§3.3
 * 验证：runParseFor 真实调用流中 parseResult.eventDeclarations 直通 settleFloor 第四结算齿轮——
 * 1. 建立声明即时入池：本楼 Δt=1D，基线在册链 300/日＋新声明链 600/日 → credits 精确 +900、
 *    nextChains（含 extracted 快照）随本楼 stat_data 落盘、时钟推进；
 * 2. 断裂声明当期停息（事件先于时钟）；
 * 3. 同楼势力/情报/任务声明经解析层标准化入账（EVT-PARSE-02）与第四齿轮互不污染；
 * 4. 楼层重解析（force 通道）幂等：不重复建链、不重复计息；
 * 5. 零注入零回归：无 <事件> 楼层第四齿轮整体跳过，逐字节零行为变化。
 */
import { describe, expect, it, vi } from 'vitest';
import { IncomeChain, Schema } from '../core/schema';
import type { StatData } from '../parse/parsePipeline';

/* ═══════════════ 夹具 ═══════════════ */

const DAY = '<timePast>1 D 0 H 0 M</timePast>';

const CHAIN_NAME = '灵石走私走廊';

/** 1 楼报文：叙述＋时间推进＋战况日期＋四类事件声明（链建立/势力/情报/任务） */
const EVENTS_RAW = [
  '夜色下货运走廊完成铺设，与修真家族的协议正式生效。',
  DAY,
  '<战况>',
  '日期: 2042-03-15',
  '</战况>',
  '<事件>',
  `- 类型: 资金链建立\n  对象: ${CHAIN_NAME}\n  流向: 收入\n  额度: 600\n  理由: 与当地修真家族达成私下供货协议`,
  '- 类型: 势力发现\n  名称: 极光生物科技\n  态度: 警觉\n  风险: 中\n  情报: 驻扎于第三工业区的外资安保集团',
  '- 类型: 情报获取\n  来源: 无线电监听\n  可信度: 高\n  内容: 敌方巡林队三日后换防',
  '- 类型: 任务接取\n  名称: 猎取高纯微晶样本\n  进度: 0/3',
  '</事件>',
].join('\n');

const BREAK_RAW = [
  '巡逻队全面封锁废料处理中心，运输通道切断。',
  DAY,
  '<战况>',
  '日期: 2042-03-15',
  '</战况>',
  '<事件>\n- 类型: 资金链断裂\n  对象: 旧城废料回收线\n  原因: 治安巡逻队全面封锁\n</事件>',
].join('\n');

/** 0 楼基线：credits 1000＋一条在册 300/日 活跃链（day_count=3 → 本楼结算后 day 4） */
function mkBaseline(withChain = true): StatData {
  return Schema.parse({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 3, location: '锈蚀低壑' },
    economy: {
      credits: 1000,
      ...(withChain
        ? {
            chains: [
              IncomeChain.parse({
                id: 'chain_旧城废料回收线',
                name: '旧城废料回收线',
                rate_daily: 300,
                status: 'active',
              }),
            ],
          }
        : {}),
    },
  });
}

type Globals = Record<string, unknown>;

/** 装全局酒馆 mock：0 楼为基线楼（含 stat_data），1 楼为待解析楼（原文 raw） */
function setup(raw: string, baseline: StatData = mkBaseline()) {
  const g = globalThis as Globals;
  const saved = { gcm: g.getChatMessages, gv: g.getVariables, uvw: g.updateVariablesWith, st: g.SillyTavern };
  const uvwMock = vi.fn(async (updater: (v: Record<string, unknown>) => Record<string, unknown>) => updater({}));
  g.getChatMessages = (id: number) =>
    id === 1
      ? [{ role: 'assistant', is_hidden: false, message: raw, swipe_id: 0 }]
      : [{ role: 'assistant', is_hidden: false, message: '<战况>\n日期: 2042-03-14\n</战况>', swipe_id: 0 }];
  g.getVariables = (o: { type: string; message_id?: number }) =>
    o.type === 'message' && o.message_id === 0 ? { stat_data: baseline } : {};
  g.updateVariablesWith = uvwMock;
  delete g.SillyTavern;
  return {
    /** 全部 uvw 落笔中携带 stat_data 的写入（本楼快照落盘；$parse 留痕写入不带该键） */
    async statWrites(): Promise<Record<string, unknown>[]> {
      const all = (await Promise.all(uvwMock.mock.results.map(r => r.value))) as Record<string, unknown>[];
      return all.filter(v => v && typeof v === 'object' && 'stat_data' in v);
    },
    restore() {
      g.getChatMessages = saved.gcm;
      g.getVariables = saved.gv;
      g.updateVariablesWith = saved.uvw;
      g.SillyTavern = saved.st;
    },
  };
}

const eco = (s: Record<string, unknown>) => s.stat_data as unknown as StatData;

/* ═══════════════ 端到端闭环 ═══════════════ */

describe('EVT-PIPE-01 · runParseFor → settleFloor 第四齿轮端到端', () => {
  it('建立声明即时入池：基线链 300/日＋新链 600/日，Δt=1D → credits +900、chains 快照与时钟随本楼落盘', async () => {
    const s = setup(EVENTS_RAW);
    try {
      const { runParseFor, parseState } = await import('../composables/useParse');
      expect(await runParseFor(1)).toBe('parsed');
      const writes = await s.statWrites();
      expect(writes).toHaveLength(1); // 本楼快照落盘一次
      const data = eco(writes[0]);
      // 第四齿轮：1000 ＋ 基线链 300 ＋ 新链当期入池 600 ＝ 1900（整数无漂移）
      expect(data.economy.credits).toBe(1900);
      expect(Number.isInteger(data.economy.credits)).toBe(true);
      // nextChains 回写 economy.chains：在册链推进 extracted、新链 active 参与本期积分
      const chains = data.economy.chains;
      expect(chains).toHaveLength(2);
      const existing = chains.find(c => c.id === 'chain_旧城废料回收线');
      expect(existing).toMatchObject({ rate_daily: 300, status: 'active' });
      expect(existing?.capacity.extracted).toBe(300);
      const established = chains.find(c => c.id === `chain_${CHAIN_NAME}`);
      expect(established).toMatchObject({ name: CHAIN_NAME, rate_daily: 600, status: 'active' });
      expect(established?.capacity.extracted).toBe(600);
      // 时钟推进：day_count 3 → 4
      expect(data.clock?.day).toBe(4);
      // 留痕事件：建立＋时钟结算进入本楼报告流水
      expect(parseState.reports[0].events.some(e => e.message.includes(`[资金链] 建立「${CHAIN_NAME}」`))).toBe(true);
      expect(
        parseState.reports[0].events.some(e => e.message.includes('[资金链] 时钟结算') && e.message.includes('+900')),
      ).toBe(true);
    } finally {
      s.restore();
    }
  });

  it('断裂声明当期停息：事件先于时钟，本楼 Δt 不再对该链计息', async () => {
    const s = setup(BREAK_RAW);
    try {
      const { runParseFor } = await import('../composables/useParse');
      expect(await runParseFor(1)).toBe('parsed');
      const [write] = await s.statWrites();
      const data = eco(write);
      expect(data.economy.credits).toBe(1000); // 断裂当期零计息
      expect(data.economy.chains[0]).toMatchObject({ status: 'broken', eff: 0 });
    } finally {
      s.restore();
    }
  });

  it('同楼认知入账与经济结算分道：势力/情报/任务进标准账本（EVT-PARSE-02），互不污染', async () => {
    const s = setup(EVENTS_RAW);
    try {
      const { runParseFor } = await import('../composables/useParse');
      expect(await runParseFor(1)).toBe('parsed');
      const [write] = await s.statWrites();
      const data = eco(write);
      expect(data.factions).toEqual([
        { name: '极光生物科技', attitude: '警觉', risk: '中', intel: '驻扎于第三工业区的外资安保集团' },
      ]);
      expect(data.intel).toHaveLength(1);
      expect(data.intel[0]).toMatchObject({ src: '无线电监听', cred: '高', content: '敌方巡林队三日后换防' });
      expect(data.quests.active).toEqual([{ name: '猎取高纯微晶样本', progress: '0/3', note: '', detail: '' }]);
      expect(data.pending_lore).toHaveLength(1); // Q4 暂存门
      expect(data.economy.credits).toBe(1900); // 认知入账不影响经济结算
    } finally {
      s.restore();
    }
  });

  it('重解析幂等（MESSAGE_EDITED force 通道）：同楼重跑不重复建链、不重复计息', async () => {
    const s = setup(EVENTS_RAW);
    try {
      const { runParseFor } = await import('../composables/useParse');
      expect(await runParseFor(1)).toBe('parsed');
      expect(await runParseFor(1, { force: true })).toBe('parsed');
      const writes = await s.statWrites();
      expect(writes).toHaveLength(2);
      const a = eco(writes[0]);
      const b = eco(writes[1]);
      expect(b.economy.credits).toBe(a.economy.credits); // 基线不变 → 重算同果，零重复计息
      expect(b.economy.credits).toBe(1900);
      expect(b.economy.chains).toHaveLength(a.economy.chains.length);
      expect(b.economy.chains.find(c => c.id === `chain_${CHAIN_NAME}`)?.capacity.extracted).toBe(600);
      expect(b.economy.chains.find(c => c.id === 'chain_旧城废料回收线')?.capacity.extracted).toBe(300);
    } finally {
      s.restore();
    }
  });

  it('零注入零回归：无 <事件> 楼层（且基线无链）第四齿轮整体跳过，credits/chains 零变化', async () => {
    const s = setup('<战况>\n日期: 2042-03-15\n</战况>', mkBaseline(false));
    try {
      const { runParseFor, parseState } = await import('../composables/useParse');
      expect(await runParseFor(1)).toBe('parsed');
      const [write] = await s.statWrites();
      const data = eco(write);
      expect(data.economy.credits).toBe(1000); // 无链无声明 → 无日息
      expect(data.economy.chains).toEqual([]);
      expect(parseState.reports[0].events.some(e => e.message.includes('[资金链]'))).toBe(false);
      expect(data.factions).toEqual([]);
      expect(data.pending_lore).toEqual([]);
    } finally {
      s.restore();
    }
  });
});
