/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读写临时编译产物，不进 bundle */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import * as archiveIndexMod from '../models/archiveIndex';
import type { ArmoryDossierInput, ArmoryScope, ArmorySnapshotLike, ArmoryTabId } from '../models/armoryPanelModel';

vi.mock('../../红警指挥系统/ui/Icon.vue', async () => {
  const { h: hh } = await import('vue');
  return { default: { name: 'Icon', render: () => hh('span') } };
});

const SFC_PATH = join(__dirname, '../modals/ModalMechaGirl.vue');
// 临时模块取 .mts：FloatingApp.test.ts 扫描正则为 /\.(ts|vue)$/，.mts 不被误拾
const COMPILED_PATH = join(__dirname, '../modals/ModalMechaGirl.__ssr__.mts');

let componentPromise: Promise<Component> | undefined;

function loadComponent(): Promise<Component> {
  componentPromise ??= (async () => {
    const source = readFileSync(SFC_PATH, 'utf8');
    const { descriptor, errors } = parse(source, { filename: 'ModalMechaGirl.vue' });
    if (errors.length > 0) throw new Error(`ModalMechaGirl.vue 解析失败：${errors.map(String).join('; ')}`);
    const compiled = compileScript(descriptor, {
      id: 'modalmechagirlssr',
      inlineTemplate: true,
      templateOptions: { id: 'modalmechagirlssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = compiled.content.replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '');
    writeFileSync(COMPILED_PATH, js, 'utf8');
    const mod = (await import(pathToFileURL(COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return componentPromise;
}

afterAll(() => {
  try {
    unlinkSync(COMPILED_PATH);
  } catch {
    /* ignore */
  }
});

interface RenderOptions {
  open?: boolean;
  snapshot: ArmorySnapshotLike | null;
  initialScope?: ArmoryScope;
  initialTab?: ArmoryTabId;
  initialSelectedGirl?: string;
  dossierMapOverride?: Record<string, ArmoryDossierInput>;
}

async function renderArmoryModal(opts: RenderOptions): Promise<string> {
  const Comp = await loadComponent();
  return renderToString(
    createSSRApp({
      render: () =>
        h(Comp, {
          open: opts.open ?? true,
          snapshot: opts.snapshot,
          initialScope: opts.initialScope ?? 'ALL',
          initialTab: opts.initialTab ?? 'girls',
          initialSelectedGirl: opts.initialSelectedGirl ?? '',
          dossierMapOverride: opts.dossierMapOverride,
        }),
    }),
  );
}

function createFixtureSnapshot(): ArmorySnapshotLike {
  return {
    girls: [
      {
        name: '红叶',
        model: 'XT-09赤霄',
        affection: 82,
        obedience: 91,
        status: '完好',
        duty: '北坡前哨突击长',
        base: '一号基地',
        traits: ['赤霄斩舰', '高机动'],
      },
      {
        name: '凛冬',
        model: 'KV-2极寒',
        affection: 65,
        obedience: 89,
        status: '轻损',
        duty: '重装火力支援',
        base: '二号基地',
        traits: ['极寒护盾'],
        weapons: '极寒电磁重炮',
      },
    ],
    bases: {
      一号基地: {
        name: '一号基地',
        forces: {
          infantry: { 动员兵: 40, 战斗工程师: 8 },
          vehicles: ['天启坦克(正常)', '天启坦克(受损)'],
          aircraft: ['基洛夫空艇(正常)'],
          equipment: { 外骨骼装甲: 16 },
        },
      },
      二号基地: {
        name: '二号基地',
        forces: {
          infantry: { 动员兵: 20, 磁暴步兵: 10 },
          vehicles: ['犀牛坦克(受损)'],
          aircraft: ['黑鹰战机(正常)'],
          equipment: { 磁暴增幅器: 6 },
        },
      },
    },
    queues: [
      {
        type: '生产',
        item: '防空步兵',
        base: '一号基地',
        progress: 55,
        eta: '余1小时',
        status: 'active',
        lane: 'personnel',
      },
      {
        type: '生产',
        item: '灰熊坦克',
        base: '一号基地',
        progress: 70,
        eta: '余3小时',
        status: 'active',
        lane: 'land',
      },
      {
        type: '改装',
        item: '赤霄高周波刀鞘套件',
        base: '一号基地',
        progress: 80,
        eta: '余30分',
        status: 'active',
      },
    ],
  };
}

const DOSSIER_OVERRIDE: Record<string, ArmoryDossierInput> = {
  红叶: {
    found: true,
    name: '红叶',
    model: 'XT-09赤霄',
    dossierContent: '<数据>\n型号: XT-09赤霄\n武器: 赤霄太刀；热能诱导弹\n暴露分档: 🟢 常规武装\n社会外壳: 护卫队领班\n</数据>',
    storyContent: '【北坡正史】红叶目前驻防一号基地，状态完好。',
  },
};

describe('ModalMechaGirl · 四维「军备管理」模态框组件测试 (ARM-03)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('渲染顶栏四维 Tab 导航与基地作用域切换器，并在机娘编成 Tab 展示真实机娘列表与世界书双段档案', async () => {
    const spy = vi.spyOn(archiveIndexMod, 'loadGirlDossierDetail').mockResolvedValue({
      found: true,
      name: '红叶',
      model: 'XT-09赤霄',
      books: ['聊天世界书·测试', '机娘·能力档案'],
      dossierEntry: null,
      storyEntry: null,
      supportFallbacks: [],
      dossierContent: DOSSIER_OVERRIDE['红叶'].dossierContent ?? '',
      storyContent: DOSSIER_OVERRIDE['红叶'].storyContent ?? '',
      combinedContent: '',
    });

    const html = await renderArmoryModal({
      snapshot: createFixtureSnapshot(),
      initialScope: 'ALL',
      initialTab: 'girls',
      dossierMapOverride: DOSSIER_OVERRIDE,
    });

    // 标题与作用域按钮
    expect(html).toContain('军备管理 · ARMAMENT');
    expect(html).toContain('战区全局 ALL');
    expect(html).toContain('📍 一号基地');
    expect(html).toContain('📍 二号基地');

    // 四维 Tab 导航
    expect(html).toContain('机娘编成');
    expect(html).toContain('人员兵力');
    expect(html).toContain('载具空军');
    expect(html).toContain('制式装备');

    // 真实机娘列表与选中详情（不再硬编码锁死白凌）
    expect(html).toContain('红叶');
    expect(html).toContain('凛冬');
    expect(html).toContain('XT-09赤霄');
    expect(html).toContain('82%');
    expect(html).toContain('91%');
    expect(html).toContain('护卫队领班');
    expect(html).toContain('【北坡正史】红叶目前驻防一号基地');

    spy.mockRestore();
  });

  it('切换单基地作用域（一号基地）：过滤非本基地机娘并更新四维统计徽章', async () => {
    const html = await renderArmoryModal({
      snapshot: createFixtureSnapshot(),
      initialScope: '一号基地',
      initialTab: 'girls',
      dossierMapOverride: DOSSIER_OVERRIDE,
    });

    expect(html).toContain('data-testid="girl-row-红叶"');
    expect(html).not.toContain('data-testid="girl-row-凛冬"');
  });

  it('真实机娘为空时仅展示干净的战术空状态，不再连接静态示例预设或 catalog', async () => {
    const emptyHtml = await renderArmoryModal({
      snapshot: { girls: [], bases: {} },
      initialTab: 'girls',
    });

    expect(emptyHtml).toContain('data-testid="girls-empty-state"');
    expect(emptyHtml).toContain('暂无在编机娘');
    expect(emptyHtml).not.toContain('查看示例档案');
    expect(emptyHtml).not.toContain('data-testid="example-bailing-banner"');
    expect(emptyHtml).not.toContain('盟军MCV-01原型');
  });

  it('切换「人员兵力」、「载具空军」、「制式装备」三个 Tab：正确渲染分类统计、战损完好明细与在产队列', async () => {
    const snap = createFixtureSnapshot();

    const personnelHtml = await renderArmoryModal({
      snapshot: snap,
      initialScope: 'ALL',
      initialTab: 'personnel',
    });
    expect(personnelHtml).toContain('data-testid="panel-personnel"');
    expect(personnelHtml).toContain('动员兵');
    expect(personnelHtml).toContain('×60');
    expect(personnelHtml).toContain('防空步兵');

    const vehiclesHtml = await renderArmoryModal({
      snapshot: snap,
      initialScope: 'ALL',
      initialTab: 'vehicles',
    });
    expect(vehiclesHtml).toContain('data-testid="panel-vehicles"');
    expect(vehiclesHtml).toContain('天启坦克');
    expect(vehiclesHtml).toContain('犀牛坦克');
    expect(vehiclesHtml).toContain('基洛夫空艇');
    expect(vehiclesHtml).toContain('灰熊坦克');

    const equipmentHtml = await renderArmoryModal({
      snapshot: snap,
      initialScope: 'ALL',
      initialTab: 'equipment',
      dossierMapOverride: DOSSIER_OVERRIDE,
    });
    expect(equipmentHtml).toContain('data-testid="panel-equipment"');
    expect(equipmentHtml).toContain('外骨骼装甲');
    expect(equipmentHtml).toContain('赤霄太刀');
    expect(equipmentHtml).toContain('赤霄高周波刀鞘套件');
  });

  it('次生二号机初诞待授名态：正确渲染 ✨ 待指挥官赐名 徽标、编号: 犀牛-02、次生二号机、身子特征及基地内勤暂未编织外壳提示 (MAIDEN-UI-01)', async () => {
    const html = await renderArmoryModal({
      snapshot: {
        girls: [
          {
            name: '待授名·犀牛-02',
            serial: '犀牛-02',
            seq: '次生二号机',
            model: '犀牛主战坦克',
            faction: '苏联',
            status: '完好',
            duty: '重装突击待命（待指挥官赐予代号）',
            base: '北坡主基地',
            body: '158cm娇小紧致型纳米躯体',
            shell: '',
            alias: '',
            traits: ['次生异构', '极限过载', '待授名'],
          },
        ],
      },
      initialScope: 'ALL',
      initialTab: 'girls',
    });

    expect(html).toContain('data-test="girl-unchristened-badge"');
    expect(html).toContain('✨ 待指挥官赐名');
    expect(html).toContain('data-test="girl-serial-chip"');
    expect(html).toContain('编号: 犀牛-02');
    expect(html).toContain('data-test="girl-seq-chip"');
    expect(html).toContain('次生二号机');
    expect(html).toContain('data-test="girl-body-section"');
    expect(html).toContain('机体与外貌特征');
    expect(html).toContain('158cm娇小紧致型纳米躯体');
    expect(html).toContain('data-test="girl-shell-deferred"');
    expect(html).toContain('🔒 基地内勤 · 尚未安排对外伪装身份');
  });

  it('指挥官赐名并从聊天世界书回读 [出厂编号] / [躯体特征] / <数据> 块：合并 forces.girls 与 pending_lore 并完整展示代号、编号、序列与躯体特征 (MAIDEN-UI-01)', async () => {
    const parsed = archiveIndexMod.parseGirlDossierData(
      [
        '[机娘·能力档案 | 赤星——犀牛主战坦克]',
        '[出厂编号] 犀牛-02',
        '[专属代号] 赤星·绯红之锤',
        '[机体序列] 次生二号机',
        '[所属阵营] 苏联',
        '[躯体特征] 158cm娇小紧致型纳米躯体，锁骨浮现暗红散热微流道',
        '<数据>',
        '编号: 犀牛-02',
        '代号: 赤星·绯红之锤',
        '序列: 次生二号机',
        '阵营: 苏联',
        '躯体特征: 158cm娇小紧致型纳米躯体，锁骨浮现暗红散热微流道',
        '</数据>',
      ].join('\n'),
      '[剧情·北坡纪事 | 赤星——犀牛主战坦克]\n社会外壳：暂未编织（基地内勤）\n当前状态：已由指挥官赐名「赤星」',
    );

    expect(parsed.serial).toBe('犀牛-02');
    expect(parsed.callsign).toBe('赤星·绯红之锤');
    expect(parsed.seq).toBe('次生二号机');
    expect(parsed.faction).toBe('苏联');
    expect(parsed.body).toContain('158cm娇小紧致型纳米躯体');

    const html = await renderArmoryModal({
      snapshot: {
        forces: {
          girls: [
            {
              name: '待授名·犀牛-02',
              serial: '犀牛-02',
              model: '犀牛主战坦克',
              base: '北坡主基地',
              duty: '装甲突击',
            },
          ],
        },
        pending_lore: [
          {
            _tag: '机娘档案',
            name: '赤星',
            callsign: '赤星·绯红之锤',
            serial: '犀牛-02',
            rename_from: '待授名·犀牛-02',
            model: '犀牛主战坦克',
            seq: '次生二号机',
            faction: '苏联',
            body: '158cm娇小紧致型纳米躯体，锁骨浮现暗红散热微流道',
            shell: '暂未编织（基地内勤）',
          },
        ],
      },
      initialScope: 'ALL',
      initialTab: 'girls',
      dossierMapOverride: {
        赤星: {
          name: '赤星',
          dossierContent: [
            '[出厂编号] 犀牛-02',
            '[专属代号] 赤星·绯红之锤',
            '[机体序列] 次生二号机',
            '[躯体特征] 158cm娇小紧致型纳米躯体，锁骨浮现暗红散热微流道',
            '<数据>',
            '编号: 犀牛-02',
            '代号: 赤星·绯红之锤',
            '序列: 次生二号机',
            '躯体特征: 158cm娇小紧致型纳米躯体，锁骨浮现暗红散热微流道',
            '</数据>',
          ].join('\n'),
          storyContent: '社会外壳：暂未编织（基地内勤）',
        },
      },
    });

    // 合并后左侧列表仅 1 名在编单位，不重复出现两条卡片
    expect(html).toContain('在编单位 (1)');
    expect(html).toContain('data-testid="girl-row-赤星"');
    expect(html).not.toContain('data-testid="girl-row-待授名·犀牛-02"');
    expect(html).not.toContain('data-test="girl-unchristened-badge"');

    // 右侧详情舱完整展示代号、编号、序列与躯体特征
    expect(html).toContain('代号「赤星·绯红之锤」');
    expect(html).toContain('编号: 犀牛-02');
    expect(html).toContain('次生二号机');
    expect(html).toContain('158cm娇小紧致型纳米躯体，锁骨浮现暗红散热微流道');
    expect(html).toContain('🔒 基地内勤 · 尚未安排对外伪装身份');
  });

  it('修复 <数据> 块内暴露分档为空时误捕获 </数据> 的 Bug，剥离世界书原始 <数据> 标签并在人员兵力 Tab 展示在编军官', async () => {
    const rawDossierWithEmptyExposure = [
      '[机娘·能力档案 | 白凌——机动建设车（盟军）]',
      '[出厂编号] MCV-01',
      '[专属代号] 白凌',
      '[机体序列] 1号原型机',
      '[所属阵营] 盟军',
      '[躯体特征] 银灰色干练短发，标准战术工程轻装，右臂集成微观纳米喷注端口',
      '',
      '<数据>',
      '类型: 机娘',
      '名称: 白凌',
      '代号: 白凌',
      '编号: MCV-01',
      '型号: 机动建设车（盟军）',
      '序列: 1号原型机',
      '阵营: 盟军',
      '躯体特征: 银灰色干练短发，标准战术工程轻装，右臂集成微观纳米喷注端口',
      '暴露分档:',
      '</数据>',
    ].join('\n');

    const rawStory = [
      '[剧情·北坡纪事 | 白凌——机动建设车（盟军）]',
      '[出厂编号] MCV-01',
      '社会外壳: 暂未编织（基地内勤）',
      '外观: 冷色调作训服外搭工程外骨骼轻挂件',
      '性格: 严谨克制，注重工程规程与时效',
      '当前状态: 运转中',
    ].join('\n');

    const parsed = archiveIndexMod.parseGirlDossierData(rawDossierWithEmptyExposure, rawStory);
    expect(parsed.exposure).toBe('');
    expect(parsed.appearance).toBe('冷色调作训服外搭工程外骨骼轻挂件');
    expect(parsed.personality).toBe('严谨克制，注重工程规程与时效');

    const girlsHtml = await renderArmoryModal({
      snapshot: {
        girls: [
          {
            name: '白凌',
            callsign: '白凌',
            serial: 'MCV-01',
            seq: '1号原型机',
            model: '机动建设车（盟军）',
            faction: '盟军',
            affection: 50,
            obedience: 100,
            status: '完好',
            base: '前沿第一基地',
            duty: '基地中枢展开与工程统筹',
            body: '银灰色干练短发，标准战术工程轻装，右臂集成微观纳米喷注端口',
          },
        ],
      },
      initialScope: 'ALL',
      initialTab: 'girls',
      dossierMapOverride: {
        白凌: {
          name: '白凌',
          dossierContent: rawDossierWithEmptyExposure,
          storyContent: rawStory,
        },
      },
    });

    // 绝不渲染 </数据> 或 <数据>
    expect(girlsHtml).not.toContain('&lt;/数据&gt;');
    expect(girlsHtml).not.toContain('</数据>');
    expect(girlsHtml).toContain('🟢 常规伪装（基地内勤）');
    expect(girlsHtml).toContain('冷色调作训服外搭工程外骨骼轻挂件');
    expect(girlsHtml).toContain('严谨克制，注重工程规程与时效');
    expect(girlsHtml).toContain('默契协作');
    expect(girlsHtml).toContain('绝对服从');

    // 人员兵力 Tab 展示在编军官与随行人员
    const personnelHtml = await renderArmoryModal({
      snapshot: {
        bases: {
          前沿第一基地: {
            name: '前沿第一基地',
            forces: { infantry: { 动员兵: 3 } },
          },
        },
        codex: [
          {
            name: '叶琳娜',
            kind: '人员',
            desc: '随 MCV 跨界降临的前线参谋',
            params: {
              代号: '银狐',
              开局职务: '战区前线参谋',
              随行渊源: '跨界心腹旧部',
              阵营归属: '盟军',
              外貌着装: '干练战地勤务制服',
              性格与口吻: '沉稳果断',
            },
          },
        ],
      },
      initialScope: 'ALL',
      initialTab: 'personnel',
    });

    expect(personnelHtml).toContain('data-testid="personnel-officers-section"');
    expect(personnelHtml).toContain('叶琳娜');
    expect(personnelHtml).toContain('「银狐」');
    expect(personnelHtml).toContain('战区前线参谋');
    expect(personnelHtml).toContain('干练战地勤务制服');
  });

  it('FD-37 PKG-D：单基地无独立驻军时渲染「战区机动直属」指挥官提示，并展示机娘专属座驾徽标与在册参谋/重要人物紧凑名录', async () => {
    const snap: ArmorySnapshotLike = {
      bases: [
        {
          id: 'b1',
          name: '北坡主基地',
          forces: {
            troops: { 动员兵: 30 },
            vehicles: ['犀牛坦克(正常) ×2'],
          },
        },
        {
          id: 'b2',
          name: '二号前哨站',
        },
      ],
      forces: {
        troops: { 动员兵: 80 },
        vehicles: ['犀牛坦克(正常) ×3', '灰熊坦克(正常)'],
      },
      girls: [
        {
          name: '赤星',
          model: '犀牛主战坦克',
          base: '北坡主基地',
          status: '完好',
        },
      ],
      command: {
        adjutants: [
          {
            name: '叶琳娜',
            role: 'staff',
            title: '联席作战参谋',
            faction: '盟军',
            note: '负责前线兵力调拨',
          },
        ],
      },
      codex: [
        {
          name: '周镇长',
          kind: '人物',
          desc: '协助维护北坡镇外围秩序',
          params: {
            身份: '北坡镇镇长',
            所属势力: '地方自治会',
            态度: '友善',
            信任度: '85',
            驻地: '北坡主基地',
          },
        },
      ],
    };

    // 1. 二号前哨站（无独立驻军，战区机动直属有 50 人 / 2 车）：展示指挥官提示，不伪造驻军
    const base2PersonnelHtml = await renderArmoryModal({
      snapshot: snap,
      initialScope: '二号前哨站',
      initialTab: 'personnel',
    });
    expect(base2PersonnelHtml).toContain('data-testid="personnel-unassigned-hint"');
    expect(base2PersonnelHtml).toContain('战区机动直属');
    expect(base2PersonnelHtml).toContain('50 名人员');
    expect(base2PersonnelHtml).not.toContain('data-testid="personnel-row-动员兵"');

    const base2VehiclesHtml = await renderArmoryModal({
      snapshot: snap,
      initialScope: '二号前哨站',
      initialTab: 'vehicles',
    });
    expect(base2VehiclesHtml).toContain('data-testid="vehicles-unassigned-hint"');
    expect(base2VehiclesHtml).toContain('战区机动直属');
    expect(base2VehiclesHtml).toContain('2 台载具/战机');
    expect(base2VehiclesHtml).not.toContain('data-testid="vehicle-group-犀牛坦克"');

    // 2. 北坡主基地载具页签：展示「★ 赤星专属座驾」徽标
    const base1VehiclesHtml = await renderArmoryModal({
      snapshot: snap,
      initialScope: '北坡主基地',
      initialTab: 'vehicles',
    });
    expect(base1VehiclesHtml).toContain('data-testid="vehicle-girl-badge-犀牛坦克-赤星"');
    expect(base1VehiclesHtml).toContain('★ 赤星专属座驾');

    // 3. 北坡主基地人员页签：展示「■ 在册参谋与重要人物」紧凑名录条
    const base1PersonnelHtml = await renderArmoryModal({
      snapshot: snap,
      initialScope: '北坡主基地',
      initialTab: 'personnel',
    });
    expect(base1PersonnelHtml).toContain('data-testid="personnel-notable-characters-section"');
    expect(base1PersonnelHtml).toContain('在册参谋与重要人物');
    expect(base1PersonnelHtml).toContain('data-testid="notable-char-周镇长"');
    expect(base1PersonnelHtml).toContain('北坡镇镇长');
    expect(base1PersonnelHtml).toContain('友善');
    expect(base1PersonnelHtml).toContain('85');
  });
});
