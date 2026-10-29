import { klona } from 'klona';
import { beforeEach, describe, expect, it } from 'vitest';
import { Schema } from '../core/schema';
import {
  beginFloorTrace,
  clearDataFlowTraces,
  clearFlightLogs,
  dataFlowDebugState,
  finishFloorTrace,
  MAX_FLIGHT_LOGS,
  MAX_FLOOR_TRACES,
  recordFlightLog,
  recordTraceStage,
  type FloorStageId,
} from '../debug/dataFlowTracer';
import {
  buildReproBundleJson,
  runDryRunPipeline,
} from '../debug/reproBundleAndDryRun';
import {
  diffStatData,
  traceFieldMutations,
} from '../debug/stateDiffEngine';
import { GuardError, makeChatBookGateway } from '../worldbook/chatBookBinding';
import {
  commitPendingLoreToWorldbook,
  stagePendingLore,
} from '../worldbook/pendingLoreGate';

describe('41号任务包 · 全链路数据流转监控与七阶Diff排障系统 (DBG41-01 ~ DBG41-08)', () => {
  beforeEach(() => {
    clearDataFlowTraces();
    clearFlightLogs();
    delete (globalThis as Record<string, unknown>).getLastMessageId;
    delete (globalThis as Record<string, unknown>).getChatMessages;
  });

  it('1. RingBuffer 容量淘汰与零持久化污染 (dataFlowTracer.ts)', () => {
    for (let i = 1; i <= 8; i += 1) {
      const base = { economy: { credits: i * 100 } };
      const next = { economy: { credits: i * 100 + 50 } };
      const traceId = beginFloorTrace(
        {
          chatId: 'chat-ring-test',
          floorId: i,
          swipeId: 0,
          source: 'live',
        },
        base,
      );
      recordTraceStage(traceId, 'S0_BASELINE', {
        beforeSnap: base,
        afterSnap: base,
      });
      recordTraceStage(traceId, 'S1_PARSE', {
        beforeSnap: base,
        afterSnap: next,
      });
      finishFloorTrace(traceId, {
        outcome: 'ok',
        finalSnap: next,
      });
    }

    expect(dataFlowDebugState.traces.length).toBe(MAX_FLOOR_TRACES);
    expect(dataFlowDebugState.traces.map(t => t.meta.floorId)).toEqual([8, 7, 6, 5, 4]);

    for (let i = 1; i <= 120; i += 1) {
      recordFlightLog({
        category: 'host_event',
        status: 'ok',
        chatId: 'chat-ring-test',
        floorId: i,
        swipeId: 0,
        title: `事件 #${i}`,
        detail: `详情 ${i}`,
      });
    }

    expect(dataFlowDebugState.flightLogs.length).toBe(MAX_FLIGHT_LOGS);
    expect(dataFlowDebugState.flightLogs[0].floorId).toBe(120);
    expect(dataFlowDebugState.flightLogs[MAX_FLIGHT_LOGS - 1].floorId).toBe(21);
  });

  it('2. diffStatData 引用短路、子树脱离可变引用与 traceFieldMutations 子阶段穿透 (stateDiffEngine.ts)', () => {
    const sharedUnchangedBranch = {
      nested: { label: 'unchanged' },
    };
    const mutableAddedBranch = {
      id: 'b_new',
      name: '新前哨基地',
    };

    const before = {
      economy: {
        credits: 2000,
        resources: { nanites: 100 },
      },
      queues: [
        { item: '磁暴步兵', spent_minutes: 30, status: 'active' },
      ],
      unchanged: sharedUnchangedBranch,
      oldBranch: { deprecated: true },
    };

    const after = {
      economy: {
        credits: 2750,
        resources: { nanites: 80 },
      },
      queues: [
        { item: '磁暴步兵', spent_minutes: 90, status: 'active' },
      ],
      unchanged: sharedUnchangedBranch,
      newBranch: mutableAddedBranch,
    };

    const diffs = diffStatData(before, after);
    expect(diffs.some(d => d.path.startsWith('unchanged'))).toBe(false);

    const creditDiff = diffs.find(d => d.path === 'economy.credits');
    expect(creditDiff).toEqual({
      path: 'economy.credits',
      kind: 'modified',
      before: 2000,
      after: 2750,
      numericDelta: 750,
    });

    const queueDiff = diffs.find(d => d.path === 'queues[0].spent_minutes');
    expect(queueDiff).toEqual({
      path: 'queues[0].spent_minutes',
      kind: 'modified',
      before: 30,
      after: 90,
      numericDelta: 60,
    });

    const addedDiff = diffs.find(d => d.path === 'newBranch');
    expect(addedDiff?.kind).toBe('added');
    mutableAddedBranch.name = '外部篡改后名称';
    expect((addedDiff?.after as { name: string }).name).toBe('新前哨基地');

    const removedDiff = diffs.find(d => d.path === 'oldBranch');
    expect(removedDiff?.kind).toBe('removed');
    expect(removedDiff?.before).toEqual({ deprecated: true });
  });

  it('3. 免落盘干跑试算器、S2 九大子齿轮断面与 AI 排障复现包生成 (reproBundleAndDryRun.ts + settleFloor.ts)', () => {
    const baselineStatData = Schema.parse({
      meta: { date: '1972-05-01', location: '北极圈', day_count: 10, weather: '晴朗' },
      economy: {
        credits: 5000,
        credits_daily: 1200,
        chains: [
          {
            id: 'chain_arctic_1',
            name: '一号采矿场',
            flow: '收入',
            rate_daily: 1440,
            eff: 1,
            status: 'active',
          },
        ],
      },
      bases: [
        {
          id: 'base_1',
          name: '主基地',
          location: '北极圈',
          status: '警戒',
          power: { gen: 200, use: 60 },
          buildings: [
            { name: '苏联建造厂', state: '运转', layer: '地表层' },
            { name: '磁能反应炉', state: '运转', layer: '地表层' },
            { name: '工业工厂', state: '运转', layer: '地表层' },
          ],
        },
      ],
      queues: [
        {
          type: '生产',
          item: '犀牛坦克',
          base: '主基地',
          status: 'active',
          qty: 1,
          qty_done: 0,
          total_minutes: 240,
          spent_minutes: 60,
          progress: 25,
        },
      ],
      command: {
        adjutants: [
          {
            slot_id: 'staff_1',
            role: 'staff',
            identity: 'human',
            name: '瓦伦蒂娜',
            title: '后勤参谋',
            upkeep_daily: 288,
            status: 'active',
          },
        ],
      },
    });

    const frozenCopy = klona(baselineStatData);

    const rawText = [
      '<态势>',
      '<timePast>120</timePast>',
      '</态势>',
      '<事件>',
      '- 类型: 资金链建立',
      '  名称: 北极矿脉',
      '  流向: 收入',
      '  日速率: 1200',
      '  效率: 1',
      '</事件>',
    ].join('\n');

    const res = runDryRunPipeline({
      rawText,
      baselineStatData,
      floorId: 12,
      chatId: 'chat-dryrun-spec',
      swipeId: 0,
    });

    // 断言原 baselineStatData 100% 零副作用
    expect(baselineStatData).toEqual(frozenCopy);

    // 断言 S0..S6 七个主阶段齐全
    const expectedMainStages: FloorStageId[] = [
      'S0_BASELINE',
      'S1_PARSE',
      'S2_SETTLE',
      'S3_RECONCILE',
      'S4_BRIDGES',
      'S5_GUARD_RECHECK',
      'S6_COMMIT_FEED',
    ];
    expect(res.trace.stages.map(s => s.stageId)).toEqual(expectedMainStages);

    // 断言 S2_SETTLE 包含 S2a..S2i 九个子齿轮断面
    const s2Stage = res.trace.stages.find(s => s.stageId === 'S2_SETTLE');
    expect(s2Stage?.substages).toBeDefined();
    const substageIds = (s2Stage?.substages ?? []).map(sub => sub.stageId);
    const expectedSubstageIds: FloorStageId[] = [
      'S2a_COMMAND',
      'S2b_PROTOCOLS',
      'S2c_TWO_STAGE',
      'S2d_BUILD_COMM',
      'S2e_DEPLOY_MODE',
      'S2f_CHAINS_GRID',
      'S2g_SPACE',
      'S2h_DARKNET_ECON',
      'S2i_NANITE_STOCK',
    ];
    expect(substageIds.length).toBe(9);
    for (const id of expectedSubstageIds) {
      expect(substageIds).toContain(id);
    }

    // 断言 traceFieldMutations(trace, 'credits') 穿透 S2_SETTLE.substages 命中具体子齿轮
    const creditHits = traceFieldMutations(res.trace, 'credits');
    expect(creditHits.length).toBeGreaterThan(0);
    const hitStageIds = creditHits.map(h => h.stageId);
    expect(
      hitStageIds.some(
        id => id === 'S2f_CHAINS_GRID' || id === 'S2h_DARKNET_ECON' || id === 'S2a_COMMAND',
      ),
    ).toBe(true);

    // 断言 buildReproBundleJson 产出合法复现包 JSON
    recordFlightLog({
      category: 'wb_gateway',
      status: 'ok',
      chatId: 'chat-dryrun-spec',
      floorId: 12,
      swipeId: 0,
      title: '世界书守卫放行',
      detail: 'book=红警档案·测试',
    });
    const bundleJson = buildReproBundleJson(res.trace, dataFlowDebugState.flightLogs);
    const parsedBundle = JSON.parse(bundleJson) as {
      schema: string;
      exportedAt: string;
      trace: { traceId: string };
      relatedFlightLogs: Array<{ chatId: string | null }>;
    };
    expect(parsedBundle.schema).toBe('tavernweave.ra.repro_bundle.v1');
    expect(parsedBundle.trace.traceId).toBe(res.trace.traceId);
    expect(parsedBundle.relatedFlightLogs.length).toBe(1);
    expect(parsedBundle.relatedFlightLogs[0].chatId).toBe('chat-dryrun-spec');
  });

  it('4. 异步世界书守卫与暂存门飞行日志捕获 (chatBookBinding.ts + pendingLoreGate.ts)', async () => {
    // (a) pendingLoreGate 缺失条目预检拦截 -> warn
    const staged = stagePendingLore(
      [],
      [{ name: '铁幕先锋团', kind: '势力', summary: '北极装甲集群' }],
      { floor: 5, swipe: 1, day: 3 },
    );

    const missingRes = await commitPendingLoreToWorldbook(staged.pendingLore, {
      ids: ['lore_不存在的条目'],
      write: async () => {},
    });
    expect(missingRes.ok).toBe(false);
    expect(
      dataFlowDebugState.flightLogs.some(
        log => log.category === 'auto_filer' && log.status === 'warn' && log.title.includes('预检拦截'),
      ),
    ).toBe(true);

    // (b) pendingLoreGate 写入期间 Swipe 漂移 -> blocked
    let currentSwipe = 1;
    (globalThis as Record<string, unknown>).getLastMessageId = () => 5;
    (globalThis as Record<string, unknown>).getChatMessages = () => [{ swipe_id: currentSwipe }];

    const driftRes = await commitPendingLoreToWorldbook(staged.pendingLore, {
      ids: 'all',
      write: async () => {
        currentSwipe = 2;
      },
    });
    expect(driftRes.ok).toBe(false);
    expect(
      dataFlowDebugState.flightLogs.some(
        log =>
          log.category === 'auto_filer' &&
          log.status === 'blocked' &&
          log.title.includes('楼层/Swipe漂移'),
      ),
    ).toBe(true);

    // (c) chatBookBinding 聊天切换 GuardError -> wb_gateway blocked
    let activeChatId = 'chat-alpha';
    const gw = makeChatBookGateway({
      readChatId: () => activeChatId,
      readBoundBook: () => '红警档案·Alpha',
      readBookNames: () => ['红警档案·Alpha'],
      createChatBook: async name => name,
      charName: () => '测试角色',
      now: () => new Date('2026-10-23T12:00:00Z'),
      warn: () => {},
    });

    const txn = gw.begin();
    activeChatId = 'chat-beta';
    await expect(gw.guardedBook(txn, { createIfMissing: false })).rejects.toBeInstanceOf(GuardError);
    expect(
      dataFlowDebugState.flightLogs.some(
        log =>
          log.category === 'wb_gateway' &&
          log.status === 'blocked' &&
          log.title.includes('chat-id-drift'),
      ),
    ).toBe(true);
  });
});
