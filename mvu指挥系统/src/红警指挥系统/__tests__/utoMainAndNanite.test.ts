import { describe, expect, it } from 'vitest';
import { EconomyResources, Schema } from '../core/schema';
import { deductNanitesStock, readTotalNanites } from '../engines/settleFloorHelpers';
import type { TransactionItem } from '../engines/transactionEngine';
import { settleWithTwoStage } from '../engines/twoStageAssemblyEngine';
import type { StatData } from '../parse/parsePipeline';

describe('G05-01 · 资源非负合同与旧快照纳米汇总', () => {
  it.each(['nanites', 'minerals', 'materials', 'fuel', 'munitions', 'logistics'] as const)(
    '%s 拒收负库存，保留 null/0/正数与动态小类',
    pillar => {
      expect(() => EconomyResources.parse({ [pillar]: { 异常物料: -1 } })).toThrow();
      const resources = EconomyResources.parse({ [pillar]: { 未探明: null, 告罄: 0, 动态物料: 1 } });
      expect(resources[pillar]).toEqual({ 未探明: null, 告罄: 0, 动态物料: 1 });
    },
  );

  it('完整Schema拒收混合正负库存，resources缺席仍不注入', () => {
    expect(() => Schema.parse({ economy: { resources: { nanites: { 标准: 100, 异常: -80 } } } })).toThrow();
    expect(Schema.parse({}).economy.resources).toBeUndefined();
  });

  it('旧快照负小类不抵销正库存，汇总不改写库存事实', () => {
    const nanites = { 标准: 100, 异常: -80, 未探明: null, 告罄: 0 };
    const snapshot = { economy: { resources: { nanites } } } as StatData;
    expect(readTotalNanites(snapshot)).toBe(100);
    expect(nanites).toEqual({ 标准: 100, 异常: -80, 未探明: null, 告罄: 0 });
  });

  it.each([100, 0, -80])('旧数值型与单小类record型库存 %s 口径一致', value => {
    const scalar = { economy: { resources: { nanites: value } } } as unknown as StatData;
    const record = { economy: { resources: { nanites: { 标准: value } } } } as StatData;
    expect(readTotalNanites(scalar)).toBe(Math.max(0, value));
    expect(readTotalNanites(record)).toBe(readTotalNanites(scalar));
  });
});

describe('G05-02 · 调度生效后才消费纳米', () => {
  const task: TransactionItem = {
    type: '生产', item: 'A', base: 'alpha', progress: 0, eta: '', status: 'active',
    started_at: '', total_minutes: 1000, spent_minutes: 0, qty: 1, qty_done: 0,
    cost_paid: true, min_days_lock: 0, hold: false,
  };
  const options = {
    assemblyFor: () => ({ t_mat: 400, t_asm: 600, req_nanites: 80 }),
    nanitesFor: () => 100,
  };

  it.each([0, 100])('暂缓A保留已有工时%s，库存不变且不再抵扣', spent => {
    const state = Schema.parse({
      economy: { resources: { nanites: { 标准: 100 } } },
      queues: [{ ...task, spent_minutes: spent, progress: spent / 10 }],
    });
    const result = settleWithTwoStage(state, 0, { ...options, orders: [{ item: 'A', verb: '暂缓' }] });
    expect(result.next.queues[0]).toMatchObject({ status: 'queued', hold: true, spent_minutes: spent, progress: spent / 10 });
    expect(result.events.filter(e => e.type === 'nanites_deducted')).toEqual([]);
    expect(result.nanitesConsumed).toBe(0);
    expect(readTotalNanites(deductNanitesStock(result.next, result.nanitesConsumed))).toBe(100);
  });

  it('A暂缓后B可用80，共享100库存剩20', () => {
    const result = settleWithTwoStage({ queues: [task, { ...task, item: 'B', status: 'queued' as const }] }, 0, {
      ...options, orders: [{ item: 'A', verb: '暂缓' }],
    });
    expect(result.next.queues[0].spent_minutes).toBe(0);
    expect(result.next.queues[1]).toMatchObject({ status: 'active', spent_minutes: 400 });
    expect(result.events.filter(e => e.type === 'nanites_deducted')).toMatchObject([{ item: 'B', amount: 80 }]);
    expect(result.remainingNanites).toBe(20);
  });

  it('暂缓再恢复只调度一次，重新升格后抵扣一次', () => {
    const result = settleWithTwoStage({ queues: [task] }, 0, {
      ...options, orders: [{ item: 'A', verb: '暂缓' }, { item: 'A', verb: '恢复' }],
    });
    expect(result.next.queues[0]).toMatchObject({ status: 'active', hold: false, spent_minutes: 400 });
    expect(result.events.filter(e => e.type === 'demoted')).toHaveLength(1);
    expect(result.events.filter(e => e.type === 'promoted')).toHaveLength(1);
    expect(result.events.filter(e => e.type === 'nanites_deducted')).toHaveLength(1);
    expect(result.nanitesConsumed).toBe(80);
  });
});
