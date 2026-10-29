/**
 * engSovietWorldbook.test.ts —— SU-01 《工程·苏联》书落地 + 协议共用 uid25 中性化
 *
 * 真源：SU-01 实施卡（驾驶员 2026-10-12 冻结：24 项全收、协议共用 uid25+中性化（苏军书不设协议条目）、
 *       锚定零新增、资产镜像）；docs/project/reports/ENG-ECON-01-对账工作表.md（冻结数值模型：
 *       档级基准 cost / 工期阶段×日（lock）/ 纳米开工门 50|150|400 每阶段）；
 *       docs/project/reports/V2-11-对账工作表.md（巨构档模型行，苏军书不涉）。
 *
 * 覆盖：
 * 1. 新书结构：uid0 总则（三契约对齐盟军 uid0）/ uid1-24 retrofit / uid25 禁用 SVG 资产镜像；
 *    全书无协议条目（协议共用盟军 uid25，设计冻结）；
 * 2. 24 块冻结数值对账：cost/阶段×日（lock 档级值域）/纳米门档级/cost 拆分合计/档级分布 5-14-5；
 *    research 名全部落在《特色科技·苏联》name∪aliases（跨书真实文件读，不一致以科技书为准）；
 * 3. 真实书解析全链：parseWorldbookEntries → retrofits=24 零诊断 → worldbookRetrofitToDef →
 *    mergeEffectiveCatalog(RETROFITS 合并 47=23+24) → startProject 资格抽查（科技门过/拒）；
 * 4. 资产镜像逐字节：uid25.content === 盟军 uid24.content；scene id 同 scene.workshop.generic，
 *    parseSceneAssetEntry 直解可用（engSceneAsset 双名探测依赖 name 字段）；
 * 5. uid25 中性化：首行 [工程 | …]（去阵营限定）+ 示例段补苏军立项行（盟军示例旁）；
 *    V2-05 module 键语法与 D-TH-2 键位纪律原文保留；
 * 6. 盟军书零扰动：除 uid25（SU-01 后 POST 钉值）外其余 25 条目 sha256 逐条等于 SU-01 前基线。
 *
 * 工程口径：node 模块走动态 import + import.meta.url（engCommonWorldbook.test.ts 同款，tsc 基线零新增）；
 * 世界书红线（A0/任务包 §0.5）：本测试只读世界书与源码文件，零写操作。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试读真实世界书，不进 bundle（engCommonWorldbook 同口径） */
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
import { mergeEffectiveCatalog, worldbookRetrofitToDef } from '../../红警指挥系统/core/catalogEffective';
import { RETROFITS } from '../../红警指挥系统/core/catalog';
import type { Project } from '../../红警指挥系统/core/schema';
import { startProject, type ProjectQueueItem, type ProjectStateView } from '../../红警指挥系统/engines/projectEngine';
import { parseSceneAssetEntry } from '../models/engScene';
import { GENERIC_ASSET_ENTRY_NAME } from '../models/engSceneAsset';

/* ═══════════════ 真实文件装载（懒加载 memo，全部只读） ═══════════════ */

const SOV_WB_URL = new URL('../../../../worldbooks/工程·苏联_世界书.json', import.meta.url);
const ALLY_WB_URL = new URL('../../../../worldbooks/工程·盟军_世界书.json', import.meta.url);
const SOV_TECH_WB_URL = new URL('../../../../worldbooks/特色科技·苏联_世界书.json', import.meta.url);
const COMMON_TECH_WB_URL = new URL('../../../../worldbooks/通用·科技_世界书.json', import.meta.url);

type WbShape = { entries: Record<string, Record<string, unknown>> };

interface Ctx {
  sha256: (s: string) => string;
  sovWb: WbShape;
  allyWb: WbShape;
  sovTechWb: WbShape;
  sovTechNames: Set<string>;
}

let ctxCache: Ctx | undefined;
async function loadCtx(): Promise<Ctx> {
  if (ctxCache) return ctxCache;
  const fs = await nodeFs;
  const crypto = await nodeCrypto;
  const sha256 = (s: string): string => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  const sovTechWb = JSON.parse(fs.readFileSync(SOV_TECH_WB_URL, 'utf8')) as WbShape;
  const commonTechWb = JSON.parse(fs.readFileSync(COMMON_TECH_WB_URL, 'utf8')) as WbShape;
  // 《特色科技·苏联》与《通用·科技》全部 research 有效名（name∪id∪aliases——对齐校验世界书.mjs 悬空引用口径与 FD-48 通用化归口）
  const sovTechNames = new Set<string>();
  for (const e of [...Object.values(sovTechWb.entries), ...Object.values(commonTechWb.entries)]) {
    const m = (typeof e['content'] === 'string' ? (e['content'] as string) : '').match(/<数据>\s*([\s\S]*?)\s*<\/数据>/);
    if (!m) continue;
    try {
      const d = JSON.parse(m[1]) as Record<string, unknown>;
      if (d['type'] !== 'research') continue;
      if (typeof d['name'] === 'string') sovTechNames.add(d['name']);
      if (typeof d['id'] === 'string') sovTechNames.add(d['id']);
      if (Array.isArray(d['aliases'])) for (const a of d['aliases']) if (typeof a === 'string') sovTechNames.add(a);
    } catch {
      /* 块级 JSON 畸形由科技书自己的门负责，此处跳过 */
    }
  }
  ctxCache = {
    sha256,
    sovWb: JSON.parse(fs.readFileSync(SOV_WB_URL, 'utf8')) as WbShape,
    allyWb: JSON.parse(fs.readFileSync(ALLY_WB_URL, 'utf8')) as WbShape,
    sovTechWb,
    sovTechNames,
  };
  return ctxCache;
}

/** SU-01 附录冻结清单（2026-10-12 驾驶员裁决，箭头=最终冻结值）；days=每阶段日数，lock=min_days，nano=每阶段纳米门 */
const FROZEN: Record<
  string,
  { uid: number; grade: '大改' | '中改' | '小改'; cost: number; days: number; lock: number; nano: number; pn: number; research: string }
> = {
  犀牛坦克现代化改装工程: { uid: 1, grade: '大改', cost: 3000, days: 4, lock: 3, nano: 400, pn: 5, research: '装甲平台深度现代化工学·苏联实现' },
  天启决战装甲系统总装改装: { uid: 2, grade: '大改', cost: 3200, days: 5, lock: 3, nano: 400, pn: 5, research: '天启系统集成与量产认证' },
  基洛夫飞艇武库母舰大改工程: { uid: 3, grade: '大改', cost: 3800, days: 5, lock: 3, nano: 400, pn: 5, research: '空中无人机母舰工学·苏联实现' },
  无畏级重型支援舰巨型发射区改造: { uid: 4, grade: '大改', cost: 4500, days: 6, lock: 3, nano: 400, pn: 4, research: '舰首巨型通用发射区工学' },
  '1144基洛夫级巡洋舰垂发与延役工程': { uid: 5, grade: '大改', cost: 4800, days: 5, lock: 3, nano: 400, pn: 5, research: '分布式海上目标指示工学·苏联实现' },
  '2S19 M1／M2数字化炮兵升级工程': { uid: 6, grade: '中改', cost: 1200, days: 4, lock: 2, nano: 150, pn: 2, research: '数字炮兵火力网工学·苏联实现' },
  'T-72B3M火控与防护现代化改装': { uid: 7, grade: '中改', cost: 1200, days: 4, lock: 2, nano: 150, pn: 2, research: '装甲平台深度现代化工学·苏联实现' },
  'T-90M深度现代化改装工程': { uid: 8, grade: '中改', cost: 1200, days: 3, lock: 2, nano: 150, pn: 3, research: '重装甲正面防护极限工学' },
  'T-80BVM寒区燃气轮机突击改装': { uid: 9, grade: '中改', cost: 1200, days: 4, lock: 2, nano: 150, pn: 2, research: '寒区燃气轮机保障学' },
  'BMP-3步兵战车现代化改装工程': { uid: 10, grade: '中改', cost: 1100, days: 4, lock: 2, nano: 150, pn: 2, research: '装甲平台深度现代化工学·苏联实现' },
  'BTR-EW「火花」战术网电改装工程': { uid: 11, grade: '中改', cost: 1100, days: 3, lock: 2, nano: 150, pn: 2, research: '战区电子战任务编排学' },
  'TOS-1A热压攻坚重装甲强化工程': { uid: 12, grade: '中改', cost: 1200, days: 4, lock: 2, nano: 150, pn: 2, research: '热压攻坚工学' },
  'Su-30SM2航电协同现代化改装': { uid: 13, grade: '中改', cost: 1400, days: 3, lock: 2, nano: 150, pn: 3, research: '苏联韧性杀伤链工学' },
  'Su-34M防区外打击包换装工程': { uid: 14, grade: '中改', cost: 1400, days: 4, lock: 2, nano: 150, pn: 3, research: '防区外空中武库工学' },
  'MiG-31BM高速截击数字化升级': { uid: 15, grade: '中改', cost: 1400, days: 4, lock: 2, nano: 150, pn: 3, research: '多频预警与被动侦收工学' },
  'Ka-52/Mi-28旋翼机光电升级工程': { uid: 16, grade: '中改', cost: 1200, days: 4, lock: 2, nano: 150, pn: 2, research: '苏联韧性杀伤链工学' },
  '1155M大型反潜舰多用途改装工程': { uid: 17, grade: '中改', cost: 1800, days: 4, lock: 2, nano: 150, pn: 3, research: '分布式海上目标指示工学·苏联实现' },
  '971型攻击核潜艇静音多用途改装': { uid: 18, grade: '中改', cost: 2000, days: 4, lock: 2, nano: 150, pn: 3, research: '多用途攻击核潜艇现代化工学' },
  '战区伴随防空自主化改装(铠甲/道尔)': { uid: 19, grade: '中改', cost: 1200, days: 3, lock: 2, nano: 150, pn: 2, research: '地面机动防空指挥工学' },
  'BTR-82A轮式火力升级工程': { uid: 20, grade: '小改', cost: 500, days: 3, lock: 1, nano: 50, pn: 1, research: '装甲平台深度现代化工学·苏联实现' },
  'Tornado-G火箭炮火控现代化工程': { uid: 21, grade: '小改', cost: 500, days: 2, lock: 1, nano: 50, pn: 1, research: '大口径火箭齐射学' },
  恐怖机器人电磁锁止双任务包工程: { uid: 22, grade: '小改', cost: 500, days: 2, lock: 1, nano: 50, pn: 1, research: '感应破坏与磁锁工学' },
  '877型常规潜艇消声瓦与延寿工程': { uid: 23, grade: '小改', cost: 800, days: 3, lock: 1, nano: 50, pn: 1, research: '潜艇隐蔽与静音保障学' },
  无人航空侦察校射数据链工程: { uid: 24, grade: '小改', cost: 600, days: 3, lock: 1, nano: 50, pn: 1, research: '数字炮兵火力网工学·苏联实现' },
};

/** 盟军书逐条目 sha256（JSON.stringify(entry)）：uid0-24 = SU-01 前基线（本卡零扰动钉值）；uid25 = SU-01 中性化后 POST 钉值。 */
const ALLY_SHA: Record<string, string> = {
  '0': '33023e98abd799e33fc1e52415b288bfb05c4ce77a69556e476eb4f2d2e05caa',
  '1': '35582519521391e6fa2d61868fc60592dc5e5b71a21a9bc52569747cad67d71d',
  '2': '8c1c6f371959cbd0ee91647428c89ed02757445b57ec0c3010a57082fd6ffe59',
  '3': '5c454a739839eb8f1ba2bc31b0f714495039826ac5051a68365410a315145dcd',
  '4': 'ef3cb8a4080171588e708bec8662b2d5c5860423a6385433a07d662a1fc2fd3e',
  '5': '2e51247455904bb0d2ae8086fe92e5f63ef377a1ad713708253fc0b5cf95e931',
  '6': '83cb076c60680408066eb0217615c0c113eec3d93220805b61e947821f8575dc',
  '7': 'b27d7a6fbd9f7519f90524f7c4e0df190d227aff589dffd5ca501ae4da1f0e02',
  '8': 'eca816ec9b09153fc2d14fa12f26a5b4321a85752d042b016440c8881980caf1',
  '9': '3b151ea2f1a54b8ba4d0d766a461255421fe16747c4dcad34716054d5e87797f',
  '10': '39285500f859e05d68e9b58b43e7bf7b3b930344405d6b3517048c4cafc48017',
  '11': '563476830e8d7fc937f64e6fd7afb4790d69f4e91cc71fd6ed7764e9c5b1f450',
  '12': 'ce03285d40232337e3034e4b27317775c3e58a31193c59cd371e9b276c9b1645',
  '13': 'eb1b68298b2809930e9fab577c9c792f1f6d8c23bec088400195e2838d8d8fba',
  '14': 'fd1e0113ed000e43211bb517c730514186043e98ca6dda730a4e5ee95e999c19',
  '15': '7444d8896d66497152a18cc6d8d967e8354b8fbd7a3c33b680dbf921e42b48ee',
  '16': '5ce981a440486b9711bc4f10efa89b30cd168a1b3c0d886ad4be5e027f47390b',
  '17': 'a5e640e5b6eff1142bbcb68f4512f5f32d565b00fa822c437988d3a82f6408b7',
  '18': '01ee52e1b2503e35de40cef5b22d951bcf7e8febf6f9d4da57bf29f0d9704932',
  '19': '4f60f50f84a4790d479ea038ffcd316f725e31d64208ea897218cc1e6299074d',
  '20': '2d683e18c74661783806a20c4a572e431a964e025a6ff9c60d941d12dbbcdcc1',
  '21': '86c1cd9828c48e51b97fb4e5dbd673167d3420f63eda140e6d4f4092196ffa9e',
  '22': '74d9fc4156237f2f4ff719c7dfa4229f99fec3c1f410a05faea9bca6ca75a9ba',
  '23': 'ba2e99f2e2fc3daf77923bdd2cc5b1e5e04dd63f53de186cc1e39f6f6d8e1d69',
  '24': 'b8dbfac742b870a78e127c9bfbd1aa9d8fc533131dced7bd8e8361f906e36775',
  '25': '355e6d3239a2c3571c59918177c9e361778368d9797ae56369d24fd3f250aa2e',
};

/* ═══════════════ 1. 《工程·苏联》书结构 ═══════════════ */

describe('SU-01 · 《工程·苏联》书结构（uid0/uid1-24/uid25）', () => {
  it('恰 26 条目，uid 键 0..25 连续', async () => {
    const { sovWb } = await loadCtx();
    expect(Object.keys(sovWb.entries)).toEqual(Array.from({ length: 26 }, (_, i) => String(i)));
  });

  it('uid0 总则：触发键 4 词 / order 50000 / selective；三契约对齐盟军 uid0（24 项口径·唯一 Owner·三档挂接）', async () => {
    const { sovWb } = await loadCtx();
    const e = sovWb.entries['0'];
    expect(e['uid']).toBe(0);
    expect(e['comment']).toBe('01·工程·苏联总则');
    expect(e['key']).toEqual(['工程·苏联', '苏军工程', '改装工程', '工程总则']);
    expect(e['order']).toBe(50000);
    expect(e['selective']).toBe(true);
    expect(e['disable']).toBe(false);
    const content = e['content'] as string;
    expect(content).toMatch(/^\[工程·苏联 \| 战地改装与抢修技术总则\]/);
    expect(content).toContain('战地技术改装划分为三级工学标准');
    expect(content).toContain('一、大改（深度现代化重构）');
    expect(content).toContain('二、中改（关键系统技术跳档）');
    expect(content).toContain('三、小改（战术任务包适配）');
  });

  it('uid1-24 retrofit 条目：comment 序号制 / key=工程全名 / order=50000+uid / 均启用', async () => {
    const { sovWb } = await loadCtx();
    for (const [name, f] of Object.entries(FROZEN)) {
      const e = sovWb.entries[String(f.uid)];
      expect(e, `uid${f.uid}（${name}）缺条目`).toBeDefined();
      expect(e['key']).toEqual([name]);
      expect(e['comment']).toBe(`${String(f.uid + 1).padStart(2, '0')}·${name}`);
      expect(e['order']).toBe(50000 + f.uid);
      expect(e['disable']).toBe(false);
      expect(e['displayIndex']).toBe(f.uid);
      expect((e['content'] as string).startsWith(`[工程·苏联 | ${name}]`)).toBe(true);
    }
  });

  it('uid25 资产镜像：⚠SVG资产·通用改装车间·勿启用 · disable=true · key 空 · name 字段（双名探测依赖）', async () => {
    const { sovWb } = await loadCtx();
    const e = sovWb.entries['25'];
    expect(e['uid']).toBe(25);
    expect(e['comment']).toBe('⚠SVG资产·通用改装车间·勿启用');
    expect(e['name']).toBe(GENERIC_ASSET_ENTRY_NAME);
    expect(e['key']).toEqual([]);
    expect(e['disable']).toBe(true);
    expect(e['selective']).toBe(false); // 盟军 uid24 同款：禁用资产条目不参与激活
  });

  it('全书无协议条目（协议共用盟军 uid25，设计冻结）：无条目 key 含【工程指令】', async () => {
    const { sovWb } = await loadCtx();
    for (const e of Object.values(sovWb.entries)) {
      expect((e['key'] as unknown[]).includes('【工程指令】')).toBe(false);
    }
  });
});

/* ═══════════════ 2. 24 块冻结数值对账 ═══════════════ */

describe('SU-01 · 24 块冻结数值对账（附录清单 × ECON-01 档级模型）', () => {
  it('冻结表恰 24 项；档级分布 大改5/中改14/小改5；uid 与附录顺序一一对应', () => {
    expect(Object.keys(FROZEN)).toHaveLength(24);
    const grades = { 大改: 0, 中改: 0, 小改: 0 };
    for (const f of Object.values(FROZEN)) grades[f.grade]++;
    expect(grades).toEqual({ 大改: 5, 中改: 14, 小改: 5 });
    const uids = Object.values(FROZEN).map(f => f.uid);
    expect(uids).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it('逐块对账：schema_version/type/grade/cost/tags 2 个/scope/scene/target；阶段数/工期/lock/纳米门/拆分合计', async () => {
    const { sovWb } = await loadCtx();
    const ALLOWED_TAGS = ['载具建造', '重型装甲', '区域拒止', '空军作战', '海洋作战', '无人系统', '态势感知', 'C4ISR', '轻装快速'];
    for (const [name, f] of Object.entries(FROZEN)) {
      const content = sovWb.entries[String(f.uid)]['content'] as string;
      const m = content.match(/<数据>\n([\s\S]*?)\n<\/数据>/);
      expect(m, `${name} 缺 <数据> 块`).not.toBeNull();
      const d = JSON.parse(m![1]) as Record<string, unknown>;
      expect(d['schema_version']).toBe(1);
      expect(d['type']).toBe('retrofit');
      expect(d['id']).toBe(name);
      expect(d['research']).toBe(f.research);
      expect(d['grade']).toBe(f.grade);
      expect(d['cost']).toBe(f.cost);
      expect(d['scope']).toBe('base');
      expect(d['scene']).toBe('scene.workshop.generic');
      expect((d['target'] as Record<string, unknown>)['kind']).toBe('unit');
      const tags = d['tags'] as string[];
      expect(tags).toHaveLength(2);
      for (const t of tags) expect(ALLOWED_TAGS).toContain(t);
      const phases = d['phases'] as Array<Record<string, unknown>>;
      expect(phases).toHaveLength(f.pn);
      let sum = 0;
      for (const p of phases) {
        const w = p['workload'] as Record<string, number>;
        expect(w['days']).toBe(f.days); // 工期值域（ECON-01 模型 B：2~6 日/阶段）
        expect(w['days']).toBeGreaterThanOrEqual(2);
        expect(w['days']).toBeLessThanOrEqual(6);
        expect(w['min_days']).toBe(f.lock); // lock 档级值域：大改3/中改2/小改1
        expect(w['min_days']).toBeGreaterThanOrEqual(1);
        expect(w['min_days']).toBeLessThan(w['days']); // 标称不短于物理地板（D12）
        expect(typeof p['name']).toBe('string');
        expect((p['name'] as string).length).toBeGreaterThan(0);
        expect(((p['resources'] as Record<string, number>)['nanites'])).toBe(f.nano);
        sum += p['cost'] as number;
      }
      expect(sum).toBe(f.cost); // 总造价 = 各阶段 cost 之和（拆分合计=总额）
    }
  });

  it('纳米门档级模型：大改400/中改150/小改50 每阶段（ECON-01 模型 C）', () => {
    const byGrade = { 大改: 400, 中改: 150, 小改: 50 };
    for (const f of Object.values(FROZEN)) expect(f.nano).toBe(byGrade[f.grade]);
  });

  it('research 名全部落在《特色科技·苏联》有效名（name∪id∪aliases；不一致以科技书为准）', async () => {
    const { sovTechNames } = await loadCtx();
    const missing = [...new Set(Object.values(FROZEN).map(f => f.research))].filter(r => !sovTechNames.has(r));
    expect(missing).toEqual([]);
  });
});

/* ═══════════════ 3. 真实书解析全链（parser → def → 引擎） ═══════════════ */

describe('SU-01 · 真实《工程·苏联》书解析全链', () => {
  interface TestState extends ProjectStateView {
    queues: ProjectQueueItem[];
    projects?: Project[];
  }
  function mkState(overrides: Partial<TestState> = {}): TestState {
    return {
      tech: { done: ['装甲平台深度现代化工学·苏联实现'] },
      economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 1000 } } },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '苏联建造厂', state: '运转' }] }],
      queues: [],
      projects: [],
      ...overrides,
    };
  }

  it('parseWorldbookEntries：retrofits 恰 24、零诊断、其余桶空（资产/总则条目无数据块不产噪音）', async () => {
    const { sovWb } = await loadCtx();
    const catalog: ParsedWorldbookCatalog = parseWorldbookEntries(sovWb, { silent: true });
    expect(catalog.retrofits).toHaveLength(24);
    expect(catalog.diagnostics).toHaveLength(0);
    expect(catalog.buildings).toHaveLength(0);
    expect(catalog.researches).toHaveLength(0);
    expect(catalog.productions).toHaveLength(0);
    expect(catalog.projects).toHaveLength(0);
    for (const r of catalog.retrofits) expect(FROZEN[r.name]).toBeDefined();
  });

  it('worldbookRetrofitToDef 透传抽查（犀牛·大改 / Tornado-G·小改）：kind/research/grade/phases/scene', async () => {
    const { sovWb } = await loadCtx();
    const catalog = parseWorldbookEntries(sovWb, { silent: true });
    const rhino = worldbookRetrofitToDef(catalog.retrofits.find(r => r.name === '犀牛坦克现代化改装工程')!);
    expect(rhino.kind).toBe('retrofit');
    expect(rhino.research).toBe('装甲平台深度现代化工学·苏联实现');
    expect(rhino.grade).toBe('大改');
    expect(rhino.phases).toHaveLength(5);
    expect(rhino.scene).toBe('scene.workshop.generic');
    const tornado = worldbookRetrofitToDef(catalog.retrofits.find(r => r.name === 'Tornado-G火箭炮火控现代化工程')!);
    expect(tornado.grade).toBe('小改');
    expect(tornado.phases).toHaveLength(1);
    expect(tornado.phases![0].workload).toEqual({ days: 2, min_days: 1 });
  });

  it('mergeEffectiveCatalog：RETROFITS 合并池 47 = 静态 23（盟军）+ 苏联 24（同名零冲突）', async () => {
    const { sovWb } = await loadCtx();
    expect(RETROFITS).toHaveLength(23); // 静态基线未受本卡扰动（苏军书只走世界书动态通道）
    const catalog = parseWorldbookEntries(sovWb, { silent: true });
    const effective = mergeEffectiveCatalog([], catalog);
    expect(effective.retrofits).toHaveLength(47);
    const sovNames = new Set(Object.keys(FROZEN));
    const merged = effective.retrofits.filter(r => sovNames.has(r.name));
    expect(merged).toHaveLength(24);
  });

  it('startProject 资格抽查（犀牛·大改）：科技就位+资金+纳米+苏联建造厂锚定 → 立项扣首期 600、投影 lock=3', async () => {
    const { sovWb } = await loadCtx();
    const def = worldbookRetrofitToDef(
      parseWorldbookEntries(sovWb, { silent: true }).retrofits.find(r => r.name === '犀牛坦克现代化改装工程')!,
    );
    const r = startProject(mkState(), def, { base: 'beipo' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.message); // 判别联合收窄（engCommonWorldbook 同款）
    expect(r.projectId).toBe('proj:犀牛坦克现代化改装工程@beipo');
    expect(r.next.economy?.credits).toBe(4400); // 首期注资 600 扣账
    expect(r.next.queues).toHaveLength(1);
    expect(r.next.queues[0].min_days_lock).toBe(3); // 大改 lock=3 投影
    expect(r.next.projects?.[r.next.projects.length - 1]?.grade).toBe('大改');
  });

  it('startProject 资格抽查（MiG-31BM）：前置科技缺位 → research_gate 拒收、账本零变动（fail-closed 无 next 态）', async () => {
    const { sovWb } = await loadCtx();
    const def = worldbookRetrofitToDef(
      parseWorldbookEntries(sovWb, { silent: true }).retrofits.find(r => r.name === 'MiG-31BM高速截击数字化升级')!,
    );
    const state = mkState({
      economy: { credits: 99999, resources: { nanites: { 标准纳米工料: 99999 } } }, // 资金/纳米充裕，唯独缺科技
    });
    const r = startProject(state, def, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('前置科技缺位不应放行'); // 判别联合收窄
    expect(r.reason).toBe('research_gate');
    expect(r.message).toContain('多频预警与被动侦收工学');
    expect(r.events).toHaveLength(0); // fail-closed：零事件、不产出 next 态（账本零变动）
    expect(state.economy?.credits).toBe(99999);
  });
});

/* ═══════════════ 4. 资产镜像逐字节（uid25 ↔ 盟军 uid24） ═══════════════ */

describe('SU-01 · 资产镜像逐字节（uid25 ↔ 盟军 uid24）', () => {
  it('uid25.content === 盟军 uid24.content（逐字节）；scene id 同 scene.workshop.generic', async () => {
    const { sovWb, allyWb } = await loadCtx();
    const mirror = sovWb.entries['25']['content'] as string;
    expect(mirror).toBe(allyWb.entries['24']['content'] as string);
    expect(mirror).toContain('scene: scene.workshop.generic');
    expect(mirror.startsWith('<!--ENG-SCENE-ASSET')).toBe(true);
  });

  it('镜像资产直解可用：parseSceneAssetEntry → scene.workshop.generic 三视角通用车间（engScene 同一解析路径）', async () => {
    const { sovWb } = await loadCtx();
    const def = parseSceneAssetEntry(sovWb.entries['25']['content'], '通用改装车间');
    expect(def).not.toBeNull();
    expect(def!.id).toBe('scene.workshop.generic');
    expect(def!.title).toBe('通用改装车间');
    expect(def!.source).toBe('worldbook');
  });
});

/* ═══════════════ 5. uid25 中性化（盟军书协议共用） ═══════════════ */

describe('SU-01 · 盟军 uid25 迁出墓碑对齐（已下沉至主卡 UID 24）', () => {
  it('uid25 为已迁出墓碑，指向《全域战略指挥系统》（新UID：24）且 disable=true', async () => {
    const { allyWb } = await loadCtx();
    const entry = allyWb.entries['25'];
    const content = entry['content'] as string;
    expect(content.startsWith('[条目已迁出]')).toBe(true);
    expect(content).toContain('25·工程指令LLM响应协议（【工程指令】 · DIR-9/DIR-10）');
    expect(content).toContain('《全域战略指挥系统》（新UID：24）');
    expect(entry['disable']).toBe(true);
  });

  it('原阵营前缀不再出现，key 已清空防误触发', async () => {
    const { allyWb } = await loadCtx();
    const entry = allyWb.entries['25'];
    const content = entry['content'] as string;
    expect(content.includes('[工程·盟军 | 工程指令响应协议')).toBe(false);
    expect(entry['key']).toEqual([]);
  });

  it('comment 标注已迁出至全域战略指挥系统', async () => {
    const { allyWb } = await loadCtx();
    const comment = allyWb.entries['25']['comment'] as string;
    expect(comment).toBe('[已迁出至全域战略指挥系统] 25·工程指令LLM响应协议（【工程指令】 · DIR-9/DIR-10）');
  });
});

/* ═══════════════ 6. 盟军书零扰动（sha256 钉值） ═══════════════ */

describe('SU-01 · 盟军书零扰动（uid0-24 = SU-01 前基线；uid25 = POST 钉值）', () => {
  it('其余 25 条目 sha256 逐条等于基线（除 uid25 外零漂移）；uid25 现值=POST 钉值', async () => {
    const { allyWb, sha256 } = await loadCtx();
    expect(Object.keys(allyWb.entries)).toHaveLength(26);
    const drifted: string[] = [];
    for (const [k, e] of Object.entries(allyWb.entries)) {
      const h = sha256(JSON.stringify(e));
      expect(ALLY_SHA[k], `uid${k} 未在钉值表登记`).toBeDefined();
      if (h !== ALLY_SHA[k]) drifted.push(k);
    }
    expect(drifted).toEqual([]); // 26/26 与钉值一致（uid25 钉的是中性化后现值）
  });
});
