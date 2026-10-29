/**
 * techWorldbookV1.test.ts —— 《通用·科技》世界书 V1（schema_version:2）解析器最小接入回归（S3）
 *
 * 覆盖任务包清单：
 * 1. worldbookCatalogParser：v2 新字段（aliases/scope/pack/status/grants）放行透传；
 *    点号 ID 条目缺 name / name=id → 诊断 + 条目级隔离；v1 条目 name 缺省=id 不变；多块条目只认首块不变。
 * 2. catalogEffective：同名研究覆盖 warn 收集（不阻断、不改变合并行为）；buildResearchIdIndex 名↔ID 索引。
 * 3. useParse.buildAuthority：v2 研究 aliases 注入权威名集合与 alias→显示名 映射。
 * 4. worldbookDataFiler：research 条目禁改 id/name/type/aliases/pack/scope；requirements 过
 *    validatePrerequisiteCondition；research 条目禁子串 includes 命中（building 子串行为不变）。
 * 5. systemCheck：R13b tech.done 孤儿判定接入 aliases（别名命中不误报）。
 *
 * 全部使用内联 fixture，不依赖《通用·科技_世界书.json》真实文件。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { RESEARCHES } from '../core/catalog';
import { buildResearchIdIndex, mergeEffectiveCatalog } from '../core/catalogEffective';
import { checkVariables } from '../parse/systemCheck';
import { setCachedDynamicCatalog } from '../composables/useCatalog';
import { buildAuthority } from '../composables/useParse';
import { resolveUnitEquivalentCandidates } from '../core/prerequisitesHelpers';
import { buildMobileSuperweaponSynergyHints } from '../planning/strategicFeedforward';
import {
  applyDataPatchToEntries,
  findTargetEntry,
  RESEARCH_FORBIDDEN_PATCH_KEYS,
} from '../worldbook/worldbookDataFiler';
import type { ThEntry } from '../worldbook/girlFiler';
import {
  parseWorldbookEntries,
  type WorldbookEntryLike,
  type WorldbookResearchData,
} from '../../中控悬浮窗/models/worldbookCatalogParser';

/* ═══════════════ 内联 fixture ═══════════════ */

/** v2 科技条目（点号稳定 ID + 显式显示名） */
function makeV2ResearchEntry(overrides?: {
  id?: string;
  name?: string | null;
  extra?: Record<string, unknown>;
  comment?: string;
}): WorldbookEntryLike {
  const id = overrides?.id ?? 'ext.tech.common.armored_vehicle';
  const data: Record<string, unknown> = {
    schema_version: 2,
    type: 'research',
    id,
    cost: 300,
    eta: '约3日',
    line: '主建筑',
    tier: 1,
    scope: 'common',
    pack: 'base',
    status: 'active',
    aliases: ['装甲车辆工程'],
    grants: [],
    requirements: { kind: 'research', name: '基础步兵训练学' },
    desc: '装甲载具的设计与制造理论。',
    ...overrides?.extra,
  };
  // name === null 表示显式不写 name 字段
  if (overrides?.name !== null) data.name = overrides?.name ?? '装甲载具工学';
  return {
    uid: 1,
    comment: overrides?.comment ?? '01·装甲载具工学',
    content: `[通用·科技 | 主建筑]\n测试正文。\n\n<数据>\n${JSON.stringify(data, null, 2)}\n</数据>`,
  };
}

/** v1 旧制科技条目（id 即中文名、无 name 字段） */
function makeV1ResearchEntry(): WorldbookEntryLike {
  const data = {
    type: 'research',
    id: '有机循环工程学',
    cost: 200,
    eta: '约2日',
    line: '通用',
    tier: 1,
    desc: 'v1 旧制条目。',
  };
  return {
    uid: 2,
    comment: '02·有机循环工程学',
    content: `[通用·农畜业 | 通用]\n测试正文。\n\n<数据>\n${JSON.stringify(data, null, 2)}\n</数据>`,
  };
}

/** 世界书条目数组 → ThEntry（filer 测试用） */
function toThEntry(e: WorldbookEntryLike, uid = 1): ThEntry {
  return {
    uid,
    name: String(e.comment ?? ''),
    comment: String(e.comment ?? ''),
    key: [],
    order: 40000 + uid,
    enabled: true,
    position: { type: 'before_character_definition', order: 40000 + uid },
    strategy: { type: 'selective', keys: [] },
    content: String(e.content ?? ''),
  } as ThEntry;
}

function makeBuildingThEntry(): ThEntry {
  const content = `[通用·主建筑 | 战车工厂]\n测试正文。\n\n<数据>\n${JSON.stringify({
    type: 'building',
    id: '战车工厂',
    cost: 2000,
    power: 50,
    prereqs: [],
    need_buildings: [],
  })}\n</数据>`;
  return {
    uid: 3,
    name: '04·战车工厂',
    comment: '04·战车工厂',
    key: ['战车工厂'],
    order: 40003,
    enabled: true,
    position: { type: 'before_character_definition', order: 40003 },
    strategy: { type: 'selective', keys: ['战车工厂'] },
    content,
  } as ThEntry;
}

afterEach(() => {
  setCachedDynamicCatalog(null);
});

/* ═══════════════ 1. 解析器：v2 放行 + 点号 ID 护栏 ═══════════════ */

describe('worldbookCatalogParser · V2 schema 放行与点号 ID 护栏', () => {
  it('v2 条目新字段（aliases/scope/pack/status/grants）放行并透传', () => {
    const catalog = parseWorldbookEntries([makeV2ResearchEntry()], { silent: true });
    expect(catalog.diagnostics).toHaveLength(0);
    expect(catalog.researches).toHaveLength(1);
    const r = catalog.researches[0];
    expect(r.id).toBe('ext.tech.common.armored_vehicle');
    expect(r.name).toBe('装甲载具工学');
    expect(r.aliases).toEqual(['装甲车辆工程']);
    expect(r.scope).toBe('common');
    expect(r.pack).toBe('base');
    expect(r.status).toBe('active');
    expect(r.grants).toEqual([]);
    expect(r.requirements).toEqual({ kind: 'research', name: '基础步兵训练学' });
  });

  it('v2 点号 ID 缺 name → 生成诊断并隔离该条目', () => {
    const catalog = parseWorldbookEntries(
      [makeV2ResearchEntry({ name: null }), makeV1ResearchEntry()],
      { silent: true },
    );
    // 坏条目被隔离，好条目不受影响
    expect(catalog.researches).toHaveLength(1);
    expect(catalog.researches[0].id).toBe('有机循环工程学');
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0].code).toBe('validation_error');
    expect(catalog.diagnostics[0].message).toContain('name');
  });

  it('v2 点号 ID 且 name === id → 同样隔离', () => {
    const catalog = parseWorldbookEntries(
      [makeV2ResearchEntry({ name: 'ext.tech.common.armored_vehicle' })],
      { silent: true },
    );
    expect(catalog.researches).toHaveLength(0);
    expect(catalog.diagnostics).toHaveLength(1);
    expect(catalog.diagnostics[0].message).toContain('≠ id');
  });

  it('v1 旧制条目（id=中文名、无 name）维持 name 缺省=id 现状，无诊断', () => {
    const catalog = parseWorldbookEntries([makeV1ResearchEntry()], { silent: true });
    expect(catalog.diagnostics).toHaveLength(0);
    expect(catalog.researches).toHaveLength(1);
    expect(catalog.researches[0].name).toBe('有机循环工程学');
  });

  it('一条目多块：仍只解析第一个 <数据> 块（既有行为不变）', () => {
    const first = { type: 'research', id: '甲研究', cost: 1 };
    const second = { type: 'research', id: '乙研究', cost: 2 };
    const entry: WorldbookEntryLike = {
      uid: 9,
      comment: '多块条目',
      content: `<数据>\n${JSON.stringify(first)}\n</数据>\n中间叙述\n<数据>\n${JSON.stringify(second)}\n</数据>`,
    };
    const catalog = parseWorldbookEntries([entry], { silent: true });
    expect(catalog.researches.map(r => r.id)).toEqual(['甲研究']);
  });
});

/* ═══════════════ 2. catalogEffective：同名 warn + 名↔ID 索引 ═══════════════ */

describe('catalogEffective · 同名覆盖 warn 与名↔ID 索引', () => {
  const wbResearch = (name: string, id: string, cost = 100): WorldbookResearchData => ({
    type: 'research',
    id,
    name,
    cost,
    eta: '约1日',
    line: '主建筑',
    tier: 1,
    prereqs: [],
    need_buildings: [],
    tags: [],
    desc: '',
  });

  it('世界书研究覆盖静态基线同名 → 收集 warn，且不阻断、不改变合并行为', () => {
    const staticName = RESEARCHES[0].name;
    const catalog = mergeEffectiveCatalog([], {
      researches: [wbResearch(staticName, 'ext.tech.common.override', 999)],
    });
    expect(catalog.researchWarnings?.some(w => w.includes(staticName) && w.includes('覆盖静态基线'))).toBe(true);
    // 合并行为不变：无重复名、覆盖者生效
    const names = catalog.researches.map(r => r.name);
    expect(new Set(names).size).toBe(names.length);
    expect(catalog.researches.find(r => r.name === staticName)?.cost).toBe(999);
  });

  it('世界书源内彼此同名 → 收集 warn，后者生效（mergeByName 语义不变）', () => {
    const catalog = mergeEffectiveCatalog([], {
      researches: [wbResearch('同名研究', 'ext.tech.a', 1), wbResearch('同名研究', 'ext.tech.b', 2)],
    });
    expect(catalog.researchWarnings?.some(w => w.includes('同名研究') && w.includes('重复定义'))).toBe(true);
    expect(catalog.researches.filter(r => r.name === '同名研究')).toHaveLength(1);
    expect(catalog.researches.find(r => r.name === '同名研究')?.cost).toBe(2);
  });

  it('无同名冲突时 researchWarnings 为空数组', () => {
    const catalog = mergeEffectiveCatalog([], { researches: [wbResearch('全新研究', 'ext.tech.new')] });
    expect(catalog.researchWarnings).toEqual([]);
  });

  it('buildResearchIdIndex：name→id、alias→name；撞 name 的别名不收录；先到先得', () => {
    const idx = buildResearchIdIndex([
      { id: 'ext.tech.common.armored_vehicle', name: '装甲载具工学', aliases: ['装甲车辆工程', '航空工学基础'] },
      { id: 'ext.tech.common.aviation', name: '航空工学基础', aliases: ['装甲车辆工程'] },
      { id: '有机循环工程学', name: '有机循环工程学' }, // v1：id 即名
      { name: '' }, // 坏行容忍
    ]);
    expect(idx.nameToId['装甲载具工学']).toBe('ext.tech.common.armored_vehicle');
    expect(idx.nameToId['有机循环工程学']).toBe('有机循环工程学');
    expect(idx.aliasToName['装甲车辆工程']).toBe('装甲载具工学'); // 先到先得
    expect(idx.aliasToName['航空工学基础']).toBeUndefined(); // 与 name 相撞不收录
  });
});

/* ═══════════════ 3. buildAuthority：aliases 注入权威集合 ═══════════════ */

describe('useParse.buildAuthority · 注入世界书 v2 aliases', () => {
  it('v2 研究别名进入权威名集合，并登记 alias→显示名 映射', async () => {
    const parsed = parseWorldbookEntries([makeV2ResearchEntry()], { silent: true });
    setCachedDynamicCatalog(parsed);
    const a = await buildAuthority();
    expect(a.names).toContain('装甲载具工学');
    expect(a.names).toContain('装甲车辆工程'); // 别名可命中
    expect(a.aliases['装甲车辆工程']).toBe('装甲载具工学');
  });
});

/* ═══════════════ 4. worldbookDataFiler：科技条目护栏 ═══════════════ */

describe('worldbookDataFiler · 科技条目护栏（D5）', () => {
  const researchEntry = () => toThEntry(makeV2ResearchEntry());

  it('research 条目禁改 id/name/type/aliases/pack/scope', () => {
    for (const key of RESEARCH_FORBIDDEN_PATCH_KEYS) {
      const res = applyDataPatchToEntries([researchEntry()], {
        target: '装甲载具工学',
        operation: 'patch',
        patch: { [key]: key === 'aliases' ? ['改名'] : '篡改' },
      });
      expect(res.success).toBe(false);
      expect(res.reason).toBe('red-line');
      expect(res.error).toContain('科技条目护栏');
    }
  });

  it('research 条目改 cost 等普通字段仍然允许', () => {
    const res = applyDataPatchToEntries([researchEntry()], {
      target: '装甲载具工学',
      operation: 'patch',
      patch: { cost: 450 },
    });
    expect(res.success).toBe(true);
    expect((res.newData as Record<string, unknown>).cost).toBe(450);
    // 身份字段原样保留
    expect((res.newData as Record<string, unknown>).id).toBe('ext.tech.common.armored_vehicle');
  });

  it('research 条目 requirements 非法 → 拒绝；合法 → 放行', () => {
    const bad = applyDataPatchToEntries([researchEntry()], {
      target: '装甲载具工学',
      operation: 'patch',
      patch: { requirements: { op: 'nope', conditions: [] } },
    });
    expect(bad.success).toBe(false);
    expect(bad.reason).toBe('red-line');
    expect(bad.error).toContain('requirements');

    const good = applyDataPatchToEntries([researchEntry()], {
      target: '装甲载具工学',
      operation: 'patch',
      patch: {
        requirements: {
          op: 'all',
          conditions: [{ kind: 'research', name: '基础步兵训练学' }],
        },
      },
    });
    expect(good.success).toBe(true);
  });

  it('findTargetEntry 对 research 条目禁用子串命中；building 子串行为不变', () => {
    // research：子串「装甲载具」不得命中「01·装甲载具工学」
    const miss = findTargetEntry([researchEntry()], '装甲载具');
    expect(miss.entry).toBeUndefined();
    expect(miss.reason).toBe('not-found');
    // research：精确名仍可命中
    const hit = findTargetEntry([researchEntry()], '装甲载具工学');
    expect(hit.entry).toBeDefined();
    expect(hit.dataJson?.id).toBe('ext.tech.common.armored_vehicle');
    // building：既有子串行为不变
    const bHit = findTargetEntry([makeBuildingThEntry()], '战车');
    expect(bHit.entry).toBeDefined();
  });

  it('building 条目不受科技护栏影响（id 等键不被误拦）', () => {
    const res = applyDataPatchToEntries([makeBuildingThEntry()], {
      target: '战车工厂',
      operation: 'patch',
      patch: { cost: 2100 },
    });
    expect(res.success).toBe(true);
  });
});

/* ═══════════════ 5. systemCheck：R13b aliases ═══════════════ */

describe('systemCheck · R13b tech.done 孤儿检测接入 aliases', () => {
  const baseInput = {
    codex: [] as { name: string; kind: string; params: Record<string, string> }[],
    overlays: [] as never[],
    baseResearches: [] as never[],
    mergedResearchNames: [] as string[],
  };

  it('tech.done 中的别名：无 aliases 输入时报孤儿；有 aliases 时不误报', () => {
    const without = checkVariables({ ...baseInput, techDone: ['装甲车辆工程'] });
    expect(without.some(i => i.rule === 'R13' && i.target === '装甲车辆工程')).toBe(true);

    const withAliases = checkVariables({
      ...baseInput,
      techDone: ['装甲车辆工程'],
      researchAliases: ['装甲车辆工程'],
    });
    expect(withAliases.some(i => i.rule === 'R13' && i.target === '装甲车辆工程')).toBe(false);
  });

  it('FD-48 · 苏联抽离通用科技与书内整编条目在 TECH_EQUIVALENT_GROUPS 中双向等价', async () => {
    const { evaluatePrerequisite } = await import('../core/prerequisites');
    const baseCtx = {
      techDone: new Set<string>(),
      selectedBaseId: 'b1',
      bases: new Map(),
      unitPresent: new Map(),
    };
    const pairs: Array<[string, string]> = [
      ['空间核电推进与轨道验证堆工学', 'sov.research.t3.kilowatt_orbital_test_reactor'],
      ['标准轨道货仓与可回收上面级工学', 'sov.research.t3.standard_orbital_cargo_segment'],
      ['自主在轨装配与月壤原位冶金工学', '月壤氧金属联产工学'],
      ['天基预警融合与轨道战略载荷工学', 'sov.research.t3.orbital_conventional_strategic_payload'],
      ['重型机械标准化与分散储备动员学', '重型机械标准化学'],
      ['储备装备再生与梯次拆件维修工学', '梯次维修与拆件工学'],
      ['战时产线冗余与大规模工程扩建学', '大规模工程扩建学'],
      ['大口径火箭齐射与热压攻坚工学', '热压攻坚工学'],
      ['战役战术导弹营与高速突防工学', '战役导弹营工学'],
      ['数字炮兵火力网与远程制导火箭工学', '数字炮兵火力网工学·苏联实现'],
      ['分层综合防空与火力单元自主交战学', '分层国土防空学说'],
      ['抗毁硬线备份通信与被动侦收伏击学', '被动侦收伏击学'],
      ['野战机动防空指挥与单元自治工学', '地面机动防空指挥工学'],
      ['多频无源预警与战区电子战编排学', '战区电子战任务编排学'],
      ['潜艇声学隐蔽与核潜艇现代化工学', '潜艇隐蔽与静音保障学'],
      ['舰载通用垂直发射与分布式海战指示学', '舰首巨型通用发射区工学'],
      ['大型压水堆工程与非能动余热安全学', '大型压水堆工程学·苏联实现'],
      ['快谱核能与同址闭式燃料循环工学', '同址闭式燃料循环工学'],
      ['大型磁约束聚变与氚自持控制工学', '稳态燃烧等离子体控制工学'],
      ['核指挥控制通信与战略连续性工程学', '基础核指挥控制与通信学'],
      ['天启系统集成与量产认证', '重装甲正面防护极限工学'],
      ['基洛夫系统集成认证', '大型硬式飞艇结构工学'],
    ];
    for (const [newName, legacyRef] of pairs) {
      expect(
        evaluatePrerequisite({ kind: 'research', name: legacyRef }, { ...baseCtx, techDone: new Set([newName]) }).satisfied,
      ).toBe(true);
      expect(
        evaluatePrerequisite({ kind: 'research', name: newName }, { ...baseCtx, techDone: new Set([legacyRef]) }).satisfied,
      ).toBe(true);
    }
  });
});

describe('FD-49 · 苏盟武备 141:141 对称考据充实、通用人员池收拢与通用+特色科技 100% 挂通回归', () => {
  const wbDir = resolve(__dirname, '../../../../worldbooks');
  const readBook = (name: string) =>
    JSON.parse(readFileSync(resolve(wbDir, name), 'utf8')) as {
      entries: Record<string, { uid: number; comment: string; content: string; disable?: boolean; key?: string[] }>;
    };

  const extractData = (content: string) => {
    const m = /<数据>\s*([\s\S]*?)\s*<\/数据>/u.exec(content || '');
    return m ? (JSON.parse(m[1]) as Record<string, unknown>) : null;
  };

  it('《武备·盟军》（142 项）、《武备·苏联》（144 项）、《武备·尤里》（31 项）启用 production 数量平衡，且《特色科技·盟军》扩充至 35 条', () => {
    const allyUnits = Object.values(readBook('武备·盟军_世界书.json').entries)
      .filter(e => !e.disable)
      .map(e => extractData(e.content))
      .filter(d => d?.type === 'production');
    const sovUnits = Object.values(readBook('武备·苏联_世界书.json').entries)
      .filter(e => !e.disable)
      .map(e => extractData(e.content))
      .filter(d => d?.type === 'production');
    const yuriUnits = Object.values(readBook('武备·尤里_世界书.json').entries)
      .filter(e => !e.disable)
      .map(e => extractData(e.content))
      .filter(d => d?.type === 'production');
    const allyTechs = Object.values(readBook('特色科技·盟军_世界书.json').entries)
      .filter(e => !e.disable)
      .map(e => extractData(e.content))
      .filter(d => d?.type === 'research');

    expect(allyUnits).toHaveLength(142);
    expect(sovUnits).toHaveLength(144);
    expect(Math.abs(allyUnits.length - sovUnits.length)).toBeLessThan(10);
    expect(yuriUnits).toHaveLength(31);
    expect(allyTechs).toHaveLength(35);
  });

  it('《通用·人员》承接 8 项通用职能步兵（共 12 项启用 production），《通用·空中载具》UID 28..31 转为合规存根', () => {
    const commonPersonnel = Object.values(readBook('通用·人员_世界书.json').entries)
      .filter(e => !e.disable)
      .map(e => extractData(e.content))
      .filter(d => d?.type === 'production');
    expect(commonPersonnel).toHaveLength(12);

    const commonAir = readBook('通用·空中载具_世界书.json').entries;
    for (const uid of ['28', '29', '30', '31']) {
      expect(commonAir[uid]?.disable).toBe(true);
      expect(commonAir[uid]?.key ?? []).toEqual([]);
      expect(commonAir[uid]?.content ?? '').not.toContain('<数据>');
    }
  });

  it('苏盟 282 项启用武备 100% 挂接《通用·*》科技（零空 need_tech/prereqs），且苏联武备严禁出现辐射工兵与疯狂伊文', () => {
    const commonBooks = [
      '通用·人员_世界书.json',
      '通用·装备_世界书.json',
      '通用·陆地载具_世界书.json',
      '通用·空中载具_世界书.json',
      '通用·水面舰艇_世界书.json',
      '通用·工业基础_世界书.json',
      '通用·防御辅助_世界书.json',
      '通用·航天工业_世界书.json',
      '通用·科技_世界书.json',
      '通用·环保与公共设施_世界书.json',
      '通用·农畜业_世界书.json',
    ];
    const commonTechRefs = new Set<string>();
    for (const file of commonBooks) {
      for (const e of Object.values(readBook(file).entries)) {
        if (e.disable) continue;
        const d = extractData(e.content);
        if (d?.type !== 'research') continue;
        const cname =
          typeof d.name === 'string' && d.name.trim()
            ? d.name.trim()
            : (e.comment || '').replace(/^\d+·/u, '').split('／')[0].trim();
        if (cname) commonTechRefs.add(cname);
        if (typeof d.id === 'string') commonTechRefs.add(d.id);
        for (const a of (d.aliases as string[] | undefined) ?? []) commonTechRefs.add(a);
      }
    }

    for (const file of ['武备·盟军_世界书.json', '武备·苏联_世界书.json']) {
      const raw = readFileSync(resolve(wbDir, file), 'utf8');
      if (file === '武备·苏联_世界书.json') {
        expect(raw).not.toContain('辐射工兵');
        expect(raw).not.toContain('疯狂伊文');
      }
      const book = JSON.parse(raw) as ReturnType<typeof readBook>;
      for (const e of Object.values(book.entries)) {
        if (e.disable) {
          expect(e.key ?? []).toEqual([]);
          expect(e.content ?? '').not.toContain('<数据>');
          continue;
        }
        const d = extractData(e.content);
        if (d?.type !== 'production') continue;
        const prereqs = (d.prereqs as string[] | undefined) ?? [];
        const needTech = (d.need_tech as string[] | undefined) ?? [];
        expect(prereqs.length, `${file} UID=${e.uid} prereqs 不可为空`).toBeGreaterThan(0);
        expect(needTech.length, `${file} UID=${e.uid} need_tech 不可为空`).toBeGreaterThan(0);
        expect(
          needTech.some(t => commonTechRefs.has(t)),
          `${file} UID=${e.uid} (${String(d.name)}) 必须至少挂接 1 项《通用·*》科技`,
        ).toBe(true);
      }
    }
  });

  it('FD-50：三阵营 5 台新增车载小超武与伴随供能/热沉车世界书定义完整，且 buildMobileSuperweaponSynergyHints 准确区分单车态与驻锄并网态', () => {
    const ally = readBook('武备·盟军_世界书.json').entries;
    const sov = readBook('武备·苏联_世界书.json').entries;
    const yuri = readBook('武备·尤里_世界书.json').entries;

    expect(extractData(ally['195']?.content ?? '')?.id).toBe('ally.unit.support.mobile_gap_generator');
    expect(extractData(sov['175']?.content ?? '')?.id).toBe('sov.unit.support.superconducting_pulse_power_vehicle');
    expect(extractData(sov['176']?.content ?? '')?.id).toBe('sov.unit.support.mobile_iron_curtain_emitter');
    expect(extractData(sov['177']?.content ?? '')?.id).toBe('sov.unit.support.magnetic_singularity_suppressor');
    expect(extractData(yuri['31']?.content ?? '')?.id).toBe('yuri.unit.support.mobile_genetic_mutator_vehicle');

    // 验证简称等价解析
    expect(resolveUnitEquivalentCandidates('机动裂缝产生车')).toContain('全频段机动裂缝遮蔽车');
    expect(resolveUnitEquivalentCandidates('机动铁幕车')).toContain('机动铁幕伴随投射车');
    expect(resolveUnitEquivalentCandidates('基因突变共振车')).toContain('机动基因谐振突变车');

    // 单车受限态（无伴随供能/热沉车）
    const soloHints = buildMobileSuperweaponSynergyHints([
      '全频段机动裂缝遮蔽车 ×1',
      '机动铁幕伴随投射车 ×1',
      '机动基因谐振突变车 ×1',
    ]);
    expect(soloHints).toHaveLength(3);
    expect(soloHints[0]).toContain('☆ [战术小超武单车受限]');
    expect(soloHints[0]).toContain('野战移动式核能供电保障车');
    expect(soloHints[1]).toContain('☆ [战术小超武单车受限]');
    expect(soloHints[1]).toContain('野战超导磁能脉冲供能车');
    expect(soloHints[2]).toContain('☆ [战术小超武单车受限]');
    expect(soloHints[2]).toContain('牧羊人脑波中继与湿件抢修工程车');

    // 驻锄并网就绪态（配齐伴随供能/热沉车）
    const pairedHints = buildMobileSuperweaponSynergyHints([
      '全频段机动裂缝遮蔽车 ×1',
      '战术人工气象调控车 ×1',
      '野战移动式核能供电保障车 ×1',
      '机动铁幕伴随投射车 ×1',
      '地锚式磁锁与电磁奇点压制车 ×1',
      '野战超导磁能脉冲供能车 ×1',
      '精神控制车 ×1',
      '机动基因谐振突变车 ×1',
      '牧羊人脑波中继与湿件抢修工程车 ×1',
    ]);
    expect(pairedHints).toHaveLength(3);
    expect(pairedHints[0]).toContain('★ [战术小超武车组并网就绪]');
    expect(pairedHints[0]).toContain('2.5–3km战区全频段电磁与光学黑障穹顶');
    expect(pairedHints[1]).toContain('★ [战术小超武车组并网就绪]');
    expect(pairedHints[1]).toContain('半径150m内4–6台重型装甲集群贴体铁幕赋盾');
    expect(pairedHints[2]).toContain('★ [战术小超武车组并网就绪]');
    expect(pairedHints[2]).toContain('半径180m双螺旋崩解—狂兽化诱导风暴');
  });
});

