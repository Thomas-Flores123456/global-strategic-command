import { describe, expect, it } from 'vitest';
import { IncomeChain } from '../core/schema';
import type { IncomeChain as IncomeChainT } from '../core/schema';
import {
  applyGridConstraints,
  GRID_OUTAGE_MARKER,
  GRID_RESTORE_NOTE,
  type BasePowerView,
} from '../engines/operationEngine';

function mkChain(over: Partial<IncomeChainT> & Pick<IncomeChainT, 'id' | 'name'>): IncomeChainT {
  return IncomeChain.parse({ rate_daily: 600, ...over });
}

describe('G04-03 · 挂起身份不由自然语言原因决定', () => {
  it.each(['active', 'distressed'] as const)('%s 链叙述含电网断供仍需钳制，恢复保留原态与效率', status => {
    const chain = mkChain({
      id: 'chain_trade', name: '商路甲', status, eff: 0.7,
      reason: '电网断供后另辟商路',
      deps: { base_id: 'b1', buildings: [], world_resource: '' },
    });
    const outage = applyGridConstraints({
      chains: [chain], bases: [{ id: 'b1', power: { gen: 0, use: 100 } }],
    });
    expect(outage.chains[0]).toMatchObject({ status: 'distressed', eff: 0 });
    expect(outage.events[0].kind).toBe('grid_outage');
    const restored = applyGridConstraints({
      chains: outage.chains, bases: [{ id: 'b1', power: { gen: 100, use: 100 } }],
    });
    expect(restored.chains[0]).toMatchObject({ status, eff: 0.7, reason: chain.reason });
    expect(restored.events[0].kind).toBe('grid_restore');
  });

  it.each(['broken', 'exhausted'] as const)('%s 不因原因或遗留原态后缀而复活', status => {
    for (const reason of ['电网断供，合同终止', '电网断供[原状态:active,eff:1]']) {
      const chain = mkChain({
        id: 'chain_trade', name: '商路甲', status, eff: 0, reason,
        deps: { base_id: 'b1', buildings: [], world_resource: '' },
      });
      const result = applyGridConstraints({
        chains: [chain], bases: [{ id: 'b1', power: { gen: 100, use: 100 } }],
      });
      expect(result.chains[0]).toEqual(chain);
      expect(result.events).toEqual([]);
    }
  });

  it('原态文本位于叙述中间而非末尾时，不算引擎挂起态', () => {
    const chain = mkChain({
      id: 'chain_trade', name: '商路甲', status: 'distressed', eff: 0.4,
      reason: '电网断供[原状态:active,eff:1]仅为历史记录',
    });
    const result = applyGridConstraints({ chains: [chain], bases: [] });
    expect(result.chains[0]).toEqual(chain);
    expect(result.events).toEqual([]);
  });
});

describe('FIX-P1-04 · operationEngine 资金链电网恢复受挫态保留与建筑依赖运转校验', () => {
  it('09 [P1-1]：原本处于 distressed (eff=0.5) 的资金链遭遇断电挂起后，电网恢复时还原为 distressed (eff=0.5) 与原始业务备注，不被洗白为 active (eff=1)', () => {
    const distressedChain = mkChain({
      id: 'chain_smuggle',
      name: '灵石走私走廊',
      rate_daily: 600,
      status: 'distressed',
      eff: 0.5,
      reason: '商队遭土匪袭扰，运力折损过半',
      deps: { base_id: 'b1', buildings: ['隐蔽仓库'], world_resource: '' },
    });

    // 1. 基地断电挂起
    const outage = applyGridConstraints({
      chains: [distressedChain],
      bases: [{ id: 'b1', power: { gen: 30, use: 100 } }],
      nowDay: 5,
    });
    expect(outage.chains[0].status).toBe('distressed');
    expect(outage.chains[0].eff).toBe(0);
    expect(outage.chains[0].reason).toContain(GRID_OUTAGE_MARKER);
    expect(outage.chains[0].reason).toContain('商队遭土匪袭扰，运力折损过半');
    expect(outage.chains[0].reason).toContain('[原状态:distressed,eff:0.5]');

    // 2. 电网恢复：还原为 distressed、eff=0.5 且恢复原始业务备注
    const restored = applyGridConstraints({
      chains: outage.chains,
      bases: [{ id: 'b1', power: { gen: 150, use: 100 } }],
      nowDay: 6,
    });
    expect(restored.chains[0].status).toBe('distressed');
    expect(restored.chains[0].eff).toBe(0.5);
    expect(restored.chains[0].reason).toBe('商队遭土匪袭扰，运力折损过半');
    expect(restored.events).toEqual([
      expect.objectContaining({ id: 'chain_smuggle', kind: 'grid_restore' }),
    ]);

    // 3. 再次运行幂等无事件
    const again = applyGridConstraints({
      chains: restored.chains,
      bases: [{ id: 'b1', power: { gen: 150, use: 100 } }],
      nowDay: 6,
    });
    expect(again.events).toEqual([]);
    expect(again.chains[0]).toBe(restored.chains[0]);
  });

  it('09 [P1-1]：原本处于 active (eff=1) 且无初始备注的链条断电恢复后，还原为 active (eff=1) 与 GRID_RESTORE_NOTE', () => {
    const activeChain = mkChain({
      id: 'chain_ore',
      name: '北坡矿线',
      rate_daily: 500,
      status: 'active',
      eff: 1,
      reason: '',
      deps: { base_id: 'b1', buildings: [], world_resource: '' },
    });

    const outage = applyGridConstraints({
      chains: [activeChain],
      bases: [{ id: 'b1', power: { gen: 20, use: 80 } }],
      nowDay: 2,
    });
    expect(outage.chains[0].eff).toBe(0);

    const restored = applyGridConstraints({
      chains: outage.chains,
      bases: [{ id: 'b1', power: { gen: 120, use: 80 } }],
      nowDay: 3,
    });
    expect(restored.chains[0].status).toBe('active');
    expect(restored.chains[0].eff).toBe(1);
    expect(restored.chains[0].reason).toBe(GRID_RESTORE_NOTE);
  });

  it('09 [P2-2]：基地供电充足但 deps.buildings 依赖建筑非「运转」（如受损/停机/拆毁缺失）时，挂起资金链；建筑恢复「运转」后复原', () => {
    const chain = mkChain({
      id: 'chain_refinery',
      name: '精炼矿产外销线',
      rate_daily: 800,
      status: 'active',
      eff: 1,
      reason: '长期矿石供货合同',
      deps: { base_id: 'b1', buildings: ['矿石精炼厂'], world_resource: '' },
    });

    // 供电充足（gen 200 > use 100），但依赖建筑「矿石精炼厂」处于「受损」态
    const baseDamaged: BasePowerView = {
      id: 'b1',
      power: { gen: 200, use: 100 },
      buildings: [{ name: '矿石精炼厂', state: '受损' }],
    };
    const clamped = applyGridConstraints({ chains: [chain], bases: [baseDamaged], nowDay: 4 });
    expect(clamped.chains[0].status).toBe('distressed');
    expect(clamped.chains[0].eff).toBe(0);
    expect(clamped.events).toHaveLength(1);
    expect(clamped.events[0].kind).toBe('grid_outage');

    // 依赖建筑被拆毁缺失时同样保持挂起
    const baseMissing: BasePowerView = {
      id: 'b1',
      power: { gen: 200, use: 100 },
      buildings: [{ name: '磁暴反应炉', state: '运转' }],
    };
    const stillClamped = applyGridConstraints({ chains: clamped.chains, bases: [baseMissing], nowDay: 5 });
    expect(stillClamped.chains[0].eff).toBe(0);
    expect(stillClamped.events).toEqual([]);

    // 依赖建筑修缮恢复「运转」后自动还原
    const baseRunning: BasePowerView = {
      id: 'b1',
      power: { gen: 200, use: 100 },
      buildings: [{ name: '矿石精炼厂', state: '运转' }],
    };
    const restored = applyGridConstraints({ chains: stillClamped.chains, bases: [baseRunning], nowDay: 6 });
    expect(restored.chains[0].status).toBe('active');
    expect(restored.chains[0].eff).toBe(1);
    expect(restored.chains[0].reason).toBe('长期矿石供货合同');
    expect(restored.events[0].kind).toBe('grid_restore');
  });
});
