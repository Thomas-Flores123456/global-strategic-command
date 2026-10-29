/**
 * engCommonWorldbook.test.ts —— V2-08 《工程·通用》书落地 + 空间站 project 块 + 旧路径退场
 *
 * 真源：docs/project/plans/仓段化V2设计案-草案.md §3.1/§8（D-C5 新开《工程·通用》/D-C6 空间站升格
 * 仓段化工程·uid35 摘数据块·catalog/ConsoleBuildGrid 旧路径关闭）；docs/project/plans/
 * 工程玩法MVP任务包.md §9.1 V2-08 卡（V2-06/V2-07 回执边界：引擎与 UI 已冻结，本卡只落数据）。
 *
 * 覆盖：
 * 1. 新书结构：uid0 总则 / uid1 空间站 project 块 / uid2 禁用 SVG 资产条目（uid24 格式先例）；
 * 2. 资产入书逐字节一致性：uid2.content === tests/fixtures/eng-scene-station-asset.svg（sha256 钉死）；
 * 3. 真实书解析全链：parseWorldbookEntries → catalog.projects（零诊断）→ worldbookProjectToDef →
 *    startProjectV2 直喂（三门实证：资格=空间站建造工学/注资=根模块 core 扣账；拒绝路径 fail-closed）；
 *    模块拓扑 core/hab/lab/solar/dock 与 fixture 热点 module:<id> 绑定逐字一致；
 * 4. engSceneAsset 跨书路由 × 真实书名数据真实性（getWorldbook 直读真实《工程·通用_世界书.json》）；
 * 5. uid35 退场：数据块摘除、叙事保留并指向工程玩法立项；全书 36 条目 sha256 改前改后比对——
 *    唯一差异 = uid35（退场差异注记：PRE 快照取自改前文件，其余 35 条现值必须仍等于 PRE）；
 * 6. 代码侧旧路径关闭：catalog 静态「空间站」建造项移除、空间站建造工学 unlocks 指向工程立项、
 *    ConsoleBuildGrid 巨构关键词名单不再收录「空间站」（一键建造双轨关闭）。
 *
 * 工程口径：node 模块走动态 import + import.meta.url（engSceneStation.test.ts 同款，tsc 基线零新增）；
 * 世界书红线（A0/任务包 §0.5）：本测试只读世界书与源码文件，零写操作。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试读真实世界书与 fixture，不进 bundle（engSceneStation 同口径） */
interface NodeFsLike {
  readFileSync(path: URL, encoding: 'utf8'): string;
}
interface NodeCryptoLike {
  createHash(algorithm: 'sha256'): { update(data: string, encoding: 'utf8'): { digest(format: 'hex'): string } };
}
const nodeFs: Promise<NodeFsLike> = import('node:' + 'fs') as unknown as Promise<NodeFsLike>;
const nodeCrypto: Promise<NodeCryptoLike> = import('node:' + 'crypto') as unknown as Promise<NodeCryptoLike>;
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { parseWorldbookEntries, type ParsedWorldbookCatalog } from '../models/worldbookCatalogParser';
import { worldbookProjectToDef } from '../../红警指挥系统/core/catalogEffective';
import { BUILDINGS, RESEARCHES } from '../../红警指挥系统/core/catalog';
import { isProjectV2, type Project } from '../../红警指挥系统/core/schema';
import {
  startProjectV2,
  type ProjectQueueItem,
  type ProjectStateView,
} from '../../红警指挥系统/engines/projectEngine';
import { parseSceneAssetEntry, assetEntryName, listViews } from '../models/engScene';
import { ENGINE_COMMON_WORLDBOOK, SCENE_ASSET_WORLDBOOK, loadSceneAsset } from '../models/engSceneAsset';

/* ═══════════════ 真实文件装载（懒加载 memo，全部只读） ═══════════════ */

const COMMON_WB_URL = new URL('../../../../worldbooks/工程·通用_世界书.json', import.meta.url);
const AERO_WB_URL = new URL('../../../../worldbooks/通用·航天工业_世界书.json', import.meta.url);
const ALLY_WB_URL = new URL('../../../../worldbooks/工程·盟军_世界书.json', import.meta.url);
const STATION_SVG_URL = new URL('../../../../tests/fixtures/eng-scene-station-asset.svg', import.meta.url);
const STATION_FIXTURE_URL = new URL('../../../../tests/fixtures/eng-scene-station-asset.json', import.meta.url);
const BUILD_GRID_SFC_URL = new URL('../console/ConsoleBuildGrid.vue', import.meta.url);

type WbShape = { entries: Record<string, Record<string, unknown>> };
interface StationFixtureShape {
  name: string;
  comment: string;
  disable: boolean;
  content: string;
}

interface Ctx {
  sha256: (s: string) => string;
  stationSvg: string;
  stationSvgSha: string;
  stationFixture: StationFixtureShape;
  commonWb: WbShape;
  aeroWb: WbShape;
  allyWb: WbShape;
  buildGridSfc: string;
}

let ctxCache: Ctx | undefined;
async function loadCtx(): Promise<Ctx> {
  if (ctxCache) return ctxCache;
  const fs = await nodeFs;
  const crypto = await nodeCrypto;
  const sha256 = (s: string): string => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const stationSvg = fs.readFileSync(STATION_SVG_URL, 'utf8');
  ctxCache = {
    sha256,
    stationSvg,
    stationSvgSha: sha256(stationSvg),
    stationFixture: JSON.parse(fs.readFileSync(STATION_FIXTURE_URL, 'utf8')) as StationFixtureShape,
    commonWb: JSON.parse(fs.readFileSync(COMMON_WB_URL, 'utf8')) as WbShape,
    aeroWb: JSON.parse(fs.readFileSync(AERO_WB_URL, 'utf8')) as WbShape,
    allyWb: JSON.parse(fs.readFileSync(ALLY_WB_URL, 'utf8')) as WbShape,
    buildGridSfc: fs.readFileSync(BUILD_GRID_SFC_URL, 'utf8'),
  };
  return ctxCache;
}

/** V2-08 任务卡口径（D-C6：600k 总造价拆舱段；模块 id 与 fixture 热点绑定逐字一致） */
const STATION_MODULE_SPEC = [
  { id: 'core', name: '核心舱', cost: 200000, days: 30, min_days: 15, prereqs: [] as string[] },
  { id: 'hab', name: '居住舱', cost: 120000, days: 18, min_days: 9, prereqs: ['core'] },
  { id: 'lab', name: '实验舱', cost: 130000, days: 20, min_days: 10, prereqs: ['core'] },
  { id: 'solar', name: '太阳能翼', cost: 60000, days: 12, min_days: 6, prereqs: ['core'] },
  { id: 'dock', name: '对接口', cost: 90000, days: 15, min_days: 8, prereqs: ['core'] },
] as const;

/* ═══════════════ 1. 《工程·通用》书结构 ═══════════════ */

describe('V2-08 · 《工程·通用》书结构（uid0/uid1/uid2 及通用巨构群）', () => {
  it('包含 uid 0..8 共 9 条目（uid0 总则 + uid1 空间站 + uid2 SVG资产 + uid3..8 六座通用仓段化巨构）', async () => {
    const { commonWb } = await loadCtx();
    expect(Object.keys(commonWb.entries)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8']);
  });

  it('uid0 总则：书定位（阵营中立巨构工程与场景资产）+ 触发键「工程·通用/巨构/空间站」类 + 默认随工程系统关闭（disable=true）', async () => {
    const { commonWb } = await loadCtx();
    const e = commonWb.entries['0'];
    expect(e['uid']).toBe(0);
    expect(e['comment']).toBe('01·工程·通用总则');
    expect(e['key']).toEqual(expect.arrayContaining(['工程·通用', '通用工程', '巨构', '空间站']));
    expect(e['selective']).toBe(false);
    expect(e['disable']).toBe(true);
    expect(e['order']).toBe(50000);
    const content = e['content'] as string;
    expect(content).toContain('阵营中立');
    expect(content).toContain('战略巨构工程');
    expect(content).toMatch(/拓扑注资/);
  });

  it('uid1 空间站 project 条目：comment 标注仓段化工程，key 主词「轨道空间站」，默认随工程系统关闭（disable=true）', async () => {
    const { commonWb } = await loadCtx();
    const e = commonWb.entries['1'];
    expect(e['uid']).toBe(1);
    expect(e['comment']).toBe('02·轨道空间站（仓段化工程）');
    expect(e['key']).toEqual(['轨道空间站', '空间站工程']);
    expect(e['disable']).toBe(true);
    expect(e['order']).toBe(50001);
    expect(e['content']).toMatch(/^\[工程·通用 \| 轨道空间站\]/);
  });

  it('uid2 资产条目：⚠SVG资产·轨道空间站·勿启用 · disable=true · key 空 · name 字段（uid24 先例，双名探测依赖）', async () => {
    const { commonWb } = await loadCtx();
    const e = commonWb.entries['2'];
    expect(e['uid']).toBe(2);
    expect(e['comment']).toBe('⚠SVG资产·轨道空间站·勿启用');
    expect(e['name']).toBe('⚠SVG资产·轨道空间站·勿启用');
    expect(e['key']).toEqual([]);
    expect(e['disable']).toBe(true);
    expect(e['selective']).toBe(false); // 盟军 uid24 同款：禁用资产条目不参与激活
    expect(e['order']).toBe(50002);
  });

  it('uid2 与盟军 uid24 资产条目格式先例同构（字段齐全 + name 尾随）', async () => {
    const { commonWb, allyWb } = await loadCtx();
    const precedent = allyWb.entries['24'];
    const e = commonWb.entries['2'];
    for (const field of Object.keys(precedent)) {
      expect(e[field], `uid2 缺先例字段 ${field}`).toBeDefined();
    }
  });
});

/* ═══════════════ 2. 资产入书逐字节一致性 ═══════════════ */

describe('V2-08 · 资产入书逐字节一致性（uid2 ↔ V2-06 fixture）', () => {
  it('uid2.content === fixtures/eng-scene-station-asset.svg 正文（sha256 钉死）', async () => {
    const { commonWb, stationSvg, stationSvgSha } = await loadCtx();
    const content = commonWb.entries['2']['content'] as string;
    expect(content).toBe(stationSvg);
    expect(stationSvgSha).toBe('e8fb0272c4d406571d3e4a7bdaecedd85dded34579f22f1b462f1dd86811ee8e');
  });

  it('fixture 模板（V2-06 产出）与入书条目同名同向：name 一致、content 一致', async () => {
    const { commonWb, stationFixture } = await loadCtx();
    expect(stationFixture.name).toBe(assetEntryName('轨道空间站'));
    expect(stationFixture.disable).toBe(true);
    expect(commonWb.entries['2']['content']).toBe(stationFixture.content);
  });
});

/* ═══════════════ 3. 真实书解析全链（parser → def → 引擎直喂） ═══════════════ */

describe('V2-08 · 真实《工程·通用》书解析进 catalog.projects', () => {
  it('projects 桶包含轨道空间站与通用巨构（共 7 块）、零诊断（uid2 资产条目无数据块，不产生噪音）', async () => {
    const { commonWb } = await loadCtx();
    const catalog: ParsedWorldbookCatalog = parseWorldbookEntries(commonWb, { silent: true });
    expect(catalog.projects.length).toBeGreaterThanOrEqual(1);
    expect(catalog.projects.some(p => p.id === 'common.project.orbital_station')).toBe(true);
    expect(catalog.diagnostics).toHaveLength(0);
    expect(catalog.buildings).toHaveLength(0);
  });

  it('project 块字段逐项对齐任务卡：schema_version 2 / id / name / grade / scene / requirements', async () => {
    const { commonWb } = await loadCtx();
    const p = parseWorldbookEntries(commonWb, { silent: true }).projects[0];
    expect(p.schema_version).toBe(2);
    expect(p.type).toBe('project');
    expect(p.id).toBe('common.project.orbital_station');
    expect(p.name).toBe('轨道空间站');
    expect(p.grade).toBe('巨构');
    expect(p.scene).toBe('scene.station.orbital');
    expect(p.requirements).toEqual({ research: '空间站建造工学', credits: 600000, nanites: 20000 });
  });

  it('modules 五仓段：id/name/cost/workload/prereqs 逐项对齐（裸 id 与 fixture 热点绑定逐字一致）', async () => {
    const { commonWb } = await loadCtx();
    const p = parseWorldbookEntries(commonWb, { silent: true }).projects[0];
    expect(p.modules).toHaveLength(5);
    STATION_MODULE_SPEC.forEach((spec, i) => {
      expect(p.modules[i].id).toBe(spec.id);
      expect(p.modules[i].name).toBe(spec.name);
      expect(p.modules[i].cost).toBe(spec.cost);
      expect(p.modules[i].workload).toEqual({ days: spec.days, min_days: spec.min_days });
      expect(p.modules[i].prereqs).toEqual(spec.prereqs);
    });
    // D-C6：600k 总造价拆舱段（模块 cost 合计 = requirements.credits）
    const sum = p.modules.reduce((s, m) => s + (m.cost ?? 0), 0);
    expect(sum).toBe(600000);
  });

  it('模块拓扑与 fixture 热点绑定一致：module:<id> 热点集合 === modules[].id 集合（core 唯一根）', async () => {
    const { commonWb, stationSvg } = await loadCtx();
    const scene = parseSceneAssetEntry(stationSvg, '轨道空间站');
    expect(scene).not.toBeNull();
    const boundIds = scene!.hotspots
      .map(h => h.target)
      .filter((t): t is { kind: 'module'; id: string } => !!t && t.kind === 'module')
      .map(t => t.id);
    expect([...boundIds].sort()).toEqual([...STATION_MODULE_SPEC.map(m => m.id)].sort());
    const p = parseWorldbookEntries(commonWb, { silent: true }).projects[0];
    expect(p.modules.filter(m => m.prereqs.length === 0).map(m => m.id)).toEqual(['core']);
  });
});

describe('V2-08 · worldbookProjectToDef → startProjectV2 直喂全链', () => {
  interface TestState extends ProjectStateView {
    queues: ProjectQueueItem[];
    projects?: Project[];
  }

  /** 单基地：一座运转中航天发射中心（eng.orbital 锚定建筑 → 属地容量 1）、科技就位、资金足额 */
  function mkState(overrides: Partial<TestState> = {}): TestState {
    return {
      tech: { done: ['空间站建造工学'] },
      economy: { credits: 1000000, resources: { nanites: { 标准纳米工料: 50000, 高精构型纳米: null } } },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
      queues: [],
      projects: [],
      ...overrides,
    };
  }

  it('worldbookProjectToDef：kind project、grade 巨构、modules 逐字段透传（startProjectV2 直喂口径）', async () => {
    const { commonWb } = await loadCtx();
    const def = worldbookProjectToDef(parseWorldbookEntries(commonWb, { silent: true }).projects[0]);
    expect(def.kind).toBe('project');
    expect(def.name).toBe('轨道空间站');
    expect(def.grade).toBe('巨构');
    expect(def.modules).toHaveLength(5);
    expect(def.requirements?.research).toBe('空间站建造工学');
  });

  it('立项成功：实例 proj:轨道空间站@beipo、根模块 core 进行中、首根注资 200000 扣账、投影 lane=eng:eng.orbital', async () => {
    const { commonWb } = await loadCtx();
    const def = worldbookProjectToDef(parseWorldbookEntries(commonWb, { silent: true }).projects[0]);
    const r = startProjectV2(mkState(), def, { base: 'beipo' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message);
    expect(r.projectId).toBe('proj:轨道空间站@beipo');
    const proj = r.next.projects?.[r.next.projects.length - 1];
    expect(proj?.ref).toBe('轨道空间站');
    // V1|V2 联合收窄（isProjectV2 守卫）
    if (!proj || !isProjectV2(proj)) throw new Error('应为 V2 工程');
    expect(proj.modules.map(m => `${m.id}:${m.status}`)).toEqual([
      'core:进行中',
      'hab:未启动',
      'lab:未启动',
      'solar:未启动',
      'dock:未启动',
    ]);
    // 首根注资扣账（V1「立项即注资 phase0」同语义）
    expect(r.next.economy?.credits).toBe(1000000 - 200000);
    // 投影项：命名合同 ref·模块名；V2 专属槽 lane
    const q = r.next.queues[r.next.queues.length - 1] as ProjectQueueItem;
    expect(q.type).toBe('工程');
    expect(q.item).toBe('轨道空间站·核心舱');
    expect(q.lane).toBe('eng:eng.orbital');
    expect(q.base).toBe('beipo'); // 投影属地 = lead_base（Base.id 口径，moduleBase 默认链）
    expect(q.min_days_lock).toBe(15);
    expect(q.total_minutes).toBe(30 * 1440);
  });

  it('资格门实证：tech.done 无「空间站建造工学」→ research_gate 拒立项（fail-closed）', async () => {
    const { commonWb } = await loadCtx();
    const def = worldbookProjectToDef(parseWorldbookEntries(commonWb, { silent: true }).projects[0]);
    const r = startProjectV2(mkState({ tech: { done: [] } }), def, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('应拒立项');
    expect(r.reason).toBe('research_gate');
    expect(r.message).toContain('空间站建造工学');
  });

  it('注资门实证：可用资金 100000 < 根模块 200000 → funds 拒立项（工程不暴毙口径）', async () => {
    const { commonWb } = await loadCtx();
    const def = worldbookProjectToDef(parseWorldbookEntries(commonWb, { silent: true }).projects[0]);
    const r = startProjectV2(mkState({ economy: { credits: 100000 } }), def, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('应拒立项');
    expect(r.reason).toBe('funds');
  });
});

/* ═══════════════ 4. engSceneAsset 跨书路由 × 真实书数据真实性 ═══════════════ */

describe('V2-08 · engSceneAsset 跨书路由命中真实书名（数据真实性，非 mock 引擎）', () => {
  /** getWorldbook 直读真实文件：酒馆导入口径书名带 `_世界书` 后缀（ENG-RM-01 双口径） */
  async function realHost(name: string): Promise<unknown> {
    const { commonWb, allyWb } = await loadCtx();
    if (name === '工程·通用') throw new Error(`未能找到世界书 '${name}'`); // 裸名探测失败 → 后缀名
    if (name === `${ENGINE_COMMON_WORLDBOOK}_世界书`) return Object.values(commonWb.entries);
    if (name === SCENE_ASSET_WORLDBOOK || name === `${SCENE_ASSET_WORLDBOOK}_世界书`) {
      return Object.values(allyWb.entries);
    }
    throw new Error(`未能找到世界书 '${name}'`);
  }

  it('真实《工程·通用_世界书》条目命中：三视角 × 热点齐全的 worldbook 场景（scene.station.orbital 路由）', async () => {
    const calls: string[] = [];
    const def = await loadSceneAsset('轨道空间站', {
      getWorldbook: (name: string) => {
        calls.push(name);
        return realHost(name);
      },
    }, 'scene.station.orbital');
    expect(def?.source).toBe('worldbook');
    expect(def?.id).toBe('scene.station.orbital');
    expect(def?.title).toBe('轨道空间站');
    expect(listViews(def!).map(v => v.id)).toEqual(['overview', 'section', 'dock']);
    expect(def!.hotspots.map(h => h.id)).toEqual(['core', 'hab', 'lab', 'solar', 'dock', 'cupola']);
    // 书序即优先级：专属命中即止，不落《工程·盟军》
    expect(calls).toEqual(['工程·通用', '工程·通用_世界书']);
  });

  it('未路由 sceneId（缺省口径）不读《工程·通用》：盟军命中序不变，续探《工程·苏联》双名容错跳过（SU-01）', async () => {
    const calls: string[] = [];
    const def = await loadSceneAsset('灰熊坦克现代化改装工程', {
      getWorldbook: (name: string) => {
        calls.push(name);
        return realHost(name);
      },
    });
    expect(def?.source).toBe('worldbook'); // 盟军 uid24 通用资产回退命中（D23；书序优先级不变）
    expect(calls.some(c => c.includes(ENGINE_COMMON_WORLDBOOK))).toBe(false); // 不读《工程·通用》（语义保持）
    // 缺省双书清单（SU-01）：盟军裸名命中即止，苏联双名随后探（真机未装书 → 容错跳过不报错）
    expect(calls).toEqual(['工程·盟军', '工程·苏联', '工程·苏联_世界书']);
  });
});

/* ═══════════════ 5. uid35 退场 + 全书零扰动 ═══════════════ */

/**
 * 改前（2026-10-12 退场前）逐条目 sha256 快照：JSON.stringify(entry) 的 sha256。
 * 退场差异注记：uid35 = 唯一授权改动（摘 <数据> 块 + 建造句改指向工程玩法立项），
 * 其余 35 条现值必须逐字节等于 PRE；uid35 现值钉 POST（后续合法改动须显式更新本表）。
 */
const AERO_PRE_SHA: Record<string, string> = {
  '0': '8621304b5ac99b83def6705671dfb791c8cd5f04024267186cdf3ff1462bf1d7',
  '1': 'a1669ed1427edae57cec0e89f666094d069633948d5dc22af0eba02c90efcaa2',
  '2': '9f7ddaf31f4bd795c4ccb680c76eb81dea90e76ce1e1bfe4a8cf838ee3f1d500',
  '3': 'd494587eb5dd71911b7ff940e97e7b342efde5bb8fa54623fc8b3c29b1c51da2',
  '4': '3132b0821fe9f19a63953578e4fc6ccedd1e7c09f3efbbf63e1b2a9c47a432b3',
  '5': '4cf9d8ec6c4811a2fa5b91ce4515ef2bb3ae2bfe52b8adf3cc4e1d0e62e6f8cc',
  '6': '437f66f9aafcfeaed138b488ff945dad3b8663cc2733e74eca594212877a30f2',
  '7': '90c3d8a839bba7824b84e8689869d225d5dc760b36bd493d4a585dbf59b0e389',
  '8': '063cbba2b5f0426d3fef95c1f0071c53ac5b6e713557bd1f783f433a74984345',
  '9': '3697df442f2adffed9815a099cc9ecb24208a9ed5983ac7cfe94dbf811c2f108',
  '10': 'd3e57a18471eb18c598619136eb48728ba46d1c9a2c0f490f09aa9414f3a8d1a',
  '11': '7fc6069a64ea4981d04aafcea2abef8d56faa02424f6e5606c5d1f7429323945',
  '12': '1e9772f2f4c4ffee3b401e9ffe587f2c194323961ce225848e4da1a791a6fb2f',
  '13': '9d1a8bf474867f62b471a1c0932045236c83ea2a6505aaee126e70d1784eafce',
  '14': '6040178146c455958923126b57c501bb94380c3a44e6610e2efa2b81c74229c6',
  '15': 'b2e9d824e8ff413ced54d590407b48c6e1069bb9157c125da6af783bd77ce5a6',
  '16': 'ea690b22d383c43b56d07d5dd65b33dd819993eacccd13126713a72627ab6581',
  '17': '207c75078bc3b6acc8a4713222e75c441308da9d6c7c95bacdd2cf735bb3a482',
  '18': '3e780aa8e2f83c8b1557b0427444a486a5e7de5fa702d79c53d0a225ce08fad1',
  '19': '8b84c51af9e79104add8dc71d0eeb12705867e252011afb5cbbb06dbe5d33a00',
  '20': '9370287228f694c085657a450acda25a0187fe4cbdf57f187c4e67da41d8fb58',
  '21': '552f755d9f531a9c4d99d63aaaa7256d4248f84e873b9b9f3a09eaf15ef90622',
  '22': '0419f5b2819155d27d93ade71d1956c91540a3745ff04bec74d2cdf7db740ffd',
  '23': '17a241e50347de86c6f742ae9469e4989015747317a725ce2e315c14369355b2',
  '24': '1d70f4ab2a7c6b75139c0be881bc7f8f02517e76515ba658cd6448337acf5ae9',
  '25': '3f7e39f94021b5b73dd414758465e51684490923c6d11381a03eb7442335b645',
  '26': '7f789d472342cb4eb21823fb7ebde21b6d2ef39ba52cb85568d6c1872c5c51ea',
  '27': 'b407275764cc3542d8cb044a196f2bb0d4c72d34fcf2b2f3183948ce90b0c73a',
  '28': '4fa927e90496b55e7e9514fdba46ba7fd9d40de09cedbd5681897f7c2bb9e188',
  '29': 'd58890d45ca7043fe7fc43a8b23d8df884a99a209bc8672cb72c0acac272d0c2',
  '30': '1b706e98c2751cf0be576fa6023eedcf29b6112b69089c418d35baa565216621',
  '31': '32bc0fc7258d15e1d8fbaef72302250a95293e7a1ee60c404b055f0340940e72',
  '32': '83daf9add51c2b5fa3a1a88b1b27abf5a7edce46ca5c5a415eddad2159ad4f32',
  '33': '6db30388d197a0f65b44815cf365dc98188ea07ba6cba6c77f8f6a9eb06b7046',
  '34': '18fc51b2888aa9f3816346d2dee71e1e58f7e4f42b0d560710867e03e5cfe4bc',
  '35': 'f091592fd71ba17954b2f455269df49371df1229a087df527c8583e888a41737',
  '36': 'f285480e3c33a2a951ff63dbe45b9228e5e2fa37dd835c5e9eb5a1fecf044ab2',
  '37': '9617eef848025ced8826d071cb8bcdbbb2ac4ee9d9d9ec798fa4a59702f67365',
  '38': '1da7f53e2f1edc787d3bf2f77a242ad61b1b22032bfcb1d78fa378c50d26cfbb',
  '39': '07bbe0d0fcedc31161f2546439edadc5fbdbe02331516698c6e9baae0372872d',
  '40': '91ef5a6c3dddf382f5db43d569b252c385238496c014fde819b1cbad47de1139',
  '41': '05aea07288c08e8c8d5d49c7c8f65203351dce0b87b5008235409802f57411de',
  '42': '62ab2b4a846cae2691de38262a6ab557b18a898cb9dd961e67864d095d5701c9',
  '43': '8905f4c6d9f3c269b25a66b3f77e034b8b9034a47c7d8953958d096e421f2734',
  '44': 'd86a9b97b6f15448817f57bba0bdc3677503dc230e089da94eb6d75913dedd92',
  '45': 'cf099f540717cd2088332b0595fdb54e3c1964652449c808ff1456659342e5e8',
  '46': '39b5bc8de2bdcabaf136b711ebb9bdab05b844349744927f99efe5584c60a9d6',
  '47': '058c1a79d51495d43502676e2ea53bf2a4b0ff6a1bc51a3b3c7ae4bffb4cae51',
  '48': '22f4a6538a3daca161baebd710daaca1a1c565f2550cf5f89202814d0b67010d',
  '49': '9e1ee2c38fbe7ba7ff723584b5e3788ff7f2d6d27032971282a5608ad4f8f473',
  '50': '18337cf0f126cbd346c24b8b4aa1d3613455677360f7320343b27d7f33268304',
  '51': 'a8f73d44e67ad8cd0842723dd04e8b3eb6cb8cfef74d90e7fff01e5d70d327b6',
  '52': '8adba000fd6d9f4b5e7c30a1f6dece914c5c191b77c27c57de4218573135f83c',
  '53': 'ae17151c3aa03010aa71780428255acfe92fc1d45ea65f70281f4585cde36f98',
  '54': '220578b85e17da4cb1586594980acb97424051a05881666d73245fdac7c7b6c6',
  '55': '923edefb7aee2fcb772896c861d39b2fdb3a74f9a5ba8a80950e8b6a53821148',
  '56': '25eacee667cfc02dccc747cfb426798f56968ec1ac0c4040d6efff1b908eea1f',
  '57': 'f93d32f2e2218cad7e39418002974b527b2d5f006e03ee44aac65994d108e08f',
  '58': 'c81cba7620465214c4c4b63cbd1f76dd9bb3905982af87f4493c374d7285ad35',
  '59': '1106a257294c32c2de9f4297838fe5060b6e972cb8483df93a9490facae145e7',
  '60': '8397e91e4d289482d444d1111eacd3420593b5d0c80ce19a8e3e6da485c7bbbf',
  '61': '2184fc21039fd52539c5dee5309c4bdaa169101a780ece65e0b7a1fdfbc350ec',
};
const AERO_UID35_POST_SHA = '69a84d1b6cc313e8c0afc39216f34ec5ddd8ba19b1b4ec6704b6a97f3add72ee';

describe('V2-08 · uid35 退场（通用·航天工业_世界书.json）', () => {
  it('uid35：building 块已升格为 project 块；叙事保留且指向仓段化工程立项', async () => {
    const { aeroWb } = await loadCtx();
    const e = aeroWb.entries['35'];
    const content = e['content'] as string;
    expect(content.includes('"type": "building"')).toBe(false);
    expect(content.includes('"type": "project"')).toBe(true);
    // 叙事保留（任务卡：叙事文字保留）
    expect(content).toMatch(/^\[通用·航天工业 \| 空间站\]/);
    expect(content).toContain('分模块发射、在轨交会对接组装的常驻天基设施');
    expect(content).toContain('地月投送验证的前提');
    // 建造句指向工程立项（D-C6）
    expect(content).not.toContain('建造费为累计');
    expect(content).toContain('仓段化工程立项');
    // 元数据（key/comment 保持，disable 默认随工程系统关闭为 true）
    expect(e['key']).toEqual(['空间站']);
    expect(e['comment']).toBe('36·空间站');
    expect(e['disable']).toBe(true);
  });

  it('round-trip：uid0..35 零诊断、buildings 桶无「空间站」机器块、研究项不受扰动', async () => {
    const { aeroWb } = await loadCtx();
    const catalog = parseWorldbookEntries(aeroWb, { silent: true });
    expect(catalog.diagnostics.every(d => !JSON.stringify(d).includes('空间站'))).toBe(true);
    expect(catalog.buildings.some(b => b.id === '空间站' || b.name === '空间站')).toBe(false);
    expect(catalog.researches.some(r => r.id === '空间站建造工学')).toBe(true);
  });

  it('其余条目逐字节零扰动：原 42 条（除 uid35 外）sha256 === 改前快照；新增制造装备条目 uid43..61 合法', async () => {
    const { aeroWb, sha256 } = await loadCtx();
    expect(Object.keys(aeroWb.entries)).toHaveLength(62);
    const diffsVsPre: string[] = [];
    for (const [k, e] of Object.entries(aeroWb.entries)) {
      const uidNum = Number(k);
      if (uidNum >= 43 && uidNum <= 65) {
        expect(e).toBeDefined();
        continue;
      }
      const h = sha256(JSON.stringify(e));
      if (k === '35') {
        expect(e['disable']).toBe(true); // 随工程系统默认关闭
        expect(h).not.toBe(AERO_PRE_SHA['35']); // 证明确实发生退场（改前值见快照）
      } else {
        expect(AERO_PRE_SHA[k], `uid${k} 未在改前快照登记`).toBeDefined();
        if (h !== AERO_PRE_SHA[k]) diffsVsPre.push(k);
      }
    }
    expect(diffsVsPre).toEqual([]); // 除 uid35 外零漂移
  });
});

/* ═══════════════ 6. 代码侧旧路径关闭 ═══════════════ */

describe('V2-08 · 代码侧旧路径关闭（一键建造双轨拆除）', () => {
  it('catalog 静态 BUILDINGS 无「空间站」建造项', () => {
    expect(BUILDINGS.some(b => b.name === '空间站')).toBe(false);
  });

  it('ConsoleBuildGrid 已正式退役「巨构」页签，原截胡建筑按一级主领域自然分桶，巨构全权交由工程系统承载', async () => {
    const { buildGridSfc } = await loadCtx();
    expect(buildGridSfc).toContain('grid-cols-5');
    expect(buildGridSfc).not.toMatch(/cat\s*===\s*'巨构'|cat:\s*'巨构'/);
  });
});
