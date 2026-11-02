/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { Schema } from '../../红警指挥系统/core/schema';
import { readBootFrom } from '../boot';
import { packToChoices, parseSavePack } from '../importSave';
import {
  buildStatData,
  composeLaunchMessage,
  createImportTakeoverSteps,
  createLaunchSteps,
  createMockHostAdapter,
  runLaunchPipeline,
} from '../pipeline';
import {
  defaultRecommendedChoices,
  FALLBACK_T1_TECH_NAMES,
  HUMAN_COMPANION_PRESETS,
  IMPORT_SAVE_MODES,
  OPENING_ENTRY_MODES,
  OPENING_SYSTEM_LINK_MODES,
  resolveSystemLinkMode,
  syncAdjutantsFromHumanRoster,
} from '../presets';

const DIR = join(__dirname, '..');
const APP_SFC = readFileSync(join(DIR, 'App.vue'), 'utf8');
const GLOBAL_CSS = readFileSync(join(DIR, 'global.css'), 'utf8');
const STEP0_SFC = readFileSync(join(DIR, 'steps/Step0World.vue'), 'utf8');
const STEP1_SFC = readFileSync(join(DIR, 'steps/Step1Identity.vue'), 'utf8');
const STEP2_SFC = readFileSync(join(DIR, 'steps/Step2Resources.vue'), 'utf8');
const STEP3_SFC = readFileSync(join(DIR, 'steps/Step3Commander.vue'), 'utf8');
const STEP4_SFC = readFileSync(join(DIR, 'steps/Step4Launch.vue'), 'utf8');

describe('开场启动器 V2 生产级战术 HUD 契约校验', () => {
  it('global.css 接入 --rac-* 三阵营动态语义令牌与 prefers-reduced-motion 降级', () => {
    expect(GLOBAL_CSS).toContain('--rac-bg');
    expect(GLOBAL_CSS).toContain('--rac-accent');
    expect(GLOBAL_CSS).toContain("#app[data-theme='soviet']");
    expect(GLOBAL_CSS).toContain("#app[data-theme='yuri']");
    expect(GLOBAL_CSS).toContain('prefers-reduced-motion: reduce');
  });

  it('App.vue 默认采用 defaultRecommendedChoices（cyber2077 · 2042 恶土深处），提供前置导入抽屉、双栏实时遥测与生产级档案铭牌', () => {
    expect(APP_SFC).toContain('defaultRecommendedChoices()');
    expect(APP_SFC).toContain('data-testid="top-import-toggle"');
    expect(APP_SFC).toContain('data-testid="mission-dossier-card"');
    expect(APP_SFC).toContain('data-testid="maintenance-toggle"');
    expect(APP_SFC).toContain('telemetry-aside');
    // 已开局主视图不再裸露开发态 "$boot" 标题文案，且不含禁用机器词
    expect(APP_SFC).not.toContain('开局快照（$boot）');
    expect(APP_SFC).not.toContain('重置开局状态（调试用）');
    expect(APP_SFC).not.toContain('通用底座');
    expect(APP_SFC).not.toContain('SavePack V1');
    expect(APP_SFC).not.toContain("kind='redalert-save'");
  });

  it('FALLBACK_T1_TECH_NAMES 提供非空静态 T1 科技兜底，且 packToChoices 支持多阵营与副官存档回填', () => {
    expect(FALLBACK_T1_TECH_NAMES.length).toBeGreaterThan(0);
    expect(FALLBACK_T1_TECH_NAMES).toContain('化石燃料发电学');

    const stat = Schema.parse({
      meta: { world_id: 'cyber2077', date: '2042-06-15' },
      command: {
        unlocked_factions: ['allied', 'soviet'],
        adjutants: [
          {
            id: 'adj_soviet_human',
            role: 'faction',
            faction: 'soviet',
            identity: 'human',
            name: '瓦列里',
            title: '重工督造',
            buff_preset: 'heavy_industry_drive',
            upkeep_daily: 80,
            status: 'active',
            note: '',
          },
          {
            id: 'adj_staff_initial',
            role: 'staff',
            faction: '',
            identity: 'human',
            name: '林参谋',
            title: '精算主任',
            buff_preset: 'logistics_actuary',
            upkeep_daily: 80,
            status: 'active',
            note: '',
          },
        ],
      },
    });
    const parsed = parseSavePack(
      JSON.stringify({
        version: 2,
        kind: 'redalert-save',
        exportedAt: '2026-10-19T00:00:00.000Z',
        source: { chat: '跨战局测试', message_id: 5 },
        stat_data: stat,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const { choices: next } = packToChoices(parsed.pack, defaultRecommendedChoices());
    expect(next.selectedFactions).toEqual(['allied', 'soviet']);
    expect(next.factionId).toBe('allied');
    expect(next.factionAdjutants?.soviet).toMatchObject({
      identity: 'human',
      name: '瓦列里',
      title: '重工督造',
      buffPreset: 'heavy_industry_drive',
    });
    expect(next.staffAdjutant).toMatchObject({
      enabled: true,
      name: '林参谋',
      title: '精算主任',
      buffPreset: 'logistics_actuary',
    });
  });

  it('Step0~Step4 完整承载具象世界分层、全球战区筛选、自定义部署点、四档纪年预设、T1 科技检索与首楼报文预览', () => {
    expect(STEP0_SFC).toContain('CONCRETE WORLDS');
    expect(STEP0_SFC).toContain('concreteWorlds');
    expect(STEP0_SFC).toContain('world-dossier-box');
    expect(STEP1_SFC).toContain('data-testid="multi-faction-warning"');
    expect(STEP1_SFC).toContain('data-testid="custom-location-panel"');
    expect(STEP1_SFC).toContain('loc-master-detail');
    expect(STEP1_SFC).toContain('subview-bar');
    expect(STEP1_SFC).toContain('eraPresets');
    expect(STEP2_SFC).toContain('techQuery');
    expect(STEP3_SFC).toContain('data-testid="human-roster-section"');
    expect(STEP3_SFC).toContain('HUMAN_COMPANION_PRESETS');
    expect(STEP3_SFC).toContain('adj-identity-grid');
    expect(STEP3_SFC).toContain('seat-tab-bar');
    expect(STEP3_SFC).toContain('adapter.personaNames()');
    expect(STEP3_SFC).not.toContain('adapter.personas()');
    expect(STEP4_SFC).toContain('data-testid="toggle-message-preview"');
    expect(STEP4_SFC).toContain('data-testid="launch-message-preview"');
  });

  it('Step3 先确认随行己方人类立体人物档案（humanRoster）再点将任命副官/参谋，并同步落盘 codex 人员档案与开场报文【随行己方人物档案】', () => {
    expect(HUMAN_COMPANION_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(STEP3_SFC).toContain('data-testid="human-dossier-editor"');
    expect(STEP3_SFC).toContain('HUMAN_ORIGIN_OPTIONS');
    const choices = defaultRecommendedChoices();
    choices.humanRoster = [
      {
        id: 'h1',
        name: '艾琳·温特斯',
        callsign: '夜枭',
        title: '战地战术情报官',
        faction: 'allied',
        origin: 'hq_special_envoy',
        appearance: '浅金短发配单侧战术降噪耳机，身穿深色潜行夹克。',
        personality: '敏锐机警且带着几分黑色幽默，反侦察红线上寸步不让。',
        buffPreset: 'counter_intel_veil',
        bio: '前特种电子战大队首席情报分析官',
        assignment: 'faction:allied',
      },
      {
        id: 'h2',
        name: '顾清弦（林参谋）',
        callsign: '冷面算盘',
        title: '战区后勤精算主任',
        faction: 'common',
        origin: 'veteran_retinue',
        appearance: '银丝半框眼镜，笔挺深灰参谋制服。',
        personality: '表面冷静毒舌，实则极度护短。',
        buffPreset: 'logistics_actuary',
        bio: '原总参后勤精算师',
        assignment: '',
      },
    ];
    syncAdjutantsFromHumanRoster(choices);
    expect(choices.factionAdjutants?.allied).toMatchObject({
      identity: 'human',
      name: '艾琳·温特斯',
      title: '战地战术情报官',
      buffPreset: 'counter_intel_veil',
    });

    const stat = buildStatData(choices);
    const eileenCodex = stat.codex.find(c => c.name === '艾琳·温特斯' && c.kind === '人员');
    const linCodex = stat.codex.find(c => c.name === '顾清弦（林参谋）' && c.kind === '人员');
    expect(eileenCodex).toBeDefined();
    expect(eileenCodex?.params['代号']).toBe('夜枭');
    expect(eileenCodex?.params['随行渊源']).toBe('统帅部特派专员');
    expect(eileenCodex?.params['外貌着装']).toContain('浅金短发');
    expect(eileenCodex?.params['性格与口吻']).toContain('黑色幽默');
    expect(linCodex).toBeDefined();

    const msg = composeLaunchMessage(choices);
    expect(msg).toContain('战地战术情报官「艾琳·温特斯」');
    expect(msg).toContain('随行战区后勤精算主任「顾清弦（林参谋）」');
    expect(msg).toContain('【随行己方人物档案】');
    expect(msg).toContain('艾琳·温特斯（代号「夜枭」）');
    expect(msg).toContain('外貌着装：浅金短发');
    expect(msg).toContain('性格与说话风格：敏锐机警');
  });

  it('端到端发射管线：以默认推荐具象世界（cyber2077 · 2042 · 恶土深处）跑通五工序落盘', async () => {
    const adapter = createMockHostAdapter(0);
    const choices = defaultRecommendedChoices();
    const progress = await runLaunchPipeline(createLaunchSteps(), { adapter, choices });
    expect(progress.filter(p => p.status !== 'running').map(p => [p.name, p.status])).toEqual([
      ['validateWorld', 'done'],
      ['bindWorldBooks', 'done'],
      ['applyPersona', 'skipped'],
      ['writeStatData', 'done'],
      ['markBoot', 'done'],
      ['composeAndSend', 'done'],
    ]);

    const boot = readBootFrom(adapter.getChatVars());
    expect(boot.confirmed).toBe(true);
    expect(boot.choices).toMatchObject({
      worldId: 'cyber2077',
      locationId: 'badlands_deep',
      eraPresetId: '2042',
      date: '2042-06-15',
    });
    expect(adapter.globalBooks).toContain('具象世界·赛博朋克2077');
    expect(adapter.globalBooks).not.toContain('修真·世界适配');
    expect(adapter.globalBooks).not.toContain('赛博朋克2042·世界适配');
    expect(adapter.sentMessages[0]).toContain('【战地初抵序幕】');
    expect(adapter.sentMessages[0]).toContain('盟军 MCV 核心机娘「白凌」');
    expect(adapter.sentMessages[0]).toContain('具象世界·赛博朋克2077');
    expect(adapter.sentMessages[0]).toContain('【时代态势锚点·2042血色拓荒期】');
    expect(adapter.sentMessages[0]).toContain('【首幕推演与现场请示】');
    // 彻底杜绝 dev 管线黑话
    expect(adapter.sentMessages[0]).not.toContain('世界书各条目');
    expect(adapter.sentMessages[0]).not.toContain('主轨生效');
    expect(adapter.sentMessages[0]).not.toContain('建筑列表为空');
  });

  it('Stage I · 支持三种开场切入模式（战地直降 / 原世界序章 / 异世潜行）与跨帧状态广播 ra-boot-state-changed', () => {
    expect(OPENING_ENTRY_MODES.map(m => m.id)).toEqual(['field_drop', 'pre_transmigration', 'dormant_infiltration']);
    expect(STEP4_SFC).toContain('data-testid="entry-mode-grid"');
    expect(STEP4_SFC).toContain(':data-entry-mode="m.id"');
    expect(STEP4_SFC).toContain("emit('launched')");
    expect(APP_SFC).toContain("type: 'ra-boot-state-changed'");

    const msgFieldDrop = composeLaunchMessage({ ...defaultRecommendedChoices(), entryMode: 'field_drop' });
    expect(msgFieldDrop).toContain('【战地初抵序幕】');
    expect(msgFieldDrop).toContain('- 初始基地状态：无在役基地（MCV 未展开前禁止预设基地）');
    expect(msgFieldDrop).toContain('本轮 <战况> 中严禁输出 基地: 字段');
    expect(msgFieldDrop).toContain('- 系统与机娘通联：由指挥官亲自联系（默认）');

    const msgPrologue = composeLaunchMessage({ ...defaultRecommendedChoices(), entryMode: 'pre_transmigration' });
    expect(msgPrologue).toContain('【穿越前夕·位面帷幕裂变】');
    expect(msgPrologue).toContain('当前位置仍处于原世界（跨界穿越尚未启动');
    expect(msgPrologue).toContain('【远端信标遥测·待跨界目标战区预演】');
    expect(msgPrologue).toContain('严禁进入穿越通道穿梭过程');
    expect(msgPrologue).toContain('玩家节奏主权（最高优先级）');
    expect(msgPrologue).toContain('- 系统与机娘通联：穿越/契机后才绑定系统（序章默认）');
    expect(msgPrologue).toContain('严禁提前觉醒系统或通联机娘');
    expect(msgPrologue).toContain('- 初始基地状态：无在役基地（MCV 未展开前禁止预设基地）');

    const msgStealth = composeLaunchMessage({ ...defaultRecommendedChoices(), entryMode: 'dormant_infiltration' });
    expect(msgStealth).toContain('【潜行唤醒·统帅链路并网】');
    expect(msgStealth).toContain('- 系统与机娘通联：由指挥官亲自联系（默认）');
    expect(msgStealth).toContain('- 初始基地状态：无在役基地（MCV 未展开前禁止预设基地）');

    expect(OPENING_SYSTEM_LINK_MODES.map(s => s.id)).toEqual([
      'commander_initiate',
      'post_transmigration_bind',
      'immediate_active',
    ]);
    expect(STEP4_SFC).toContain('data-testid="system-link-mode-grid"');
    expect(resolveSystemLinkMode({ entryMode: 'field_drop' })).toBe('commander_initiate');
    expect(resolveSystemLinkMode({ entryMode: 'pre_transmigration' })).toBe('post_transmigration_bind');
    expect(
      resolveSystemLinkMode({ entryMode: 'pre_transmigration', systemLinkMode: 'commander_initiate' }),
    ).toBe('commander_initiate');
  });

  it('FD-53 · App.vue 与 Step4Launch.vue 接线跨战局导入双模式切换（continuation / new_game_plus）与免发消息首楼直接接管通道', async () => {
    expect(IMPORT_SAVE_MODES.map(m => m.id)).toEqual(['continuation', 'new_game_plus']);
    expect(APP_SFC).toContain('data-testid="import-mode-switch"');
    expect(APP_SFC).toContain('import-mode-continuation');
    expect(APP_SFC).toContain('import-mode-new-game-plus');
    expect(APP_SFC).toContain('data-testid="top-import-takeover-btn"');
    expect(APP_SFC).toContain('createImportTakeoverSteps');
    expect(APP_SFC).toContain('takeoverZeroFloorFromTopDrawer');
    expect(APP_SFC).toContain('0 座（二周目重开）');

    expect(STEP4_SFC).toContain('data-testid="step4-import-mode-switch"');
    expect(STEP4_SFC).toContain('data-testid="step4-takeover-only-btn"');
    expect(STEP4_SFC).toContain('createImportTakeoverSteps');
    expect(STEP4_SFC).toContain('launchTakeoverOnly');
    expect(STEP4_SFC).toContain('发射战局接力简报 · 继续战役');

    const importedStat = Schema.parse({
      meta: { world_id: 'cyber2077', date: '2042-09-01', location: '恶土深处·干涸盐湖' },
      economy: { credits: 5600, power: { gen: 200, use: 120 } },
      tech: { done: ['化石燃料发电学', '矿石精炼学'] },
      command: { unlocked_factions: ['allied', 'soviet'] },
      bases: [
        {
          id: 'badlands_deep',
          name: '恶土深处前哨基地',
          location: '恶土深处·干涸盐湖',
          status: '运转中',
          buildings: [
            { name: '建造厂', count: 1, state: '运转' },
            { name: '矿石精炼厂', count: 2, state: '运转' },
          ],
        },
      ],
      forces: {
        infantry: ['盟军步兵班×2'],
        vehicles: ['采矿车×2'],
        aircraft: [],
        navy: [],
        girls: [
          { name: '白凌', duty: '工程总管', hp: '完好', base: '恶土深处前哨基地' },
          { name: '喀秋莎', duty: '重工督造', hp: '完好', base: '恶土深处前哨基地' },
        ],
      },
      codex: [
        {
          name: '自定义战术义体·神经加速器',
          kind: '科技',
          desc: '旧战局自研黑客义体模块',
          params: { 世代: 'T2' },
        },
      ],
    });

    const parsed = parseSavePack(
      JSON.stringify({
        version: 2,
        kind: 'redalert-save',
        exportedAt: '2026-10-31T00:00:00.000Z',
        source: { chat: '旧战局·恶土防线', message_id: 18 },
        stat_data: importedStat,
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const { choices } = packToChoices(parsed.pack, defaultRecommendedChoices());
    expect(choices.importMode).toBe('continuation');

    // 1) continuation 模式：保留基地与建筑，跳过多阵营开局二次打折，生成【跨战局接力·战区态势交接简报】
    const statCont = buildStatData(choices);
    expect(statCont.bases).toHaveLength(1);
    expect(statCont.bases[0]?.buildings).toHaveLength(2);
    expect(statCont.economy.credits).toBe(5600);
    const msgCont = composeLaunchMessage(choices);
    expect(msgCont).toContain('【跨战局接力·战区态势交接简报】');
    expect(msgCont).toContain('恶土深处前哨基地');
    expect(msgCont).not.toContain('无在役基地（MCV 未展开前禁止预设基地）');

    // 2) new_game_plus 模式：基地归零，继承图鉴、科技与机娘名录（base 重置为空），简报回归初抵开荒
    choices.importMode = 'new_game_plus';
    const statNgp = buildStatData(choices);
    expect(statNgp.bases).toHaveLength(0);
    expect(statNgp.tech.done).toEqual(expect.arrayContaining(['化石燃料发电学', '矿石精炼学']));
    expect(statNgp.codex.some(c => c.name === '自定义战术义体·神经加速器')).toBe(true);
    const katyusha = statNgp.forces.girls.find(g => g.name === '喀秋莎');
    expect(katyusha).toBeDefined();
    expect(katyusha?.base).toBe('');
    const msgNgp = composeLaunchMessage(choices);
    expect(msgNgp).toContain('【战地初抵序幕】');
    expect(msgNgp).toContain('- 初始基地状态：无在役基地（MCV 未展开前禁止预设基地）');

    // 3) createImportTakeoverSteps：免发消息直接落盘接管 #0 楼
    choices.importMode = 'continuation';
    const adapter = createMockHostAdapter(0);
    const takeoverProgress = await runLaunchPipeline(createImportTakeoverSteps(), {
      adapter,
      choices,
      importedPack: parsed.pack,
    });
    expect(takeoverProgress.filter(p => p.status !== 'running').map(p => [p.name, p.status])).toEqual([
      ['validateWorld', 'done'],
      ['bindWorldBooks', 'done'],
      ['applyPersona', 'skipped'],
      ['writeStatData', 'done'],
      ['markBoot', 'done'],
    ]);
    expect(adapter.sentMessages).toHaveLength(0);
    expect(adapter.generateCount).toBe(0);
    const bootAfterTakeover = readBootFrom(adapter.getChatVars());
    expect(bootAfterTakeover.confirmed).toBe(true);
    const writtenStat = adapter.getStatData() as Schema;
    expect(writtenStat.bases).toHaveLength(1);
    expect(writtenStat.economy.credits).toBe(5600);
  });
});
