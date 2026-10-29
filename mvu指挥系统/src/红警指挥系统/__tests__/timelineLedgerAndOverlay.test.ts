import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILDINGS, PRODUCTIONS, RESEARCHES } from '../core/catalog';
import { dataPatchesToDlcOverlay, mergeEffectiveCatalog } from '../core/catalogEffective';
import { Schema, type DataPatch } from '../core/schema';
import * as sysCheck from '../parse/systemCheck';
import {
  appendFloorProcessOp,
  appendWorldbookMutation,
  getSwipeSlot,
  makeFloorKey,
  makeSwipeKey,
  makeSwipeScopedKey,
  normalizeTimelineLedger,
  parseSwipeScopedKey,
  pruneTimelineAboveFloor,
  readTimelineLedger,
  replayFloorProcessOps,
  resetMemoryTimelineLedgerForTest,
} from '../core/timelineLedger';
import * as useCat from '../composables/useCatalog';
import { fileDataPatch } from '../worldbook/worldbookDataFiler';

describe('timelineLedger · 键名编码与双因子隔离（防 Lodash 稀疏数组）', () => {
  it('makeFloorKey / makeSwipeKey / makeSwipeScopedKey 永不产生纯数字键', () => {
    expect(makeFloorKey(0)).toBe('f_0');
    expect(makeFloorKey(15)).toBe('f_15');
    expect(makeFloorKey(-3)).toBe('f_0');
    expect(makeSwipeKey(0)).toBe('s_0');
    expect(makeSwipeKey(2)).toBe('s_2');
    expect(makeSwipeScopedKey(15, 2)).toBe('f_15__s_2');

    for (const key of [makeFloorKey(0), makeFloorKey(99), makeSwipeKey(0), makeSwipeScopedKey(12, 3)]) {
      expect(/^\d+$/.test(key)).toBe(false);
    }
  });

  it('parseSwipeScopedKey 兼容双因子键、单因子前缀键与历史纯数字键', () => {
    expect(parseSwipeScopedKey('f_12__s_3')).toEqual({ floorId: 12, swipeId: 3 });
    expect(parseSwipeScopedKey('f_8')).toEqual({ floorId: 8, swipeId: null });
    expect(parseSwipeScopedKey('8')).toEqual({ floorId: 8, swipeId: null });
    expect(parseSwipeScopedKey('')).toBeNull();
    expect(parseSwipeScopedKey('invalid_key')).toBeNull();
  });

  it('normalizeTimelineLedger 将裸数字楼层/Swipe 键强制归一化为 f_N / s_N', () => {
    const normalized = normalizeTimelineLedger({
      version: 1,
      originChatId: 'chat_main',
      boundBookName: '红警档案·测试',
      maxFloorWatermark: 5,
      floors: {
        '5': {
          floorId: 5,
          activeSwipeId: 1,
          swipes: {
            '1': {
              floorId: 5,
              swipeId: 1,
              textHash: 'abc',
              opLog: [],
              wbJournal: [],
              updatedAt: 1000,
            },
          },
        },
      },
    });

    expect(Object.keys(normalized.floors)).toEqual(['f_5']);
    expect(Object.keys(normalized.floors.f_5.swipes)).toEqual(['s_1']);
  });
});

describe('timelineLedger · appendFloorProcessOp & replayFloorProcessOps 四类过程量幂等重放', () => {
  beforeEach(() => {
    resetMemoryTimelineLedgerForTest();
    vi.restoreAllMocks();
  });

  it('appendFloorProcessOp 对同标识操作幂等去重更新，并按 (floorId, swipeId) 隔离存储', () => {
    appendFloorProcessOp(3, 0, {
      kind: 'PATCH_DECISION',
      ts: 100,
      patchId: 'patch_wf_1',
      decision: 'defer',
    });
    appendFloorProcessOp(3, 0, {
      kind: 'PATCH_DECISION',
      ts: 200,
      patchId: 'patch_wf_1',
      decision: 'approve',
      patchSnapshot: {
        id: 'patch_wf_1',
        target: '战车工厂',
        operation: 'patch',
        patch: { cost: 1600 },
        reason: '模块化减重',
        timestamp: 200,
        status: 'applied',
      },
    });
    appendFloorProcessOp(3, 1, {
      kind: 'CHRONO_RESOLVE',
      ts: 300,
      conflictId: 'conf_01',
      resolution: 'defer',
    });

    const ledger = readTimelineLedger();
    const slot0 = getSwipeSlot(ledger, 3, 0);
    const slot1 = getSwipeSlot(ledger, 3, 1);

    expect(slot0?.opLog).toHaveLength(1);
    expect(slot0?.opLog[0]).toMatchObject({
      kind: 'PATCH_DECISION',
      patchId: 'patch_wf_1',
      decision: 'approve',
    });
    expect(slot1?.opLog).toHaveLength(1);
    expect(slot1?.opLog[0]).toMatchObject({
      kind: 'CHRONO_RESOLVE',
      conflictId: 'conf_01',
      resolution: 'defer',
    });
  });

  it('replayFloorProcessOps 在重算后 100% 幂等恢复 COMMIT_PLANNING / CHRONO_RESOLVE / SUBMIT_FIX / PATCH_DECISION', () => {
    const rawStatData = {
      economy: { credits: 5000 },
      queues: [{ type: '建造', item: '发电厂', progress: 50 }],
      bases: [{ id: '一号基地', buildings: [{ name: '建造厂核心', count: 1 }] }],
      forces: { troops: { 动员兵: 10 } },
      planning: { pending_plan: { id: 'plan_1' } },
      pending_data_patches: [
        {
          id: 'p_approve',
          target: '战车工厂',
          operation: 'patch',
          patch: { cost: 1500 },
          reason: '战地改造',
          timestamp: 10,
          status: 'pending',
        },
        {
          id: 'p_defer',
          target: '兵营',
          operation: 'patch',
          patch: { cost: 400 },
          reason: '预制件',
          timestamp: 11,
          status: 'pending',
        },
        {
          id: 'p_reject',
          target: '矿石精炼厂',
          operation: 'patch',
          patch: { cost: 1800 },
          reason: '驳回项',
          timestamp: 12,
          status: 'pending',
        },
      ],
      applied_data_patches: [],
    };

    const ops = [
      {
        kind: 'SUBMIT_FIX' as const,
        ts: 100,
        blockType: '变量更新',
        fixedYaml: 'economy:\n  credits: 4800',
        fixedStatSnapshot: {
          ...rawStatData,
          economy: { credits: 4800 },
        },
      },
      {
        kind: 'COMMIT_PLANNING' as const,
        ts: 200,
        planId: 'plan_1',
        optionKey: 'A',
        approvedAtTurn: 3,
        queuesSnapshot: [
          { type: '建造', item: '发电厂', progress: 50 },
          { type: '建造', item: '战车工厂', progress: 0 },
        ],
        creditsAfter: 2800,
        planningSnapshot: { pending_plan: null, latest_receipt: { planId: 'plan_1', option: 'A' } },
      },
      {
        kind: 'CHRONO_RESOLVE' as const,
        ts: 300,
        conflictId: 'chrono_1',
        resolution: 'force' as const,
        queuesSnapshot: [{ type: '建造', item: '战车工厂', progress: 0 }],
        basesSnapshot: [
          {
            id: '一号基地',
            buildings: [
              { name: '建造厂核心', count: 1 },
              { name: '发电厂', count: 1 },
            ],
          },
        ],
        forcesSnapshot: { troops: { 动员兵: 20 } },
      },
      {
        kind: 'PATCH_DECISION' as const,
        ts: 400,
        patchId: 'p_approve',
        patchTarget: '战车工厂',
        decision: 'approve' as const,
      },
      {
        kind: 'PATCH_DECISION' as const,
        ts: 401,
        patchId: 'p_defer',
        patchTarget: '兵营',
        decision: 'defer' as const,
      },
      {
        kind: 'PATCH_DECISION' as const,
        ts: 402,
        patchId: 'p_reject',
        patchTarget: '矿石精炼厂',
        decision: 'reject' as const,
      },
    ];

    const replayedOnce = replayFloorProcessOps(rawStatData, ops, { floorId: 3 });
    const replayedTwice = replayFloorProcessOps(replayedOnce, ops, { floorId: 3 });

    expect(replayedOnce.economy.credits).toBe(2800);
    expect(replayedOnce.queues).toEqual([{ type: '建造', item: '战车工厂', progress: 0 }]);
    expect(replayedOnce.bases[0].buildings).toHaveLength(2);
    expect(replayedOnce.forces.troops.动员兵).toBe(20);
    expect(replayedOnce.pending_data_patches).toHaveLength(1);
    expect(replayedOnce.pending_data_patches[0]).toMatchObject({ id: 'p_defer', status: 'deferred' });
    expect(replayedOnce.applied_data_patches).toHaveLength(1);
    expect(replayedOnce.applied_data_patches[0]).toMatchObject({
      id: 'p_approve',
      target: '战车工厂',
      status: 'applied',
    });

    // 重复重放完全幂等
    expect(replayedTwice).toEqual(replayedOnce);
  });

  it('pruneTimelineAboveFloor 裁剪高楼层并按时间逆序返回世界书变更日志', () => {
    appendWorldbookMutation(2, 0, {
      ts: 100,
      bookName: '红警档案·主线',
      entryName: '机娘·白凌',
      op: 'create',
      beforeEntry: null,
    });
    appendWorldbookMutation(4, 0, {
      ts: 200,
      bookName: '红警档案·主线',
      entryName: '机娘·赤瞳',
      op: 'create',
      beforeEntry: null,
    });
    appendWorldbookMutation(5, 1, {
      ts: 300,
      bookName: '红警档案·主线',
      entryName: '扩展·重装试验场',
      op: 'update',
      beforeEntry: { name: '扩展·重装试验场', content: 'old', enabled: true },
    });

    const current = readTimelineLedger();
    const { nextLedger, removedWbMutations } = pruneTimelineAboveFloor(current, 3);

    expect(Object.keys(nextLedger.floors)).toEqual(['f_2']);
    expect(nextLedger.maxFloorWatermark).toBe(2);
    expect(removedWbMutations.map(m => m.entryName)).toEqual(['扩展·重装试验场', '机娘·赤瞳']);
  });
});

describe('SEAM-03 · applied_data_patches 内存叠加态与回退零污染验证', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Schema 默认包含 applied_data_patches 空数组', () => {
    const parsed = Schema.parse({});
    expect(parsed.applied_data_patches).toEqual([]);
  });

  it('dataPatchesToDlcOverlay 与 mergeEffectiveCatalog 第 4 参数实时生效且回退后 100% 恢复原值', () => {
    const origWarFactory = BUILDINGS.find(b => b.name === '战车工厂')!;
    const origResearch = RESEARCHES[0]!;
    const origProduction = PRODUCTIONS[0]!;
    const origWfCost = origWarFactory.cost;
    const origWfPower = origWarFactory.power;
    const origResCost = origResearch.cost;
    const origProdCost = origProduction.cost;

    expect(dataPatchesToDlcOverlay([])).toBeNull();
    expect(dataPatchesToDlcOverlay(null)).toBeNull();

    const patches = [
      {
        id: 'p_wf',
        target: '战车工厂',
        category: 'building',
        changes: { cost: 1350, power: 25 },
      },
      {
        id: 'p_res',
        target: origResearch.name,
        patch: { cost: 99 },
      },
      {
        id: 'p_prod',
        target: origProduction.name,
        changes: { cost: 123 },
      },
    ];

    const overlay = dataPatchesToDlcOverlay(patches);
    expect(overlay).not.toBeNull();
    expect(overlay?.id).toBe('__timeline_data_patches__');
    expect(overlay?.buildings?.find(b => b.name === '战车工厂')?.cost).toBe(1350);

    // 合并第 4 层叠加态
    const patchedCatalog = mergeEffectiveCatalog([], null, undefined, patches);
    const patchedWf = patchedCatalog.buildings.find(b => b.name === '战车工厂')!;
    const patchedRes = patchedCatalog.researches.find(r => r.name === origResearch.name)!;
    const patchedProd = patchedCatalog.productions.find(p => p.name === origProduction.name)!;

    expect(patchedWf.cost).toBe(1350);
    expect(patchedWf.power).toBe(25);
    expect(patchedRes.cost).toBe(99);
    expect(patchedProd.cost).toBe(123);

    // 静态基线常量引用零污染
    expect(origWarFactory.cost).toBe(origWfCost);
    expect(origWarFactory.power).toBe(origWfPower);
    expect(origResearch.cost).toBe(origResCost);
    expect(origProduction.cost).toBe(origProdCost);

    // 模拟删楼/切 Swipe 回退到无补丁楼层（appliedDataPatches = []）
    const rolledBackCatalog = mergeEffectiveCatalog([], null, undefined, []);
    expect(rolledBackCatalog.buildings.find(b => b.name === '战车工厂')?.cost).toBe(origWfCost);
    expect(rolledBackCatalog.buildings.find(b => b.name === '战车工厂')?.power).toBe(origWfPower);
    expect(rolledBackCatalog.researches.find(r => r.name === origResearch.name)?.cost).toBe(origResCost);
    expect(rolledBackCatalog.productions.find(p => p.name === origProduction.name)?.cost).toBe(origProdCost);
  });

  it('fileDataPatch(patch, { preferTimelineOverlay: true }) 零物理写入全局世界书', async () => {
    const mockUpdateWb = vi.fn();
    vi.spyOn(sysCheck, 'tav').mockImplementation(((name: string) => {
      if (name === 'updateWorldbookWith') return mockUpdateWb;
      return undefined;
    }) as any);
    vi.spyOn(useCat, 'resolveActiveWorldbookNames').mockReturnValue(['通用·主建筑_世界书']);

    const patch: DataPatch = {
      id: 'patch_overlay_01',
      target: '战车工厂',
      operation: 'patch',
      patch: { cost: 1500, power: 30 },
      reason: '时间线内存叠加态测试',
      timestamp: Date.now(),
      status: 'pending',
    };

    const receipt = await fileDataPatch(patch, { preferTimelineOverlay: true });

    expect(receipt.success).toBe(true);
    expect(receipt.action).toBe('updated');
    expect(receipt.worldbook).toBe('TIMELINE_OVERLAY（楼层内存叠加态）');
    expect(receipt.diff?.hasChanges).toBe(true);
    // 核心断言：绝不调用 updateWorldbookWith 污染全局设定世界书
    expect(mockUpdateWb).not.toHaveBeenCalled();
  });
});
