import _ from 'lodash';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tavernFloorReader } from '../composables/useFloatingStore';
import { hydrateZeroFloorFromBoot, readFloorLive, runParseFor } from '../composables/useParse';
import { parseMessageText } from '../parse/parsePipeline';

describe('开局设置的资金与科技进入中控台数据层防洗白与自愈回归测试', () => {
  const g = globalThis as Record<string, unknown>;
  let msgVars: Record<number, Record<string, unknown>>;
  let chatVars: Record<string, unknown>;
  let messages: Record<
    number,
    { message_id: number; role: string; is_hidden: boolean; message: string; swipe_id?: number; data?: Record<string, unknown> }
  >;

  beforeEach(() => {
    g._ = _;
    msgVars = {};
    chatVars = {};
    messages = {};

    g.getChatMessages = vi.fn((id: number | string) => {
      const numId = Number(id);
      return messages[numId] ? [messages[numId]] : [];
    });

    g.getVariables = vi.fn((opts: { type: string; message_id?: number }) => {
      if (opts.type === 'chat') return chatVars;
      if (opts.type === 'message' && typeof opts.message_id === 'number') {
        return msgVars[opts.message_id] ?? {};
      }
      return {};
    });

    g.updateVariablesWith = vi.fn(
      async (
        updater: (v: Record<string, unknown>) => Record<string, unknown>,
        opts: { type: string; message_id?: number },
      ) => {
        if (opts.type === 'chat') {
          chatVars = updater(chatVars);
          return chatVars;
        }
        if (opts.type === 'message' && typeof opts.message_id === 'number') {
          const cur = msgVars[opts.message_id] ?? {};
          msgVars[opts.message_id] = updater(cur);
          return msgVars[opts.message_id];
        }
        return {};
      },
    );
  });

  afterEach(() => {
    delete g.getChatMessages;
    delete g.getVariables;
    delete g.updateVariablesWith;
  });

  it('runParseFor(0) 面对无战报标签的 #0 楼启动器 HTML 时，绝不拿 scanBaseline(-1) 全 0 树洗白开局资金与科技', async () => {
    messages[0] = {
      message_id: 0,
      role: 'assistant',
      is_hidden: false,
      message: '<div id="app">开场启动器宿主</div>',
      swipe_id: 0,
    };
    msgVars[0] = {
      stat_data: {
        schema_version: 2,
        meta: { date: '2042-05-01', location: '恶土深处', weather: '晴', day_count: 1, world_id: 'cyber2077' },
        economy: { credits: 5000, credits_daily: 0 },
        tech: { done: ['化石燃料发电学', '基础步兵训练学'] },
        bases: [],
        queues: [],
        forces: {
          infantry: 0,
          vehicles: ['MCV（盟军）'],
          aircraft: [],
          navy: [],
          girls: [{ name: '白凌', type: 'MCV核心机娘', origin: '红警系统制造', status: '待命' }],
          equipment: {},
        },
      },
    };
    chatVars['$boot'] = {
      confirmed: true,
      at: '2026-10-22T00:00:00.000Z',
      preset: 'custom',
      choices: {
        worldId: 'cyber2077',
        effective: {
          credits: 5000,
          techDone: ['化石燃料发电学', '基础步兵训练学'],
          exposure: 0,
        },
      },
    };

    const outcome = await runParseFor(0);
    expect(outcome).toBe('parsed');

    const afterZeroStat = msgVars[0]?.stat_data as {
      economy: { credits: number };
      tech: { done: string[] };
      forces: { vehicles: string[]; girls: { name: string }[] };
    };
    expect(afterZeroStat.economy.credits).toBe(5000);
    expect(afterZeroStat.tech.done).toEqual(['化石燃料发电学', '基础步兵训练学']);
    expect(afterZeroStat.forces.vehicles).toContain('MCV（盟军）');
    expect(afterZeroStat.forces.girls.map(gItem => gItem.name)).toContain('白凌');
  });

  it('当 #0 楼曾被旧版归零洗白时，hydrateZeroFloorFromBoot、tavernFloorReader 与 #2 楼基线扫描可从 $boot 自愈还原开局资金与科技', async () => {
    messages[0] = {
      message_id: 0,
      role: 'assistant',
      is_hidden: false,
      message: '<div id="app">开场启动器宿主</div>',
      swipe_id: 0,
    };
    // 模拟已被旧版 runParseFor(0) 归零洗白过的 #0 楼 stat_data
    msgVars[0] = {
      stat_data: {
        schema_version: 2,
        meta: { date: '', location: '', weather: '晴', day_count: 0, world_id: '' },
        economy: { credits: 0, credits_daily: 0 },
        tech: { done: [] },
        bases: [],
        queues: [],
      },
    };
    chatVars['$boot'] = {
      confirmed: true,
      at: '2026-10-22T00:00:00.000Z',
      preset: 'easy',
      choices: {
        worldId: 'cyber2077',
        effective: {
          credits: 3000,
          techDone: ['化石燃料发电学', '装甲载具工学'],
          exposure: 0,
        },
      },
    };

    // 1. 纯函数自愈验证
    const hydrated = hydrateZeroFloorFromBoot(msgVars[0].stat_data, chatVars);
    expect(hydrated.has_stat_data).toBe(true);
    const hydratedStat = hydrated.stat_data as {
      economy: { credits: number };
      tech: { done: string[] };
      meta: { world_id: string };
    };
    expect(hydratedStat.economy.credits).toBe(3000);
    expect(hydratedStat.tech.done).toEqual(['化石燃料发电学', '装甲载具工学']);
    expect(hydratedStat.meta.world_id).toBe('cyber2077');

    // 2. 中控悬浮窗 tavernFloorReader.readFloor(0) 读取验证
    const candidate0 = tavernFloorReader.readFloor(0);
    const candidateStat = candidate0?.stat_data as {
      economy: { credits: number };
      tech: { done: string[] };
    };
    expect(candidateStat.economy.credits).toBe(3000);
    expect(candidateStat.tech.done).toEqual(['化石燃料发电学', '装甲载具工学']);

    // 3. #2 楼（首轮 AI 战报）向上扫描 #0 楼基线并解析后，开局资金与科技完整继承至 #2 楼
    messages[1] = {
      message_id: 1,
      role: 'user',
      is_hidden: false,
      message: '【战地初抵序幕】……',
    };
    messages[2] = {
      message_id: 2,
      role: 'assistant',
      is_hidden: false,
      message: '夜之城恶土风沙呼啸。\n<态势>\n日期: 2042-05-01\n地点: 恶土深处\n天气: 沙尘\n</态势>',
      swipe_id: 0,
    };

    const liveFloor0 = readFloorLive(
      g.getChatMessages as (id: number | string) => never[],
      g.getVariables as (o: { type: string; message_id?: number }) => Record<string, unknown>,
    )(0);
    expect((liveFloor0?.stat_data as { economy: { credits: number } }).economy.credits).toBe(3000);

    const outcome2 = await runParseFor(2);
    expect(outcome2).toBe('parsed');
    const floor2Stat = msgVars[2]?.stat_data as {
      economy: { credits: number };
      tech: { done: string[] };
    };
    expect(floor2Stat.economy.credits).toBe(3000);
    expect(floor2Stat.tech.done).toEqual(['化石燃料发电学', '装甲载具工学']);
  });

  it('未展开初态下 AI 在 <态势> 中误报「资金: 0」时，自动拦截并保留开局非零初始资金', () => {
    const baseline = {
      schema_version: 2,
      meta: { date: '2042-05-01', location: '恶土深处', weather: '晴', day_count: 1, world_id: 'cyber2077' },
      economy: { credits: 2000, credits_daily: 0 },
      tech: { done: ['化石燃料发电学'] },
      bases: [],
      queues: [],
    };

    const raw = `
还在原世界筹备中，尚未展开基地。
<态势>
日期: 2042-05-01
资金: 0
</态势>
`;
    const res = parseMessageText(raw, baseline, { isFirstFloor: false, floorId: 2 });
    expect(res.data.economy.credits).toBe(2000);
    expect(res.data.tech.done).toEqual(['化石燃料发电学']);
  });
});
