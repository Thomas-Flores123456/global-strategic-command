import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FloorSnapshot } from '../parse/floorScanner';
import {
  buildResearchSlotOccupancy,
  deriveGlobalResearchLimit,
  deriveResearchAdvisory,
  formatResearchAdvisory,
} from '../planning/researchAdvisory';
import { Schema, SCHEMA_VERSION } from '../core/schema';
import { checkAssetQueueCross, checkEnv, tav } from '../parse/systemCheck';

const snapshotOf = (stat: Record<string, unknown>, floorId = 5): FloorSnapshot => ({
  floorId,
  schemaVersion: SCHEMA_VERSION,
  data: Schema.parse(stat),
});

/**
 * 编译并挂载 PanelExportSave.vue 的 <script setup lang="ts"> 逻辑，
 * 直接在 Node 环境下对真实组件代码做行为级验证。
 */
function setupPanelExportSave() {
  const vuePath = path.resolve(__dirname, '../../中控悬浮窗/panels/PanelExportSave.vue');
  const sfc = fs.readFileSync(vuePath, 'utf-8');
  const match = sfc.match(/<script\s+setup\s+lang="ts">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('PanelExportSave.vue <script setup lang="ts"> not found');
  }
  const scriptSource = `${match[1]}\nreturn { expBusy, expMsg, expErr, expJson, doExportSave, resolveLatestExportFloor };`;
  const transpiled = ts.transpileModule(scriptSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });

  const customRequire = (id: string) => {
    if (id === 'vue') return { ref };
    if (id === '../../红警指挥系统/composables/store') return { in_tavern: true };
    if (id === '../../红警指挥系统/parse/systemCheck') return { checkEnv, tav };
    throw new Error(`Unexpected import in PanelExportSave.vue: ${id}`);
  };

  const fn = new Function('exports', 'require', transpiled.outputText);
  return fn({}, customRequire) as {
    expBusy: ReturnType<typeof ref<boolean>>;
    expMsg: ReturnType<typeof ref<string>>;
    expErr: ReturnType<typeof ref<string>>;
    expJson: ReturnType<typeof ref<string>>;
    doExportSave: () => Promise<void>;
  };
}

describe('UX-ADV-01 · researchAdvisory 11 槽全局科研余量与已开通序列状态（07 [P1-2]）', () => {
  it('准确统计已开通序列数、当前在研占用数与 T1 全局并行余量，并格式化输出到提示词', () => {
    const snap = snapshotOf({
      economy: { credits: 1200 },
      bases: [
        {
          id: 'b1',
          name: '主基地',
          buildings: [
            { name: '盟军建造厂', state: '运转' }, // 开通 slot.main、slot.faction
            { name: '矿石精炼厂', state: '运转' }, // 开通 slot.industry
            { name: '兵营', state: '运转' }, // 开通 slot.defense、slot.personnel
            { name: '战车工厂', state: '建造中' }, // 建造中不开通 slot.vehicle
          ],
        },
      ],
      queues: [{ type: '研究', item: '基础步兵训练学', base: 'b1', status: 'active' }],
    });

    const advisory = deriveResearchAdvisory(snap, [])!;
    expect(advisory).not.toBeNull();
    expect(advisory.slotOccupancy).toBeDefined();

    const occ = advisory.slotOccupancy!;
    expect(occ.totalSlots).toBe(11);
    expect(occ.unlockedSlots).toBe(5);
    expect(occ.unlockedSlotNames).toEqual([
      '主建筑槽',
      '工业基础槽',
      '防御辅助槽',
      '人员槽',
      '阵营特色槽',
    ]);
    expect(occ.activeCount).toBe(1);
    expect(occ.queuedCount).toBe(0);
    expect(occ.availableUnlockedSlots).toBe(4);
    expect(occ.techTier).toBe(1);
    expect(occ.globalLimit).toBe(2);
    expect(occ.globalRemaining).toBe(1);
    expect(occ.effectiveRemaining).toBe(1);

    const text = formatResearchAdvisory(advisory);
    expect(text).toContain(
      '战区11大科研序列：已开通 5/11（主建筑槽、工业基础槽、防御辅助槽、人员槽、阵营特色槽）',
    );
    expect(text).toContain('当前在研 1/2（主建筑槽：基础步兵训练学）');
    expect(text).toContain('全局并行余量 1（T1）');
  });

  it('T2 与 T3 科技资格建筑在场时，全局并行上限与余量动态升档（T2=4 / T3=不限）', () => {
    const t2State = {
      bases: [
        {
          buildings: [
            { name: '盟军建造厂', state: '运转' },
            { name: '兵营', state: '运转' },
            { name: '矿石精炼厂', state: '运转' },
            { name: '盟军战斗实验室', state: '运转' },
          ],
        },
      ],
      queues: [
        { type: '研究', item: '基础步兵训练学', base: 'b1', status: 'active' },
        { type: '研究', item: '石油勘探学', base: 'b1', status: 'active' },
      ],
    };
    expect(deriveGlobalResearchLimit(t2State)).toEqual({ techTier: 2, globalLimit: 4 });

    const t2Snap = snapshotOf({
      economy: { credits: 2000 },
      bases: [
        {
          id: 'b1',
          name: '科研基地',
          buildings: t2State.bases[0].buildings,
        },
      ],
      queues: t2State.queues,
    });
    const t2Advisory = deriveResearchAdvisory(t2Snap, [])!;
    expect(t2Advisory.slotOccupancy?.techTier).toBe(2);
    expect(t2Advisory.slotOccupancy?.globalLimit).toBe(4);
    expect(t2Advisory.slotOccupancy?.activeCount).toBe(2);
    expect(t2Advisory.slotOccupancy?.globalRemaining).toBe(2);
    const t2Text = formatResearchAdvisory(t2Advisory);
    expect(t2Text).toContain('当前在研 2/4');
    expect(t2Text).toContain('全局并行余量 2（T2）');

    const t3State = {
      bases: [{ buildings: [{ name: '量子超算中心', state: '运转' }] }],
      queues: [],
    };
    const t3Occ = buildResearchSlotOccupancy(t3State, []);
    expect(t3Occ.techTier).toBe(3);
    expect(t3Occ.globalLimit).toBe(Infinity);
    expect(t3Occ.globalRemaining).toBe(Infinity);
  });
});

describe('UX-ADV-01 · PanelExportSave.vue 中控全局脚本环境导出修复', () => {
  const g = globalThis as Record<string, unknown>;
  const savedKeys = ['getVariables', 'getCurrentMessageId', 'getLastMessageId', 'getChatMessages', 'getCurrentChatName'];
  const backup: Record<string, unknown> = {};

  for (const k of savedKeys) backup[k] = g[k];

  afterEach(() => {
    for (const k of savedKeys) {
      if (backup[k] === undefined) delete g[k];
      else g[k] = backup[k];
    }
    vi.restoreAllMocks();
  });

  it('在 getCurrentMessageId 调用会抛错的全局脚本环境下，通过 getLastMessageId 向前定位最新有效楼层并成功导出', async () => {
    g.getCurrentMessageId = () => {
      throw new Error('不要对全局脚本 iframe 调用 getMessageId');
    };
    g.getLastMessageId = () => 5;
    g.getChatMessages = (id: number) => {
      if (id === 5) return [{ role: 'user', is_hidden: false }];
      if (id === 4) return [{ role: 'assistant', is_hidden: false }];
      return [];
    };
    g.getVariables = ({ message_id }: { type: string; message_id?: number }) => {
      if (message_id === 4) {
        return { stat_data: { schema_version: 2, economy: { credits: 2500 } } };
      }
      return {};
    };
    g.getCurrentChatName = () => '盟军前线战区';

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });

    const panel = setupPanelExportSave();
    await panel.doExportSave();

    expect(panel.expErr.value).toBe('');
    expect(panel.expMsg.value).toContain('✓ 已复制存档');
    expect(panel.expMsg.value).toContain('楼 #4');
    expect(writeText).toHaveBeenCalledTimes(1);

    const exported = JSON.parse(writeText.mock.calls[0][0] as string);
    expect(exported).toMatchObject({
      version: 2,
      kind: 'redalert-save',
      source: { chat: '盟军前线战区', message_id: 4 },
      stat_data: { schema_version: 2, economy: { credits: 2500 } },
    });
  });

  it('在无 getCurrentMessageId 仅有 getLastMessageId 的环境下同样成功导出最新楼层存档', async () => {
    delete g.getCurrentMessageId;
    g.getLastMessageId = () => 2;
    g.getVariables = ({ message_id }: { type: string; message_id?: number }) =>
      message_id === 2 ? { stat_data: { economy: { credits: 800 } } } : {};

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText } },
      configurable: true,
      writable: true,
    });

    const panel = setupPanelExportSave();
    await panel.doExportSave();

    expect(panel.expErr.value).toBe('');
    expect(panel.expMsg.value).toContain('楼 #2');
    const exported = JSON.parse(writeText.mock.calls[0][0] as string);
    expect(exported.source.message_id).toBe(2);
    expect(exported.stat_data).toEqual({ economy: { credits: 800 } });
  });
});

describe('UX-ADV-01 · systemCheck R26 存量与复产误报收敛（05 [P2-2]）', () => {
  it('无 prevTroops 基线时，严禁把既有兵种存量误判为未授权直写增量', () => {
    const issues = checkAssetQueueCross({
      queues: [
        { type: '生产', item: '美国大兵', base: 'b1', status: 'active' },
        { type: '生产', item: '防空步兵', base: 'b1', status: 'queued' },
      ],
      techDone: [],
      troops: { 美国大兵: 10, 防空步兵: 4 },
      bases: [{ id: 'b1', name: '主基地', buildings: [{ name: '兵营', state: '运转' }] }],
    });
    expect(issues).toEqual([]);
  });

  it('有 prevTroops 基线且本楼对同兵种合法复产（无增量、减员或有 done 队列授权）时，不误报 R26', () => {
    // 1. 存量持平或战损减员，同时在产新批次
    const noIncrement = checkAssetQueueCross({
      queues: [
        { type: '生产', item: '美国大兵', base: 'b1', status: 'active' },
        { type: '生产', item: '防空步兵', base: 'b1', status: 'queued' },
      ],
      techDone: [],
      prevTroops: { 美国大兵: 10, 防空步兵: 4 },
      troops: { 美国大兵: 10, 防空步兵: 2 },
      bases: [{ id: 'b1', name: '主基地', buildings: [] }],
    });
    expect(noIncrement).toEqual([]);

    // 2. 本楼有正增量，但存在同兵种已完结（done）队列授权，后续批次继续排队/在产
    const authorizedIncrement = checkAssetQueueCross({
      queues: [
        { type: '生产', item: '美国大兵', base: 'b1', status: 'done' },
        { type: '生产', item: '美国大兵', base: 'b1', status: 'active' },
      ],
      techDone: [],
      prevTroops: { 美国大兵: 10 },
      troops: { 美国大兵: 15 },
      bases: [{ id: 'b1', name: '主基地', buildings: [] }],
    });
    expect(authorizedIncrement).toEqual([]);
  });

  it('有 prevTroops 基线且本楼发生未授权正增量（currCount > prevCount 且无 done 记录）时，准确触发 R26 告警', () => {
    const issues = checkAssetQueueCross({
      queues: [{ type: '生产', item: '美国大兵', base: 'b1', status: 'active' }],
      techDone: [],
      prevTroops: { 美国大兵: 10 },
      troops: { 美国大兵: 15 },
      bases: [{ id: 'b1', name: '主基地', buildings: [] }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      rule: 'R26',
      level: 'warn',
      target: '队列[美国大兵]',
    });
    expect(issues[0].message).toContain('部队在账');
  });
});
