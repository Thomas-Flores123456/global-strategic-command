/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';

import type { EffectiveCatalog } from '../../红警指挥系统/core/catalogEffective';
import { PROTOCOL_LANE_KEY, ProtocolLaneProvider } from '../../红警指挥系统/engines/laneProviders';
import type { Schema } from '../../红警指挥系统/core/schema';
import {
  buildSchedulePanelModel,
  computeNextMilestoneBanner,
  schedulePanelModel,
  type SchedulePanelInput,
} from '../models/schedulePanelModel';

const MOCK_CATALOG = vi.hoisted(() => ({
  researches: [{ name: '履带工学', line: '陆地载具' }],
  buildings: [
    { name: '苏联战车工厂', category: '军事生产' },
    { name: '苏联作战实验室', category: '科研与T级建筑' },
  ],
  productions: [
    { name: '犀牛坦克', category: '地面武装', prodLane: 'lane.land' },
    { name: '天启坦克', category: '地面武装', prodLane: 'lane.land' },
    { name: '基洛夫空艇', category: '航空武装', prodLane: 'lane.air' },
  ],
  retrofits: [],
  projects: [],
  factionDefs: [],
  protocols: [
    {
      id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
      name: '战斗工兵与预制碉堡协议',
      faction: '苏联',
      tier: 1,
      track: '苏联·工程防御轨',
    },
    {
      id: 'sov.protocol.ra3.crusher_crane_salvage',
      name: '碾压起重机与战场回收协议',
      faction: '苏联',
      tier: 2,
      track: '苏联·重工回收轨',
    },
  ],
}));

vi.mock('../../红警指挥系统/composables/useCatalog', () => ({
  useCatalogStore: () => ({ effectiveCatalog: MOCK_CATALOG }),
}));

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span') } };
});

const TEST_CATALOG = MOCK_CATALOG as unknown as EffectiveCatalog;

let componentPromise: Promise<Component> | undefined;

function loadComponent(): Promise<Component> {
  componentPromise ??= import('../modals/ModalSchedule.vue').then(m => m.default as Component);
  return componentPromise;
}

async function loadModalScheduleSetup(snapshot: Schema | null): Promise<Record<string, any>> {
  const Comp = (await loadComponent()) as any;
  let captured: Record<string, any> = {};
  const origSetup = Comp.setup;
  Comp.setup = (props: unknown, ctx: any) => {
    const res = origSetup(props, {
      ...ctx,
      expose: (exposed: Record<string, any>) => {
        captured = exposed;
        ctx.expose?.(exposed);
      },
    });
    if (res && typeof res === 'object') captured = res;
    return res;
  };
  try {
    await renderToString(createSSRApp({ render: () => h(Comp, { open: true, snapshot }) }));
  } finally {
    Comp.setup = origSetup;
  }
  return captured;
}

async function renderModalScheduleSSR(snapshot: Schema | null): Promise<string> {
  const Comp = await loadComponent();
  return renderToString(createSSRApp({ render: () => h(Comp, { open: true, snapshot }) }));
}

describe('UX-SCHED-01 · computeNextMilestoneBanner 下一已知里程碑提示纯函数', () => {
  it('场景 1（有 settling 任务）：优先返回「待确认完工」且 remainingMinutes=0', () => {
    const banner = computeNextMilestoneBanner({
      bases: [{ id: 'base_1', name: '第一方面军主基地' }],
      queues: [
        {
          type: '生产',
          item: '犀牛坦克',
          base: 'base_1',
          status: 'active',
          spent_minutes: 200,
          total_minutes: 300,
        },
        {
          type: '生产',
          item: '灰熊坦克',
          base: 'base_1',
          status: 'settling',
          spent_minutes: 300,
          total_minutes: 300,
        },
      ],
    });

    expect(banner).toEqual({
      hasMilestone: true,
      label: '待确认完工',
      itemName: '灰熊坦克',
      baseName: '第一方面军主基地',
      remainingMinutes: 0,
      summary: '「灰熊坦克」已达到预计工时，等待结算确认',
    });
  });

  it('场景 2（有 active 任务）：取剩余分钟数最小的可预测 active 项（兼容 duration_minutes 与 total_minutes）', () => {
    const banner = computeNextMilestoneBanner({
      bases: [{ id: 'base_1', name: '前线基地A' }],
      queues: [
        {
          type: '生产',
          item: '天启坦克',
          base: 'base_1',
          status: 'active',
          spent_minutes: 100,
          total_minutes: 400, // 剩余 300 分钟
        },
        {
          type: '生产',
          item: '犀牛坦克',
          base: 'base_1',
          status: 'active',
          spent_minutes: 180,
          duration_minutes: 240, // 剩余 60 分钟（最小）
        },
        {
          type: '生产',
          item: '防空履带车',
          base: 'base_1',
          status: 'queued',
          spent_minutes: 0,
          total_minutes: 30,
        },
      ],
    });

    expect(banner.hasMilestone).toBe(true);
    expect(banner.label).toBe('最近完工项');
    expect(banner.itemName).toBe('犀牛坦克');
    expect(banner.baseName).toBe('前线基地A');
    expect(banner.remainingMinutes).toBe(60);
    expect(banner.summary).toContain('距离「犀牛坦克」完工预计还需');
  });

  it('场景 3（无活跃可预测任务）：空队列或仅有 queued/done 时返回「暂无在建任务」', () => {
    const emptyBanner = computeNextMilestoneBanner({
      bases: [{ id: 'base_1', name: '基地A' }],
      queues: [
        {
          type: '生产',
          item: '天启坦克',
          base: 'base_1',
          status: 'queued',
          spent_minutes: 0,
          total_minutes: 500,
        },
      ],
    });

    expect(emptyBanner).toEqual({
      hasMilestone: false,
      label: '暂无在建任务',
      itemName: null,
      baseName: null,
      remainingMinutes: null,
      summary: '当前没有正在计时的建造、生产或科研任务',
    });
  });
});

describe('UTO-LANE-01 & UX-SCHED-01 · ProtocolLaneProvider、schedulePanelModel 与 ModalSchedule SSR', () => {
  it('ProtocolLaneProvider.projectProtocols 准确投影 experimenting 与 auto_queued: true 协议项并按 queue_order 排序', () => {
    const provider = new ProtocolLaneProvider();
    const projected = provider.projectProtocols(
      [
        {
          ref: 'sov.protocol.ra3.crusher_crane_salvage',
          status: 'available',
          attempts: 0,
          exp: 0,
          auto_queued: true,
          queue_order: 2,
          hold: true,
        },
        {
          ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
          status: 'experimenting',
          attempts: 1,
          exp: 50,
          auto_queued: true,
          queue_order: 1,
          hold: false,
        },
        {
          ref: 'sov.protocol.ra3.sputnik_one_way_deployment',
          status: 'active',
          attempts: 2,
          exp: 100,
          auto_queued: false,
        },
      ],
      MOCK_CATALOG.protocols,
    );

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({
      ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
      name: '战斗工兵与预制碉堡协议',
      track: '苏联·工程防御轨',
      tier: 1,
      status: 'experimenting',
      exp: 50,
      next_prob_pct: 85,
      auto_queued: true,
      queue_order: 1,
      hold: false,
      laneKey: PROTOCOL_LANE_KEY,
    });
    expect(projected[1]).toMatchObject({
      ref: 'sov.protocol.ra3.crusher_crane_salvage',
      name: '碾压起重机与战场回收协议',
      track: '苏联·重工回收轨',
      tier: 2,
      status: 'available',
      exp: 0,
      next_prob_pct: 35,
      auto_queued: true,
      queue_order: 2,
      hold: true,
      laneKey: PROTOCOL_LANE_KEY,
    });
  });

  it('buildSchedulePanelModel 生成甘特条字段（ganttPct/ganttState/remainingMinutes）、nextMilestone 与 protocolLane', () => {
    const input: SchedulePanelInput = {
      clock: { day: 4, time: '14:00' },
      protocol_points: 2.5,
      bases: [
        {
          id: 'B1',
          name: '第一基地',
          buildings: [
            { name: '苏联战车工厂', state: '运转', mode: '生产' },
            { name: '苏联作战实验室', state: '运转' },
          ],
        },
      ],
      queues: [
        {
          type: '生产',
          item: '犀牛坦克',
          base: '第一基地',
          status: 'active',
          progress: 60,
          spent_minutes: 180,
          total_minutes: 300,
          hold: false,
        },
        {
          type: '生产',
          item: '天启坦克',
          base: '第一基地',
          status: 'queued',
          progress: 20,
          spent_minutes: 120,
          total_minutes: 600,
          hold: true,
        },
      ],
      protocols: [
        {
          ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
          status: 'experimenting',
          attempts: 1,
          exp: 50,
          auto_queued: true,
          queue_order: 1,
          hold: false,
        },
      ],
    };

    const model = buildSchedulePanelModel(input, TEST_CATALOG);
    const landLane = model.bases[0].lanes.find(l => l.name === '陆地载具生产线')!;

    expect(landLane.txns[0]).toMatchObject({
      item: '犀牛坦克',
      ganttPct: 60,
      ganttState: 'active',
      remainingMinutes: 120,
    });
    expect(landLane.txns[1]).toMatchObject({
      item: '天启坦克',
      ganttPct: 20,
      ganttState: 'paused',
      remainingMinutes: 480,
    });

    expect(model.nextMilestone).toMatchObject({
      hasMilestone: true,
      label: '最近完工项',
      itemName: '犀牛坦克',
      baseName: '第一基地',
      remainingMinutes: 120,
    });

    expect(model.protocolLane.enabled).toBe(true);
    expect(model.protocolLane.protocolPoints).toBe(2.5);
    expect(model.protocolLane.items).toHaveLength(1);
    expect(model.protocolLane.items[0]).toMatchObject({
      name: '战斗工兵与预制碉堡协议',
      exp: 50,
      next_prob_pct: 85,
      queue_order: 1,
    });

    expect(schedulePanelModel).toBe(buildSchedulePanelModel);
  });

  it('ModalSchedule.vue SSR 渲染顶栏里程碑提示（schedule-next-milestone）、甘特横道条（schedule-gantt-bar）与协议攻关泳道（schedule-protocol-lane）', async () => {
    const snapshot = {
      clock: { day: 6, time: '09:30' },
      protocol_points: 3.25,
      bases: [
        {
          id: 'B1',
          name: '新莫斯科基地',
          status: '正常',
          buildings: [
            { name: '苏联战车工厂', state: '运转', mode: '生产' },
            { name: '苏联作战实验室', state: '运转' },
          ],
        },
      ],
      queues: [
        {
          type: '生产',
          item: '犀牛坦克',
          base: '新莫斯科基地',
          status: 'active',
          progress: 75,
          spent_minutes: 225,
          total_minutes: 300,
          min_days_lock: 0,
          qty: 1,
          qty_done: 0,
          cost_paid: true,
          hold: false,
          started_at: 'D6 05:00',
          eta: 'D6 10:45',
        },
      ],
      protocols: [
        {
          ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
          status: 'experimenting',
          attempts: 1,
          exp: 50,
          points_spent: 1,
          credits_spent: 500,
          auto_queued: true,
          queue_order: 1,
          hold: false,
          updated_at_day: 6,
          schema_version: 1,
        },
      ],
    } as unknown as Schema;

    const html = await renderModalScheduleSSR(snapshot);

    // 1. 顶栏下一已知里程碑提示
    expect(html).toContain('data-test="schedule-next-milestone"');
    expect(html).toContain('最近完工项');
    expect(html).toContain('距离「犀牛坦克」完工预计还需');

    // 2. 任务行甘特横道进度条
    expect(html).toContain('data-test="schedule-gantt-bar"');
    expect(html).toContain('data-gantt-state="active"');
    expect(html).toContain('data-gantt-pct="75"');
    expect(html).toContain('width:75%');

    // 3. 统帅部条令攻关队列
    expect(html).toContain('data-test="schedule-protocol-lane"');
    expect(html).toContain('统帅部条令攻关队列');
    expect(html).toContain('战斗工兵与预制碉堡协议');
    expect(html).toContain('经验 50%');
    expect(html).toContain('突破率 85%');
    expect(html).toContain('顺位 #1');
  });

  it('PKG-C v2：多轨甘特子轨道（工位 #1 / #2）、时间标尺切换、产线双模切换、六动词二次确认防误触与指令托盘交互闭环', async () => {
    const snapshot = {
      clock: { day: 6, time: '09:30' },
      protocol_points: 1,
      bases: [
        {
          id: 'B1',
          name: '新莫斯科基地',
          status: '正常',
          buildings: [
            { name: '苏联战车工厂', state: '运转', mode: '生产' },
            { name: '苏联战车工厂', state: '运转', mode: '生产' },
            { name: '苏联战车工厂', state: '运转', mode: '加速', accel_scope: 'global' },
          ],
        },
        {
          id: 'B2',
          name: '北极星船坞',
          status: '正常',
          buildings: [],
        },
      ],
      queues: [
        {
          type: '生产',
          item: '犀牛坦克',
          base: '新莫斯科基地',
          status: 'active',
          progress: 50,
          spent_minutes: 150,
          total_minutes: 300,
          hold: false,
        },
        {
          type: '生产',
          item: '天启坦克',
          base: '新莫斯科基地',
          status: 'active',
          progress: 25,
          spent_minutes: 150,
          total_minutes: 600,
          hold: false,
        },
        {
          type: '生产',
          item: '基洛夫空艇',
          base: '新莫斯科基地',
          status: 'queued',
          progress: 0,
          spent_minutes: 0,
          total_minutes: 480,
          hold: false,
        },
      ],
      protocols: [],
    } as unknown as Schema;

    const html = await renderModalScheduleSSR(snapshot);
    expect(html).toContain('工位 #1');
    expect(html).toContain('工位 #2');
    expect(html).toContain('生产×2 · 加速×1');
    expect(html).toContain('加速 1.50x');
    expect(html).toContain('T0 (第6日 09:30)');
    expect(html).toContain('data-test="schedule-gantt-axis-header"');
    expect(html).toContain('data-test="schedule-gantt-subtrack"');
    expect(html).toContain('data-test="schedule-gantt-gridline"');
    expect(html).toContain('data-test="schedule-gantt-hatch"');
    expect(html).toContain('data-test="schedule-gantt-block"');
    expect(html).toContain('data-test="schedule-gantt-legend"');

    // 交互绑定验证：三视图切换、时间标尺切换、撤销二次确认防误触、双模切换与指令托盘
    const bindings = await loadModalScheduleSetup(snapshot);
    expect(bindings.viewMode.value).toBe('base');
    bindings.viewMode.value = 'domain';
    expect(bindings.filteredDomainGroups.value.length).toBeGreaterThanOrEqual(5);
    bindings.viewMode.value = 'table';
    expect(bindings.allTableRows.value).toHaveLength(3);

    expect(bindings.horizonMode.value).toBe('auto');
    expect(bindings.ganttAxis.value.horizonMinutes).toBe(1440);
    bindings.horizonMode.value = '72h';
    expect(bindings.ganttAxis.value.horizonMinutes).toBe(4320);
    bindings.horizonMode.value = '7d';
    expect(bindings.ganttAxis.value.horizonMinutes).toBe(10080);
    bindings.horizonMode.value = '30d';
    expect(bindings.ganttAxis.value.horizonMinutes).toBe(43200);

    // 撤销需二次点击确认（D2-1 防误触契约）
    const firstTxn = bindings.activeInspectorTxn.value;
    expect(firstTxn.item).toBe('犀牛坦克');
    await bindings.onExtendedDispatch('撤销', firstTxn);
    expect(bindings.confirmingCancelKey.value).toBe(bindings.txnKey(firstTxn));
    expect((snapshot.queues as any[])[0].status).toBe('active');
    await bindings.onExtendedDispatch('撤销', firstTxn);
    expect(bindings.confirmingCancelKey.value).toBeNull();
    expect((snapshot.queues as any[])[0].status).toBe('cancelled');

    // 参谋指令托盘暂存与清空
    const nextTxn = bindings.activeInspectorTxn.value;
    bindings.enqueueInspectorToTray('置顶', nextTxn);
    expect(bindings.commandTray.value).toHaveLength(1);
    expect(bindings.commandTray.value[0].verb).toBe('置顶');
    bindings.clearCommandTray();
    expect(bindings.commandTray.value).toHaveLength(0);

    // 产线双模内嵌切换：将第 1 座生产模式战车工厂切为加速
    const landLane = bindings.model.value.bases[0].lanes.find((l: any) => l.name === '陆地载具生产线');
    const firstInst = landLane.dualModeSummary.instances[0];
    expect(firstInst.mode).toBe('生产');
    await bindings.onToggleBuildingMode(firstInst);
    expect((snapshot.bases[0].buildings as any[])[0].mode).toBe('加速');
  });
});
