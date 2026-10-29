/**
 * FD-49 PKG-B · 世界书落盘硬护栏专项单测
 *
 * 覆盖：
 * 1. FORBIDDEN_GENERIC_TRIGGER_KEYS 与 sanitizeWorldbookKeys 触发词机器净化；
 * 2. expansionKeys / dossierKeys / storyKeys 出口净化接线；
 * 3. upsertExpansionEntry / upsertDossierEntry / upsertStoryEntry 叶子化与匹配开关钉死 + 阵容总览 prevent_outgoing: true；
 * 4. stripMetaJargonLines 与 renderExpansionContent 元语言清洗；
 * 5. BUILTIN_ROSTER_PERSONNEL_NAMES 与 isDuplicateOfSystemCatalog 防重扩围（核心人员拦截 + 标准硬件微改后缀拦截）。
 */
import { describe, expect, it } from 'vitest';
import { buildEntityCredibilityIndex } from '../core/entityCredibility';
import { GirlDossier, type ExpansionDossier } from '../core/schema';
import {
  buildStructuredExpansionDataObject,
  BUILTIN_ROSTER_PERSONNEL_NAMES,
  extractHardwareBaseName,
  expansionKeys,
  FORBIDDEN_GENERIC_TRIGGER_KEYS,
  isDuplicateOfSystemCatalog,
  renderExpansionContent,
  sanitizeWorldbookKeys,
  stripMetaJargonLines,
  upsertExpansionEntry,
} from '../worldbook/expansionFiler';
import { parseWorldbookEntries } from '../../中控悬浮窗/models/worldbookCatalogParser';
import {
  dossierKeys,
  ROSTER_MARK,
  storyKeys,
  upsertDossierEntry,
  upsertStoryEntry,
  type ThEntry,
} from '../worldbook/girlFiler';

describe('FD-49 PKG-B · B1: FORBIDDEN_GENERIC_TRIGGER_KEYS 与 sanitizeWorldbookKeys', () => {
  it('FORBIDDEN_GENERIC_TRIGGER_KEYS 完整包含类别壳词、阵营前缀、战术功能泛词与无效占位词', () => {
    const requiredBlacklisted = [
      '科技', '建筑', '载具', '人员', '人物', '装备', '地点', '势力', '阵营', '单位', '机娘', '档案', '设定', '图鉴', '其他',
      '盟军', '苏联', '苏军', '苏维埃', '尤里', '通用', '帝国', '焚风', '红警', '基地', '主基地', '分基地', '前哨', '统帅部', '参谋部',
      '防御', '防空', '侦察', '压制', '态势', '口径', '两栖', '装甲', '重装', '轻型', '重型', '中型', '步兵', '战车', '坦克',
      '战机', '舰艇', '支援', '后勤', '补给', '维修', '抢修', '医疗', '工程', '科研', '研究', '生产', '建造', '改装', '升级',
      '火力', '突击', '狙击', '隐身', '光学', '雷达', '电磁', '纳米', '核能', '电力', '发电', '电站', '矿场', '兵营', '船厂',
      '实验室', '指挥官', '副官', '参谋', '首领', '队长', '士兵', '动员', '精锐', '老兵', '新兵', '原型', '首台', '量产',
      '无', '暂无', '未知', '待定', '未明', '-', 'null', 'undefined', 'none',
    ];
    for (const word of requiredBlacklisted) {
      expect(FORBIDDEN_GENERIC_TRIGGER_KEYS.has(word)).toBe(true);
    }
  });

  it('sanitizeWorldbookKeys 拦截泛词、裸单字母、单字中文、纯数字与纯档位编号，保留专名与型号并将 primaryName 排在首位', () => {
    const raw = [
      ' ',
      '科技',
      '防御',
      '装甲',
      '侦察',
      '基地',
      '盟军',
      'R',
      'A',
      'X',
      '电',
      '炮',
      '01',
      '100',
      'T1',
      'T2',
      't3',
      'V1',
      'v2',
      'NULL',
      'None',
      'undefined',
      '脉冲炮',
      'MCV-A01',
      'BMP-3',
      'M3',
      'F22',
      '/\\bM3\\b/i',
      '等离子脉冲炮',
    ];

    const cleaned = sanitizeWorldbookKeys(raw, '等离子脉冲炮');
    expect(cleaned).toEqual([
      '等离子脉冲炮',
      '脉冲炮',
      'MCV-A01',
      'BMP-3',
      'M3',
      'F22',
      '/\\bM3\\b/i',
    ]);
  });

  it('sanitizeWorldbookKeys 遵守 maxKeys 数量上限（默认 8）', () => {
    const raw = ['专名一', '专名二', '专名三', '专名四', '专名五', '专名六', '专名七', '专名八', '专名九', '专名十'];
    expect(sanitizeWorldbookKeys(raw, '主专名')).toEqual([
      '主专名',
      '专名一',
      '专名二',
      '专名三',
      '专名四',
      '专名五',
      '专名六',
      '专名七',
    ]);
    expect(sanitizeWorldbookKeys(raw, '主专名', 3)).toEqual(['主专名', '专名一', '专名二']);
  });

  it('expansionKeys / dossierKeys / storyKeys 自动过滤混入的泛词与裸单字母', () => {
    const expDossier: ExpansionDossier = {
      name: '重型磁暴反应炉',
      kind: '建筑',
      desc: '磁暴供能建筑',
      params: {},
      detail: '高压磁暴谐振发电设施。',
      keys: ['建筑', '电力', '发电', '电站', 'R', 'T2', '01', '磁暴反应炉', '高压磁暴炉'],
    };
    expect(expansionKeys(expDossier)).toEqual(['重型磁暴反应炉', '磁暴反应炉', '高压磁暴炉']);

    const girl = GirlDossier.parse({
      name: '苏离',
      callsign: 'A',
      serial: 'MCV-A01',
      model: 'F-47首台',
      keys: ['机娘', '侦察', '战机', 'T1', 'R', '静默电行', '群鸦'],
      alias: '档案',
      shell: '绣坊帮工',
    });
    expect(dossierKeys(girl)).toEqual(['苏离', 'MCV-A01', '静默电行', '群鸦']);
    expect(storyKeys(girl)).toEqual(['苏离']);
  });
});

describe('FD-49 PKG-B · B2: 条目控制字段显式钉死与阵容总览防扇出', () => {
  it('upsertExpansionEntry 显式钉死 recursion 与 matchWholeWords/caseSensitive/excludeRecursion/preventRecursion', () => {
    const entries: ThEntry[] = [];
    const d: ExpansionDossier = {
      name: '超导磁轨防空塔',
      kind: '建筑',
      desc: '电磁防空设施',
      params: {},
      detail: '利用超导电容驱动的高初速防空磁轨炮塔。',
      keys: ['防御', '防空', 'T2', '磁轨防空塔'],
    };
    upsertExpansionEntry(entries, d);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.strategy?.keys).toEqual(['超导磁轨防空塔', '磁轨防空塔']);
    expect(e.recursion).toEqual({ prevent_incoming: true, prevent_outgoing: true, delay_until: null });
    expect(e.matchWholeWords).toBe(false);
    expect(e.caseSensitive).toBe(false);
    expect(e.excludeRecursion).toBe(true);
    expect(e.preventRecursion).toBe(true);
  });

  it('upsertDossierEntry 与 upsertStoryEntry 显式钉死叶子化开关，且总览·机娘阵容与社会外壳总览 prevent_outgoing 为 true', () => {
    const entries: ThEntry[] = [];
    const girl = GirlDossier.parse({
      name: '苏离',
      model: 'F-47首台',
      keys: ['侦察', '静默电行'],
      alias: '苏家表妹·苏离',
      shell: '绣坊帮工',
    });

    upsertDossierEntry(entries, girl);
    upsertStoryEntry(entries, girl);

    const dossierEntry = entries.find(e => e.name.startsWith('档案·苏离'))!;
    const storyEntry = entries.find(e => e.name.startsWith('剧情·苏离'))!;
    const rosterEntry = entries.find(e => e.name.includes(ROSTER_MARK))!;

    expect(dossierEntry.strategy?.keys).toEqual(['苏离', '静默电行']);
    expect(dossierEntry.recursion).toEqual({ prevent_incoming: true, prevent_outgoing: true, delay_until: null });
    expect(dossierEntry.matchWholeWords).toBe(false);
    expect(dossierEntry.caseSensitive).toBe(false);
    expect(dossierEntry.excludeRecursion).toBe(true);
    expect(dossierEntry.preventRecursion).toBe(true);

    expect(storyEntry.recursion).toEqual({ prevent_incoming: true, prevent_outgoing: true, delay_until: null });
    expect(storyEntry.matchWholeWords).toBe(false);
    expect(storyEntry.caseSensitive).toBe(false);

    // 关键门禁：常驻总览必须 prevent_outgoing: true 掐断递归扇出
    expect(rosterEntry.recursion).toEqual({ prevent_incoming: true, prevent_outgoing: true, delay_until: null });
    expect(rosterEntry.excludeRecursion).toBe(true);
    expect(rosterEntry.preventRecursion).toBe(true);
  });
});

describe('FD-49 PKG-B · B3: stripMetaJargonLines 与 renderExpansionContent 元语言清洗', () => {
  it('stripMetaJargonLines 自动剥离【key说明】、【触发词说明】、【平衡性说明】、生态位：、设计定位：等脏行', () => {
    const rawText = [
      '采用双回路液氮冷却的战地相控阵火控雷达，可在强电磁干扰下维持稳定锁敌。',
      '【key说明】仅设置专名触发词，防止泛词误触。',
      '【触发词说明】相控阵火控雷达、双回路液氮雷达。',
      '【平衡性说明】遵循T2电力语言，不叠加百分比光环。',
      '生态位：填补基地中程全天候防空火控盲区。',
      '设计定位：中坚防空支援节点。',
      '*系统映射：已绑定至末尾数据块。',
      '在极寒暴风雪工况下需额外消耗 15% 除冰维持功率。',
    ].join('\n');

    const cleaned = stripMetaJargonLines(rawText);
    expect(cleaned).toBe(
      [
        '采用双回路液氮冷却的战地相控阵火控雷达，可在强电磁干扰下维持稳定锁敌。',
        '在极寒暴风雪工况下需额外消耗 15% 除冰维持功率。',
      ].join('\n'),
    );
  });

  it('renderExpansionContent 在渲染正文时自动清洗元语言脏行并保留合法自然段与 <数据> 块', () => {
    const d: ExpansionDossier = {
      name: '极寒相控阵火控站',
      kind: '建筑',
      desc: '战地防空火控节点\n设计定位：T2防空辅助',
      params: {},
      detail: [
        '采用双回路液氮冷却的战地相控阵火控雷达。',
        '【触发词说明】仅使用极寒相控阵火控站。',
        '生态位：中程防空态势感知。',
        '暴露在重炮直瞄火力下时天线阵列易受损。',
      ].join('\n'),
      keys: ['极寒相控阵火控站'],
      data: { type: 'building', tier: 2, cost_credits: 1200 },
    };

    const rendered = renderExpansionContent(d);
    expect(rendered).toContain('[红警扩展·建筑 | 极寒相控阵火控站]');
    expect(rendered).toContain('采用双回路液氮冷却的战地相控阵火控雷达。');
    expect(rendered).toContain('暴露在重炮直瞄火力下时天线阵列易受损。');
    expect(rendered).not.toContain('触发词说明');
    expect(rendered).not.toContain('生态位：');
    expect(rendered).not.toContain('设计定位：');
    expect(rendered).toContain('<数据>');
    expect(rendered).toContain('"cost_credits": 1200');
  });
});

describe('FD-49 PKG-B · B4: BUILTIN_ROSTER_PERSONNEL_NAMES 与 isDuplicateOfSystemCatalog 扩围', () => {
  const credIndex = buildEntityCredibilityIndex({
    researches: [{ name: '低可观测技术工学' }],
    buildings: [{ name: '光棱塔' }],
    productions: [{ name: '灰熊坦克' }, { name: '动员兵' }, { name: '犀牛坦克' }],
  });

  it('当 kind === "人员" 且命中 BUILTIN_ROSTER_PERSONNEL_NAMES 时直接判定为重复；kind === "人物" 时放行以保留 NPC 关系更新', () => {
    for (const name of BUILTIN_ROSTER_PERSONNEL_NAMES) {
      expect(isDuplicateOfSystemCatalog({ name, kind: '人员' }, null)).toBe(true);
      expect(isDuplicateOfSystemCatalog({ name, kind: '人物' }, null)).toBe(false);
    }
    expect(isDuplicateOfSystemCatalog({ name: '白凌（重装展开态）', kind: '人员' }, null)).toBe(true);
  });

  it('extractHardwareBaseName 与 isDuplicateOfSystemCatalog 精准拦截带括号/分隔符改装后缀的标准硬件与兵种', () => {
    expect(extractHardwareBaseName('灰熊坦克（战地加挂版）')).toBe('灰熊坦克');
    expect(extractHardwareBaseName('动员兵·雪地型')).toBe('动员兵');
    expect(extractHardwareBaseName('犀牛坦克(复合装甲型)')).toBe('犀牛坦克');
    expect(extractHardwareBaseName('光棱塔-极地强化版')).toBe('光棱塔');

    expect(isDuplicateOfSystemCatalog({ name: '灰熊坦克（战地加挂版）', kind: '载具' }, credIndex)).toBe(true);
    expect(isDuplicateOfSystemCatalog({ name: '动员兵·雪地型', kind: '人员' }, credIndex)).toBe(true);
    expect(isDuplicateOfSystemCatalog({ name: '犀牛坦克(复合装甲型)', kind: '载具' }, credIndex)).toBe(true);
    expect(isDuplicateOfSystemCatalog({ name: '光棱塔·极地强化版', kind: '建筑' }, credIndex)).toBe(true);

    // 全新原创实体即使带括号后缀也不误拦
    expect(isDuplicateOfSystemCatalog({ name: '磁暴穿甲步行机甲（极地型）', kind: '载具' }, credIndex)).toBe(false);
    expect(isDuplicateOfSystemCatalog({ name: '幽能裂隙折跃学', kind: '科技' }, credIndex)).toBe(false);
  });
});

describe('FD-49 扩展同构 · B5: 全新科技/载具/人员/建筑/装备自动合成标准 <数据> 块并接入 worldbookCatalogParser', () => {
  it('全新科技/载具/人员/建筑/装备仅提供中文 params 时自动合成标准 <数据> 块，且可直接被 parseWorldbookEntries 解析入库', () => {
    const entries: ThEntry[] = [];

    const techDossier: ExpansionDossier = {
      name: '磁暴电容超载学',
      kind: '科技',
      desc: '高密度脉冲电容矩阵与磁暴线圈瞬态超载放电理论。',
      params: {
        造价: '1200',
        工期: '3日',
        科技层级: 'T2',
        研究线: '苏联特色',
        所需建筑: '苏联战斗实验室',
        前置科技: '磁暴线圈工程学',
        解锁产物: '聚变增压线圈, 磁暴猎兵',
      },
      detail: '通过引入超导储能环与多级晶闸管同步触发阵列，将单次电弧放电峰值推升至三倍。',
      keys: ['磁暴电容超载学'],
    };

    const personnelDossier: ExpansionDossier = {
      name: '磁暴猎兵',
      kind: '人员',
      desc: '携行背负式高能电容包与短距电弧步枪的防区突击步兵。',
      params: {
        造价: '450',
        工期: '1日',
        科技层级: 'T2',
        所属阵营: '苏联',
        生产建筑: '兵营',
        前置科技: '磁暴电容超载学',
        主武器: '便携式脉冲电弧步枪',
        副武器: '接地防爆磁靴',
        战术特长: '短距电磁瘫痪, 掩体电弧清剿',
      },
      detail: '依托兵营重装整训跨间编成，专为狭窄巷战与地下掩体攻坚设计。',
      keys: ['磁暴猎兵'],
    };

    const vehicleDossier: ExpansionDossier = {
      name: '极北破冰钻探车',
      kind: '载具',
      desc: '配备重型热熔钻头与复合破冰铲的特种装甲工程车。',
      params: {
        造价: '1400',
        工期: '2日',
        科技层级: 'T2',
        所属阵营: '苏联',
        生产建筑: '苏联战车工厂',
        前置科技: '磁暴电容超载学',
        主武器: '等离子热熔破冰钻',
        副武器: '车顶重机枪',
        战术特长: '冻土掘进, 掩体破障',
      },
      detail: '专为永久冻土带地下工事掘进与冰封河道破障研制。',
      keys: ['极北破冰钻探车'],
    };

    const buildingDossier: ExpansionDossier = {
      name: '聚变增压线圈',
      kind: '建筑',
      desc: '针对重型特斯拉线圈研制的超高压外挂储能与脉冲增压单元。',
      params: {
        造价: '1800',
        耗电: '60',
        工期: '2日',
        科技层级: 'T2',
        所属阵营: '苏联',
        职能分类: '防御',
        所需建筑: '苏联战斗实验室',
        前置科技: '磁暴电容超载学',
      },
      detail: '在磁暴基座旁并联高能储能电容组，三秒内释放百万千瓦超高压电弧。',
      keys: ['聚变增压线圈'],
    };

    upsertExpansionEntry(entries, techDossier);
    upsertExpansionEntry(entries, personnelDossier);
    upsertExpansionEntry(entries, vehicleDossier);
    upsertExpansionEntry(entries, buildingDossier);

    expect(entries).toHaveLength(4);

    // 验证双向图谱缝合：仅凭中文 params 合成的 <数据> 块即可让父科技自动认领 3 个下游衍生实体
    const techEntry = entries.find(e => e.name === '科技·磁暴电容超载学·设定')!;
    expect(techEntry.content).toContain('· 衍生解锁实体：人员「磁暴猎兵」、载具「极北破冰钻探车」、建筑「聚变增压线圈」');

    // 验证 parseWorldbookEntries 可直接将 4 个条目解析为合法动态目录项
    const parsedCatalog = parseWorldbookEntries(entries, { silent: true });
    expect(parsedCatalog.diagnostics).toEqual([]);
    expect(parsedCatalog.researches).toHaveLength(1);
    expect(parsedCatalog.researches[0]).toMatchObject({
      type: 'research',
      name: '磁暴电容超载学',
      cost: 1200,
      tier: 2,
      line: '苏联特色',
      prereqs: ['磁暴线圈工程学'],
      need_buildings: ['苏联战斗实验室'],
      unlocks: '聚变增压线圈, 磁暴猎兵',
    });

    expect(parsedCatalog.buildings).toHaveLength(1);
    expect(parsedCatalog.buildings[0]).toMatchObject({
      type: 'building',
      name: '聚变增压线圈',
      cost: 1800,
      power: 60,
      tier: 2,
      system: 'defense',
      prereqs: ['磁暴电容超载学'],
      need_buildings: ['苏联战斗实验室'],
    });

    expect(parsedCatalog.productions).toHaveLength(2);
    const parsedInfantry = parsedCatalog.productions.find(p => p.name === '磁暴猎兵') as Record<string, any>;
    const parsedVehicle = parsedCatalog.productions.find(p => p.name === '极北破冰钻探车') as Record<string, any>;
    expect(parsedInfantry).toMatchObject({
      type: 'production',
      name: '磁暴猎兵',
      category: 'infantry',
      cost: 450,
      need_building: '兵营',
      need_buildings: ['兵营'],
      prereqs: ['磁暴电容超载学'],
      weapons: [
        { slot: '主武器', name: '便携式脉冲电弧步枪' },
        { slot: '副武器', name: '接地防爆磁靴' },
      ],
      skills: ['短距电磁瘫痪', '掩体电弧清剿'],
    });
    expect(parsedVehicle).toMatchObject({
      type: 'production',
      name: '极北破冰钻探车',
      category: 'vehicle',
      cost: 1400,
      need_building: '苏联战车工厂',
      prereqs: ['磁暴电容超载学'],
    });
  });

  it('类别: 人物（独立 NPC）、地点、势力 严禁生成产线 <数据> 块，防止混入兵营生产列表', () => {
    const npcDossier: ExpansionDossier = {
      name: '维克托·科尔萨科夫',
      kind: '人物',
      desc: '原苏军铁道装甲旅上校',
      params: { 代号: '铁砧上校', 态度: '合作', 信任度: '68' },
      detail: '手握三条干线铁路道岔控制权。',
      keys: ['维克托'],
    };
    const locDossier: ExpansionDossier = {
      name: '红峰露天矿坑',
      kind: '地点',
      desc: '废弃铁矿坑',
      params: {},
      detail: '北麓废弃矿区。',
      keys: ['红峰露天矿坑'],
    };

    expect(buildStructuredExpansionDataObject(npcDossier)).toBeUndefined();
    expect(buildStructuredExpansionDataObject(locDossier)).toBeUndefined();
    expect(renderExpansionContent(npcDossier)).not.toContain('<数据>');
    expect(renderExpansionContent(locDossier)).not.toContain('<数据>');
  });
});
