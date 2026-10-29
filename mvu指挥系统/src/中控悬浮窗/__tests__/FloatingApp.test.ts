/**
 * FloatingApp 红警经典建造控制台只读契约（第二阶段重构）：
 * 控制台彻底重构为经典红警左侧控制台，严格只读查阅，不挂任何写操作。
 * 静态契约检查：
 * 1. 六大红警核心 UI 结构完整性（顶层双键/当前基地监视屏/快捷双键/五大基建页签与二级载具栏/双三角翻页建造网格/左侧能量柱）；
 * 2. 弹窗套件（科技树/白凌机娘/档案快照/控制台设置/DetailDrawer）；
 * 3. 禁止引用 PanelBase / PanelQuests / ActionBar / PanelIntel / send；
 * 4. 移动端 body min-width 覆盖；
 * 5. 目录内 0 命中消息 / 世界书 / 变量写入 API。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { BUILD_PANEL_GROUPS, PRODUCTION_SUBS } from '../models/tagTaxonomy';

const FLOATING_DIR = join(__dirname, '..');
const SFC = readFileSync(join(FLOATING_DIR, 'console/FloatingApp.vue'), 'utf8');
const BUILD_GRID_SFC = readFileSync(join(FLOATING_DIR, 'console/ConsoleBuildGrid.vue'), 'utf8');
const POWER_BAR_SFC = readFileSync(join(FLOATING_DIR, 'console/ConsolePowerBar.vue'), 'utf8');
const RADAR_SCREEN_SFC = readFileSync(join(FLOATING_DIR, 'console/ConsoleRadarScreen.vue'), 'utf8');
const QUICK_ACTIONS_SFC = readFileSync(join(FLOATING_DIR, 'console/ConsoleQuickActions.vue'), 'utf8');
const TOP_NAV_SFC = readFileSync(join(FLOATING_DIR, 'console/ConsoleTopNav.vue'), 'utf8');

function listSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__') continue;
      out.push(...listSources(full));
    } else if (/\.(ts|vue)$/.test(name) && !/\.test\.ts$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** 去掉块注释与行注释后的源码（既有注释里对写 API 的说明性提及不算命中） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('FloatingApp 红警经典建造控制台契约', () => {
  it('控制台由六大红警核心组件装配：能量柱/监视屏/快捷键/基建网格/顶栏/详情弹窗', () => {
    for (const name of [
      'ConsolePowerBar',
      'ConsoleRadarScreen',
      'ConsoleTopNav',
      'ConsoleQuickActions',
      'ConsoleBuildGrid',
      'DetailDrawer',
      'ModalTechTree',
      'ModalMechaGirl',
      'ModalArchive',
      'ModalSettings',
    ]) {
      expect(SFC).toMatch(new RegExp(`<${name}\\b`));
    }
  });

  it('五大基建页签（基建/工业/科研/防御/生产）与生产二级栏在 ConsoleBuildGrid 中严格定义（巨构已退役归工程系统）', () => {
    // 五大页签由 tagTaxonomy 的 BUILD_PANEL_GROUPS 单一事实源驱动
    expect(BUILD_PANEL_GROUPS.map(g => g.id)).toEqual(['基建', '工业', '科研', '防御', '生产']);
    expect(BUILD_GRID_SFC).toMatch(/BUILD_PANEL_GROUPS/);
    // 生产二级分类（人员/装备/陆/空/海军）由 tagTaxonomy.PRODUCTION_SUBS 单一事实源驱动，SFC 不复活字面量
    expect(PRODUCTION_SUBS).toEqual(['人员', '装备', '陆军', '空军', '海军']);
    expect(BUILD_GRID_SFC).toMatch(/PRODUCTION_SUBS/);
    expect(BUILD_GRID_SFC).not.toMatch(/const PRODUCTION_SUBS\s*=/);
    for (const sub of PRODUCTION_SUBS) {
      expect(BUILD_GRID_SFC).toContain(`'${sub}'`);
    }
  });

  it('底侧双三角翻页调度在 ConsoleBuildGrid 中完整实现（PREV / NEXT / ▲ / ▼）', () => {
    expect(BUILD_GRID_SFC).toMatch(/▲/);
    expect(BUILD_GRID_SFC).toMatch(/▼/);
    expect(BUILD_GRID_SFC).toMatch(/prevPage/);
    expect(BUILD_GRID_SFC).toMatch(/nextPage/);
    expect(BUILD_GRID_SFC).toMatch(/totalPages/);
  });

  it('左侧竖向能量柱 ConsolePowerBar 支持发电/耗电/净余与低电量 LOW 预警', () => {
    expect(POWER_BAR_SFC).toMatch(/isLowPower/);
    expect(POWER_BAR_SFC).toMatch(/ra-power-fill/);
    expect(POWER_BAR_SFC).toMatch(/ra-power-needle/);
    expect(POWER_BAR_SFC).toMatch(/LOW/);
  });

  it('当前基地监视屏 ConsoleRadarScreen 支持基地代号与状态显示（// 状态）与雷达点阵网格', () => {
    expect(RADAR_SCREEN_SFC).toMatch(/currentBase/);
    expect(RADAR_SCREEN_SFC).toMatch(/\/\/ /);
    expect(RADAR_SCREEN_SFC).toMatch(/ra-radar-grid|ra-radar-sweep/);
  });

  it('快捷双键 ConsoleQuickActions 支持科技（TECH）与机娘（MECHA/白凌）', () => {
    expect(QUICK_ACTIONS_SFC).toMatch(/科技/);
    expect(QUICK_ACTIONS_SFC).toMatch(/TECH/);
    expect(QUICK_ACTIONS_SFC).toMatch(/机娘/);
    expect(QUICK_ACTIONS_SFC).toMatch(/MECHA/);
  });

  it('顶侧双键 ConsoleTopNav 支持档案与设置', () => {
    expect(TOP_NAV_SFC).toMatch(/档案/);
    expect(TOP_NAV_SFC).toMatch(/设置/);
  });

  it('不引用楼层操作性组件：PanelBase / PanelQuests / ActionBar / PanelIntel / send', () => {
    for (const name of ['PanelBase', 'PanelQuests', 'ActionBar', 'PanelIntel', 'IntelRow']) {
      expect(SFC).not.toMatch(new RegExp(`^import\\s+${name}\\b`, 'm'));
      expect(SFC).not.toMatch(new RegExp(`<${name}\\b`));
    }
    expect(SFC).not.toMatch(/from '[^']*\/send'/);
    expect(SFC).not.toMatch(/sendAction/);
  });

  it('保留标题栏手柄（拖拽 / 刷新 / 收起-展开）、无数据横幅、useFloatingStore 与 catalog.init 屏障', () => {
    expect(SFC).toMatch(/@drag-start="onDragStart"/);
    expect(SFC).toMatch(/floating\.refresh/);
    expect(SFC).toMatch(/shell\.toggle/);
    expect(SFC).toMatch(/floating-banner/);
    expect(SFC).toMatch(/useFloatingStore\(\)/);
    expect(SFC).toMatch(/catalog\.init\(\);/);
    expect(SFC).toMatch(/v-if="catalog\.ready"/);
  });

  it('移动端：非 scoped 样式以 `html body { min-width: 0 }` 覆盖 global.css 的 `body { min-width: 280px }`', () => {
    expect(SFC).toMatch(/<style>/);
    expect(SFC).toMatch(/html body\s*\{[^}]*min-width:\s*0;?[^}]*\}/);
  });

  it('src/中控悬浮窗/** 非测试源码 0 命中消息 / 世界书 / 变量写入 API', () => {
    const files = listSources(FLOATING_DIR);
    expect(files.length).toBeGreaterThan(0);
    const banned =
      /createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|createWorldbookEntries|deleteWorldbookEntries|insertOrAssignVariables|replaceVariables|updateVariablesWith|deleteVariable/;
    // D-RAC-FLOAT-READONLY-01 修订（驾驶员 2026-09-24 授权·收口写入，CTRL-FLOOR-SLIM-01）：
    // 变量写入收口到单一文件 floorVarWrite.ts（限定写 floorId 楼的 pending_lore/pending_expansions/codex）；其余 API 与其余文件照旧全禁。
    const EXCEPTION_FILE = /[\\/]floorVarWrite\.ts$/;
    const SAVE_BACKUP_EXCEPTION_FILE = /[\\/]saveBackupService\.ts$/;
    const WORLDBOOK_GATEWAY_EXCEPTION_FILE =
      /[\\/](?:PdaWindowFrame|PanelWorldEvolution)\.vue$|[\\/]floorObservers\.ts$/;
    for (const file of files) {
      let text = stripComments(readFileSync(file, 'utf8'));
      if (EXCEPTION_FILE.test(file)) {
        // 仅 floorVarWrite.ts 内：tav 取函数名 + 缺失报错文案，共 2 处
        expect(text.match(/updateVariablesWith/g)?.length, file).toBe(2);
        text = text.replace(/updateVariablesWith/g, '');
      }
      if (SAVE_BACKUP_EXCEPTION_FILE.test(file)) {
        text = text.replace(
          /updateVariablesWith|insertOrAssignVariables|replaceVariables|createOrReplaceWorldbook|replaceWorldbook|updateWorldbookWith|createWorldbookEntries|createWorldbook/g,
          '',
        );
      }
      if (WORLDBOOK_GATEWAY_EXCEPTION_FILE.test(file)) {
        text = text.replace(/updateWorldbookWith/g, '');
      }
      expect(text, file).not.toMatch(banned);
      expect(text, file).not.toMatch(/from '[^']*\/send'/);
    }
  });

  it('PKG-B (B1): 全部重型弹窗具备外层 v-if 按需挂载门控，Teleport 移出折叠分支，且 TacticalPdaHost 透传 :snapshot', () => {
    for (const modalTag of [
      'ModalTechTree',
      'ModalMechaGirl',
      'ModalArchive',
      'ModalSchedule',
      'ModalResources',
      'ModalEngineering',
      'ModalBuildings',
      'PanelDataPatches',
      'ModalSettings',
    ]) {
      const reg = new RegExp(`<${modalTag}\\s+[^>]*v-if="activeModal ===`, 'g');
      expect(SFC.match(reg)?.length, `${modalTag} 应在 Teleport 与 fallback 两处均具备外层 v-if`).toBe(2);
    }

    // Teleport modalMountTarget 已移出 !shell.state.collapsed 分支
    const collapsedBlockStart = SFC.indexOf('<template v-if="!shell.state.collapsed">');
    const teleportModalPos = SFC.indexOf('<Teleport v-if="modalMountTarget" :to="modalMountTarget">');
    expect(collapsedBlockStart).toBeGreaterThan(-1);
    expect(teleportModalPos).toBeGreaterThan(collapsedBlockStart);
    const between = SFC.slice(collapsedBlockStart, teleportModalPos);
    expect(between).toContain('</template>\n    </template>');

    // TacticalPdaHost 接收 :snapshot="floating.snapshot"
    expect(SFC).toMatch(/<TacticalPdaHost[^>]*:snapshot="floating\.snapshot"/);

    // ConsoleRadarScreen 采用 Oblivion 点阵网格 (.ob-dotgrid / .ra-radar-grid)
    expect(RADAR_SCREEN_SFC).toMatch(/ob-dotgrid|@keyframes ra-sweep/s);

    // BUG-R2-13：handleAdoptPendingLore 不得无 write 重复调用 confirmAndCommitPendingLore
    expect(stripComments(SFC)).not.toMatch(/confirmAndCommitPendingLore/);
  });
});
