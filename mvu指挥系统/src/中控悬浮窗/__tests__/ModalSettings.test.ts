/**
 * ModalSettings.test.ts —— FIX-SUM-01：剧情摘要面板迁入 ModalSettings 与中控楼层变量写回 / 真实隐藏态同步契约
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const SUMMARIES_SFC = readFileSync(join(DIR, '..', '红警指挥系统', 'ui', 'panels', 'PanelSummaries.vue'), 'utf8');
const PATCHES_SFC = readFileSync(join(DIR, 'panels/PanelDataPatches.vue'), 'utf8');

describe('FIX-SUM-01 · ModalSettings 挂载 PanelSummaries（「剧情摘要」页签）', () => {
  it('groups 声明 summaries（「剧情摘要」）组，并通过 #panel-summaries slot 挂载 PanelSummaries', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(
      /import\s+PanelSummaries\s+from\s+['"](?:\.\.\/)?\.\.\/红警指挥系统\/ui\/panels\/PanelSummaries\.vue['"]/,
    );
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'summaries',\s*label:\s*'剧情摘要'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-summaries[\s\S]*?<PanelSummaries\s*\/>/);
  });
});

describe('FIX-SUM-01 · PanelSummaries 接入 updateFloorVars 与真实 is_hidden 同步契约', () => {
  it('引入 useFloatingStore 与 updateFloorVars，并通过 syncPendingSummariesToFloor 写回楼层 stat_data.pending_summaries 并刷新 floating', () => {
    expect(SUMMARIES_SFC).toMatch(/import\s*\{\s*useFloatingStore\s*\}\s*from\s*['"]\.\.\/\.\.\/composables\/useFloatingStore['"]/);
    expect(SUMMARIES_SFC).toMatch(
      /import\s*\{\s*updateFloorVars\s*\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/中控悬浮窗\/(?:host\/)?floorVarWrite['"]/,
    );
    expect(SUMMARIES_SFC).toMatch(/async\s+function\s+syncPendingSummariesToFloor\(\)/);
    expect(SUMMARIES_SFC).toMatch(/await\s+updateFloorVars\(floating\.floorId/);
    expect(SUMMARIES_SFC).toMatch(/await\s+floating\.refresh\(\)/);
    // 采纳、重生成、弃置暂存、生成下一段及自动预生成均触发 syncPendingSummariesToFloor
    expect(SUMMARIES_SFC.match(/await\s+syncPendingSummariesToFloor\(\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('refreshRanges 通过 getChatMessages 核验各区间真实 is_hidden 状态并同步 hiddenRangesSet', () => {
    expect(SUMMARIES_SFC).toMatch(/tav<[\s\S]*?>\(['"]getChatMessages['"]\)/);
    expect(SUMMARIES_SFC).toMatch(/msgs\.some\(m\s*=>\s*m\.is_hidden\s*===\s*true\)/);
    expect(SUMMARIES_SFC).toMatch(/hiddenRangesSet\.value\s*=\s*nextHidden/);
  });
});

describe('D-BLD-01 · ModalSettings 挂载 PanelDataPatches（「改造 / 热更补丁」分组）', () => {
  it('groups 声明 patches（「改造 / 热更补丁」）组与动态 badge，并通过 #panel-patches slot 内嵌挂载 PanelDataPatches', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import\s+PanelDataPatches\s+from\s+['"](?:\.\.|\.)(?:\/panels)?\/PanelDataPatches\.vue['"]/);
    expect(MODAL_SETTINGS_SFC).toMatch(
      /import\s*\{\s*useFloatingStore\s*\}\s*from\s*['"](?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useFloatingStore['"]/,
    );
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'patches',\s*\n?\s*label:\s*'改造 \/ 热更补丁'/);
    expect(MODAL_SETTINGS_SFC).toMatch(
      /badge:\s*pendingPatchesCount\.value\s*>\s*0\s*\?\s*String\(pendingPatchesCount\.value\)\s*:\s*undefined/,
    );
    expect(MODAL_SETTINGS_SFC).toMatch(
      /#panel-patches[\s\S]*?<PanelDataPatches\s+:embedded="true"\s+:snapshot="floating\.snapshot"\s*\/>/,
    );
  });

  it('PanelDataPatches 支持 embedded prop 内嵌渲染并隐藏独立弹窗关闭按钮', () => {
    expect(PATCHES_SFC).toMatch(/embedded\?:\s*boolean/);
    expect(PATCHES_SFC).toMatch(/v-if="embedded \|\| open"/);
    expect(PATCHES_SFC).toMatch(/ra-patches-embedded[^\n]*min-h-\[420px\][^\n]*max-h-\[68vh\]/);
    expect(PATCHES_SFC).toMatch(/v-if="!embedded"/);
  });
});

describe('DEV-SANDBOX-01 · ModalSettings 挂载 PanelDebugSandbox（「调试沙盒」分组）与 useDebugMode 纯函数验证', () => {
  it('groups 声明 debug（「调试沙盒」）组并通过 #panel-debug slot 挂载 PanelDebugSandbox', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(/import\s+PanelDebugSandbox\s+from\s+['"]\.\.\/panels\/PanelDebugSandbox\.vue['"]/);
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'debug',\s*\n?\s*label:\s*'调试沙盒'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-debug[\s\S]*?<PanelDebugSandbox\s*\/>/);
  });

  it('useDebugMode 纯函数支持资金/六柱资源/阵营启封/母体建筑铺设/科技解锁/测试兵力注入与快照还原', async () => {
    const {
      cloneValidStatData,
      debugApplyBuildingPreset,
      debugFillAllResourcesAndPoints,
      debugInjectTestForces,
      debugMutateCredits,
      debugSettleOrClearQueues,
      debugUnlockFactions,
      debugUnlockResearches,
    } = await import('../../红警指挥系统/composables/useDebugMode');

    let state = cloneValidStatData({});
    state = debugMutateCredits(state, 'add10k');
    expect(state.economy.credits).toBe(10000);

    state = debugFillAllResourcesAndPoints(state, 5000);
    expect(state.economy.resources.nanites['工业纳米机械']).toBe(5000);
    expect(state.protocol_points).toBeGreaterThanOrEqual(500);

    state = debugUnlockFactions(state, ['soviet', 'yuri']);
    expect(state.command.unlocked_factions).toEqual(expect.arrayContaining(['allied', 'soviet', 'yuri']));

    state = debugApplyBuildingPreset(state, 0, 'allied_full_core');
    expect(state.bases[0]?.buildings.map(b => b.name)).toEqual(
      expect.arrayContaining(['盟军建造厂', '盟军发电厂', '盟军兵营', '盟军战车工厂', '空军指挥部']),
    );

    state = debugApplyBuildingPreset(state, 0, 'spawn_second_base_soviet');
    expect(state.bases.some(b => b.name === '北方红星分基地')).toBe(true);

    state = debugUnlockResearches(
      state,
      [
        { name: '个人装备工程学', tier: 1 },
        { name: '航空工学基础', tier: 1 },
        { name: '制空权学说', tier: 2 },
      ],
      1,
    );
    expect(state.tech.done).toEqual(expect.arrayContaining(['个人装备工程学', '航空工学基础']));
    expect(state.tech.done).not.toContain('制空权学说');

    state = debugInjectTestForces(state);
    expect(state.forces.vehicles).toContain('F-16C战隼多用途战斗机');
    expect(state.forces.troops['美国大兵']).toBeGreaterThanOrEqual(6);

    state.queues.push({
      type: '研究',
      item: '制空权学说',
      base: '前沿第一基地',
      qty: 1,
      qty_done: 0,
      progress: 30,
      eta: '4h',
      total_minutes: 240,
      spent_minutes: 60,
      started_at: '',
      lane_key: 'research:aerospace',
      slot_id: 'slot_1',
      status: 'active',
      hold: false,
      note: '',
    });
    state = debugSettleOrClearQueues(state, 'complete_all');
    expect(state.tech.done).toContain('制空权学说');
    expect(state.queues[0]?.status).toBe('done');
  });

  it('ModalSettings 环境面板提供「楼层协议标签兼容修补」可选开关（data-test="toggle-floor-tag-repair"），默认关闭', async () => {
    expect(MODAL_SETTINGS_SFC).toContain('data-test="toggle-floor-tag-repair"');
    expect(MODAL_SETTINGS_SFC).toContain('getFloorTagRepairEnabled');
    expect(MODAL_SETTINGS_SFC).toContain('setFloorTagRepairEnabled');
    const { getFloorTagRepairEnabled, setFloorTagRepairEnabled } = await import('../cards/floorCardHydrator');
    expect(getFloorTagRepairEnabled()).toBe(false);
    setFloorTagRepairEnabled(true);
    expect(getFloorTagRepairEnabled()).toBe(true);
    setFloorTagRepairEnabled(false);
    expect(getFloorTagRepairEnabled()).toBe(false);
  });
});

describe('FD-49 PKG-A · ModalSettings 消除 PanelWorldEvolution 重复堆叠', () => {
  it('#panel-feedforward-policy 仅渲染 PanelFeedforwardSettings page="policy"，不再重复堆叠 PanelWorldEvolution', () => {
    const policySlot =
      MODAL_SETTINGS_SFC.match(/<template #panel-feedforward-policy>([\s\S]*?)<\/template>/)?.[1] ?? '';
    expect(policySlot).toMatch(/<PanelFeedforwardSettings\s+page="policy"\s*\/>/);
    expect(policySlot).not.toContain('PanelWorldEvolution');
    expect(MODAL_SETTINGS_SFC).not.toMatch(/#panel-feedforward-policy[\s\S]*?<PanelWorldEvolution[\s\S]*?<\/template>/);
  });

  it('feedforward.pages 收敛为 policy / preview / summaries 三子页，世界演变由独立 world-evo 组承载', () => {
    const ffGroupMatch = MODAL_SETTINGS_SFC.match(/key:\s*'feedforward'[\s\S]*?pages:\s*\[([\s\S]*?)\]/);
    expect(ffGroupMatch).not.toBeNull();
    const ffPages = ffGroupMatch![1];
    expect(ffPages).toContain("key: 'policy'");
    expect(ffPages).toContain("key: 'preview'");
    expect(ffPages).toContain("key: 'summaries'");
    expect(ffPages).not.toContain("key: 'active'");
    expect(ffPages).not.toContain("key: 'archived'");
    expect(MODAL_SETTINGS_SFC).toContain("key: 'world-evo'");
  });
});



