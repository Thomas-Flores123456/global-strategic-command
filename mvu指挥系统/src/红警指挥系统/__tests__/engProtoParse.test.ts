/**
 * engProtoParse.test.ts —— 工程指令 LLM 响应协议（CTRL-ENG-PROTO-01 · DIR-9）
 *
 * 真源：docs/project/plans/工程玩法-脑暴决策记录-2026-10-10.md §10 DIR-9（2026-10-11）；
 *       docs/project/plans/工程玩法MVP任务包.md §6 ENG-PROTO-01 任务卡。
 *
 * 覆盖任务卡验收自动化面：
 * ① <工程> 五动词 + 驳回合法解析（行首容器标签 + YAML 内容，与 <队列>/<部署> 同语法族；
 *    全角容忍继承 scanMarkers/floorSanitize/preprocess）；
 * ② 畸形/缺字段载荷入隔离区 fail-closed（绝不动账本、不计 appliedCount）；
 * ③ 实例标识双通道（proj:* 直通；工程名唯一匹配归一；歧义→隔离区）与越权 fail-closed
 *    （注资不存在实例 → 接缝/引擎拒收，账本零变动，留痕不静默吞）；
 * ④ 接缝参数正确性（EngOrder → projectEngine 五函数调用参数 spy 断言）；
 * ⑤ 解析层只构造不执行（parse 后账本逐字节不变）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDef, RetrofitDef } from '../core/catalog';
import type { EngOrder } from '../parse/parsePipeline';
import { parseMessageText } from '../parse/parsePipeline';
import { Schema, isProjectV2 } from '../core/schema';
import type { ProjectV1 } from '../core/schema';
import { applyEngOrders } from '../engines/engOrderBridge';
import type { ProjectQueueItem, ProjectStateView } from '../engines/projectEngine';

/* ═══════════════ 接缝调用记录（vi.mock 包裹穿透，行为与参数双断言） ═══════════════ */

const engineCalls: { fn: string; args: unknown[] }[] = [];

vi.mock('../engines/projectEngine', async importOriginal => {
  const mod = await importOriginal<typeof import('../engines/projectEngine')>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 间谍包裹穿透原实现
  const record = (fn: string, f: (...args: any[]) => any) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同上
    (...args: any[]): any => {
      engineCalls.push({ fn, args });
      return f(...args);
    };
  return {
    ...mod,
    startProject: record('startProject', mod.startProject),
    startPhase: record('startPhase', mod.startPhase),
    pauseProject: record('pauseProject', mod.pauseProject),
    resumeProject: record('resumeProject', mod.resumeProject),
    cancelProject: record('cancelProject', mod.cancelProject),
    // V2-05：仓段化 V2 七函数同构穿透记录（接缝分流断言）
    startProjectV2: record('startProjectV2', mod.startProjectV2),
    investModule: record('investModule', mod.investModule),
    pauseModule: record('pauseModule', mod.pauseModule),
    resumeModule: record('resumeModule', mod.resumeModule),
    pauseProjectV2: record('pauseProjectV2', mod.pauseProjectV2),
    resumeProjectV2: record('resumeProjectV2', mod.resumeProjectV2),
    cancelProjectV2: record('cancelProjectV2', mod.cancelProjectV2),
  };
});

beforeEach(() => {
  engineCalls.length = 0;
});

/* ═══════════════ 测试工具 ═══════════════ */

/** 静态工程定义（数值仅测试用，非 ENG-ECON-01 冻结数值；与 projectEngine.test.ts fixture 同形） */
const DEF: RetrofitDef = {
  kind: 'retrofit',
  name: '灰熊坦克现代化改装工程',
  research: '重装机甲理论',
  grade: '中改',
  desc: '测试用定义',
  cost: 1200,
  phases: [
    { name: '方案与备料', workload: { days: 3, min_days: 1, tflops: 10 }, cost: 400, resources: { nanites: 20 } },
    { name: '总装与调校', workload: { days: 4, min_days: 2, tops: 20 }, cost: 800, resources: { nanites: 30 } },
  ],
  resources: { nanites: 50 },
  scope: 'base',
};

const PROJECT_ID = 'proj:灰熊坦克现代化改装工程@beipo';

/** 解析侧基线（Schema.parse 归一）：单基地（含可运转盟军建造厂）+ 一个在建工程实例 */
const parseBaseline = () =>
  Schema.parse({
    bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
    projects: [
      {
        id: PROJECT_ID,
        ref: '灰熊坦克现代化改装工程',
        scope: 'base',
        bases: ['beipo'],
        lead_base: 'beipo',
        grade: '中改',
        status: '在建',
        phases: [
          { idx: 0, name: '方案与备料', status: '进行中', queue_index: null },
          { idx: 1, name: '总装与调校', status: '未启动', queue_index: null },
        ],
      },
    ],
  });

interface TestState extends ProjectStateView {
  queues: ProjectQueueItem[];
  /** V2-01 适配：本文件 fixture 全为 V1 工程，收窄 projects 元素类型使 .phases 访问免守卫（断言零改动） */
  projects?: ProjectV1[];
}

/** 接缝侧最小状态（对齐 projectEngine.test.ts mkState：1 工程槽容量、科技就位、资金 5000、纳米 100） */
function mkState(overrides: Partial<TestState> = {}): TestState {
  return {
    tech: { done: ['重装机甲理论'] },
    economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 100 } } },
    bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
    queues: [],
    projects: [],
    ...overrides,
  };
}

/* ═══════════════ ① 五动词 + 驳回合法解析 ═══════════════ */

describe('ENG-PROTO-01 · 五动词+驳回合法解析（<工程> 容器标签）', () => {
  const RAW =
    '<工程>\n' +
    `立项: {name: 灰熊坦克现代化改装工程, base: 北坡基地}\n` +
    `注资: {id: ${PROJECT_ID}, phase: 1}\n` +
    `暂停: {id: ${PROJECT_ID}}\n` +
    `恢复: {id: 灰熊坦克现代化改装工程}\n` +
    `取消: {id: ${PROJECT_ID}}\n` +
    `驳回: {id: ${PROJECT_ID}, reason: 预算不足}\n` +
    '</工程>';

  it('六键全收：动词/载荷字段逐项正确，工程名唯一匹配归一为实例 id', () => {
    const result = parseMessageText(RAW, parseBaseline(), {});
    expect(result.quarantine).toHaveLength(0);
    expect(result.engOrders.map(o => o.verb)).toEqual(['立项', '注资', '暂停', '恢复', '取消', '驳回']);
    expect(result.engOrders[0]).toEqual({ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' });
    expect(result.engOrders[1]).toEqual({ verb: '注资', id: PROJECT_ID, phase: 1 });
    expect(result.engOrders[2]).toEqual({ verb: '暂停', id: PROJECT_ID });
    // 工程名唯一匹配兜底 → 归一为实例 id
    expect(result.engOrders[3]).toEqual({ verb: '恢复', id: PROJECT_ID });
    expect(result.engOrders[4]).toEqual({ verb: '取消', id: PROJECT_ID });
    expect(result.engOrders[5]).toEqual({ verb: '驳回', id: PROJECT_ID, reason: '预算不足' });
    // 每令一条 🟢 instruction 留痕
    expect(result.events.filter(e => e.layer === 'instruction' && /工程令/.test(e.message))).toHaveLength(6);
  });

  it('解析层只构造不执行：账本逐字节不变、不计 appliedCount（对齐调度令先例）', () => {
    const baseline = parseBaseline();
    const result = parseMessageText(RAW, baseline, {});
    expect(result.engOrders).toHaveLength(6);
    expect(result.data.projects).toEqual(baseline.projects);
    expect(result.data.queues).toEqual(baseline.queues);
    expect(result.applied).toBe(false);
  });

  it('同动词多条载荷（YAML 数组）按序收集', () => {
    const result = parseMessageText(
      '<工程>\n' + `注资: [{id: ${PROJECT_ID}, phase: 1}, {id: proj:另一工程@beipo, phase: 0}]\n` + '</工程>',
      parseBaseline(),
      {},
    );
    expect(result.quarantine).toHaveLength(0);
    expect(result.engOrders).toEqual([
      { verb: '注资', id: PROJECT_ID, phase: 1 },
      { verb: '注资', id: 'proj:另一工程@beipo', phase: 0 },
    ]);
  });

  it('全角容忍继承 scanMarkers/floorSanitize/preprocess（＜工程＞＋全角冒号）', () => {
    const result = parseMessageText(
      '\uFF1C工程\uFF1E\n' + `立项：{name：灰熊坦克现代化改装工程，base：北坡基地}\n` + '\uFF1C/工程\uFF1E',
      parseBaseline(),
      {},
    );
    expect(result.engOrders).toEqual([{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }]);
  });

  it('未知顶层键归 leftovers 纪律隔离，不拖累同块合法令', () => {
    const result = parseMessageText(
      '<工程>\n' + `开工: {id: ${PROJECT_ID}}\n` + `暂停: {id: ${PROJECT_ID}}\n` + '</工程>',
      parseBaseline(),
      {},
    );
    expect(result.engOrders).toEqual([{ verb: '暂停', id: PROJECT_ID }]);
    expect(result.quarantine.some(q => q.scope === 'key' && q.path === '工程.开工' && /开工/.test(q.raw))).toBe(true);
  });
});

/* ═══════════════ ② 畸形/缺字段 → 隔离区 fail-closed ═══════════════ */

describe('ENG-PROTO-01 · 畸形载荷入隔离区（fail-closed，绝不动账本）', () => {
  const cases: { name: string; body: string; error: RegExp }[] = [
    { name: '注资显式空阶段号（phase: ""）', body: `注资: {id: ${PROJECT_ID}, phase: ""}`, error: /阶段号非法/ },
    { name: '注资阶段号小数', body: `注资: {id: ${PROJECT_ID}, phase: 1.5}`, error: /阶段号非法/ },
    { name: '注资阶段号负数', body: `注资: {id: ${PROJECT_ID}, phase: -1}`, error: /阶段号非法/ },
    { name: '立项缺基地', body: '立项: {name: 灰熊坦克现代化改装工程}', error: /缺必填字段/ },
    { name: '立项缺工程名', body: '立项: {base: 北坡基地}', error: /缺必填字段/ },
    { name: '驳回缺叙事理由', body: `驳回: {id: ${PROJECT_ID}}`, error: /缺叙事理由/ },
    { name: '暂停缺实例定位', body: '暂停: {note: 停一下}', error: /缺实例定位/ },
    { name: '载荷非对象（标量）', body: `暂停: ${PROJECT_ID}`, error: /载荷非对象/ },
  ];
  for (const c of cases) {
    it(`${c.name} → 元素隔离、零工程令、账本不动`, () => {
      const baseline = parseBaseline();
      const result = parseMessageText(`<工程>\n${c.body}\n</工程>`, baseline, {});
      expect(result.engOrders).toHaveLength(0);
      expect(result.quarantine.some(q => q.tag === '工程' && c.error.test(q.error))).toBe(true);
      expect(result.data.projects).toEqual(baseline.projects);
      expect(result.applied).toBe(false);
    });
  }

  it('<工程> 块内容非键值映射（数组）→ 整块隔离', () => {
    const result = parseMessageText('<工程>\n- 立项\n- 注资\n</工程>', parseBaseline(), {});
    expect(result.engOrders).toHaveLength(0);
    expect(result.quarantine.some(q => q.scope === 'block' && q.tag === '工程' && /期望键值映射/.test(q.error))).toBe(
      true,
    );
  });

  it('载荷夹带未知字段 → 残留键隔离但令照收（对齐调度令夹带纪律）', () => {
    const result = parseMessageText(
      '<工程>\n' + `注资: {id: ${PROJECT_ID}, phase: 1, eta: 三天}\n` + '</工程>',
      parseBaseline(),
      {},
    );
    expect(result.engOrders).toEqual([{ verb: '注资', id: PROJECT_ID, phase: 1 }]);
    expect(result.quarantine.some(q => q.scope === 'key' && /eta/.test(q.path ?? ''))).toBe(true);
  });
});

/* ═══════════════ ③ 实例标识双通道与歧义隔离 ═══════════════ */

describe('ENG-PROTO-01 · 实例标识双通道（proj:* 优先 / 工程名唯一兜底 / 歧义隔离）', () => {
  const dualProjectBaseline = () =>
    Schema.parse({
      bases: [
        { id: 'beipo', name: '北坡基地', buildings: [] },
        { id: 'nangang', name: '南港基地', buildings: [] },
      ],
      projects: [
        {
          id: PROJECT_ID,
          ref: '灰熊坦克现代化改装工程',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '中改',
          status: '在建',
        },
        {
          id: 'proj:灰熊坦克现代化改装工程@nangang',
          ref: '灰熊坦克现代化改装工程',
          scope: 'base',
          bases: ['nangang'],
          lead_base: 'nangang',
          grade: '中改',
          status: '在建',
        },
      ],
    });

  it('工程名跨基地歧义 → 隔离区，不静默取首条（对齐调度令消歧哲学）', () => {
    const result = parseMessageText(
      '<工程>\n暂停: {id: 灰熊坦克现代化改装工程}\n</工程>',
      dualProjectBaseline(),
      {},
    );
    expect(result.engOrders).toHaveLength(0);
    expect(result.quarantine.some(q => q.tag === '工程' && /匹配多个实例/.test(q.error))).toBe(true);
  });

  it('歧义现场下 proj:* 实例 id 直通不受牵连', () => {
    const result = parseMessageText(
      '<工程>\n' + `暂停: {id: ${PROJECT_ID}}\n` + '</工程>',
      dualProjectBaseline(),
      {},
    );
    expect(result.quarantine).toHaveLength(0);
    expect(result.engOrders).toEqual([{ verb: '暂停', id: PROJECT_ID }]);
  });

  it('proj:* 前缀大小写不敏感直通；零命中名原样携带（引擎拒 not_found）', () => {
    const result = parseMessageText(
      '<工程>\n暂停: {id: PROJ:幽灵工程@x}\n恢复: {id: 幽灵工程}\n</工程>',
      parseBaseline(),
      {},
    );
    expect(result.engOrders).toEqual([
      { verb: '暂停', id: 'PROJ:幽灵工程@x' },
      { verb: '恢复', id: '幽灵工程' },
    ]);
  });

  it('立项基地引用歧义 → 隔离区；不可解析基地原样携带（引擎门拒收）', () => {
    const ambiguousBases = () =>
      Schema.parse({
        bases: [
          { id: 'a1', name: '前进基地', buildings: [] },
          { id: 'a2', name: '前进基地', buildings: [] },
        ],
      });
    const ambiguous = parseMessageText(
      '<工程>\n立项: {name: 灰熊坦克现代化改装工程, base: 前进基地}\n</工程>',
      ambiguousBases(),
      {},
    );
    expect(ambiguous.engOrders).toHaveLength(0);
    expect(ambiguous.quarantine.some(q => q.tag === '工程' && /不唯一/.test(q.error))).toBe(true);

    const unresolvable = parseMessageText(
      '<工程>\n立项: {name: 灰熊坦克现代化改装工程, base: 待侦知部署点}\n</工程>',
      parseBaseline(),
      {},
    );
    expect(unresolvable.engOrders).toEqual([
      { verb: '立项', name: '灰熊坦克现代化改装工程', base: '待侦知部署点' },
    ]);
  });
});

/* ═══════════════ ④ 接缝：EngOrder → projectEngine 参数正确性 ═══════════════ */

describe('ENG-PROTO-01 · useParse 接缝（applyEngOrders → projectEngine 五函数）', () => {
  it('立项：startProject(state, def, {base}) 参数正确，首期注资扣账、实例入账', () => {
    const state = mkState();
    const r = applyEngOrders(state, [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }], [DEF]);
    const call = engineCalls.find(c => c.fn === 'startProject');
    expect(call).toBeDefined();
    expect(call!.args[0]).toBe(state);
    expect(call!.args[1]).toBe(DEF);
    expect(call!.args[2]).toEqual({ base: 'beipo' });
    expect(r.next.projects).toHaveLength(1);
    expect(r.next.projects![0]).toMatchObject({ id: PROJECT_ID, status: '在建', lead_base: 'beipo' });
    expect(r.next.economy!.credits).toBe(4600); // 首期注资 400 已扣
    expect(r.quarantine).toHaveLength(0);
    expect(r.events.some(e => e.light === '🟢' && /project_started/.test(e.message))).toBe(true);
  });

  it('注资：startPhase(state, id, phaseIdx, def) 参数正确，def 按 project.ref 解析', () => {
    const started = applyEngOrders(mkState(), [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }], [
      DEF,
    ]).next;
    // 模拟里程碑回写：首期阶段完工（注资阶段 #1 的 phase_order 前提）
    const phase0Done: TestState = {
      ...started,
      projects: started.projects!.map(p => ({
        ...p,
        phases: p.phases.map(ph => (ph.idx === 0 ? { ...ph, status: '完工' as const, queue_index: null } : ph)),
      })),
    };
    engineCalls.length = 0;
    const r = applyEngOrders(phase0Done, [{ verb: '注资', id: PROJECT_ID, phase: 1 }], [DEF]);
    const call = engineCalls.find(c => c.fn === 'startPhase');
    expect(call).toBeDefined();
    expect(call!.args[0]).toBe(phase0Done);
    expect(call!.args[1]).toBe(PROJECT_ID);
    expect(call!.args[2]).toBe(1);
    expect((call!.args[3] as RetrofitDef).name).toBe('灰熊坦克现代化改装工程');
    expect(r.next.projects![0].phases[1]).toMatchObject({ status: '进行中' });
    expect(r.next.economy!.credits).toBe(3800); // 4600 - 800
  });

  it('暂停/恢复/取消：pause/resume/cancelProject(state, id) 参数正确并驱动状态机', () => {
    const started = applyEngOrders(mkState(), [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }], [
      DEF,
    ]).next;
    engineCalls.length = 0;

    const paused = applyEngOrders(started, [{ verb: '暂停', id: PROJECT_ID }], [DEF]);
    expect(engineCalls.find(c => c.fn === 'pauseProject')!.args).toEqual([started, PROJECT_ID]);
    expect(paused.next.projects![0].status).toBe('暂停');

    const resumed = applyEngOrders(paused.next, [{ verb: '恢复', id: PROJECT_ID }], [DEF]);
    expect(engineCalls.find(c => c.fn === 'resumeProject')!.args).toEqual([paused.next, PROJECT_ID]);
    expect(resumed.next.projects![0].status).toBe('在建');

    const cancelled = applyEngOrders(resumed.next, [{ verb: '取消', id: PROJECT_ID }], [DEF]);
    expect(engineCalls.find(c => c.fn === 'cancelProject')!.args).toEqual([resumed.next, PROJECT_ID]);
    expect(cancelled.next.projects![0].status).toBe('取消');
    // §3.3 固定结算文案随事件留痕（注资不退/进度作废/纳米无抵扣）
    expect(cancelled.events.some(e => /取消结算/.test(e.message) && /不予退还/.test(e.message))).toBe(true);
  });

  it('同楼多令按声明序线程化结转（注资后暂停：注资令产物为暂停令入参）', () => {
    const started = applyEngOrders(mkState(), [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }], [
      DEF,
    ]).next;
    // 首期阶段完工后才能注资阶段 #1
    const phase0Done: TestState = {
      ...started,
      projects: started.projects!.map(p => ({
        ...p,
        phases: p.phases.map(ph => (ph.idx === 0 ? { ...ph, status: '完工' as const, queue_index: null } : ph)),
      })),
    };
    engineCalls.length = 0;
    const orders: EngOrder[] = [
      { verb: '注资', id: PROJECT_ID, phase: 1 },
      { verb: '暂停', id: PROJECT_ID },
    ];
    const r = applyEngOrders(phase0Done, orders, [DEF]);
    const fundCall = engineCalls.find(c => c.fn === 'startPhase')!;
    const pauseCall = engineCalls.find(c => c.fn === 'pauseProject')!;
    expect(fundCall.args[0]).toBe(phase0Done);
    expect(pauseCall.args[0]).not.toBe(phase0Done); // 暂停令吃到注资令产物
    expect(r.next.projects![0].status).toBe('暂停');
    expect(r.next.projects![0].phases[1].status).toBe('暂停');
  });

  it('驳回：账本不动（引用相等），仅登记 🟢 回执事件（DIR-9 回执回路）', () => {
    const state = mkState();
    const r = applyEngOrders(state, [{ verb: '驳回', id: PROJECT_ID, reason: '预算不足' }], [DEF]);
    expect(r.next).toBe(state);
    expect(engineCalls).toHaveLength(0); // 驳回不调引擎
    expect(r.quarantine).toHaveLength(0);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ light: '🟢', layer: 'instruction' });
    expect(r.events[0].message).toContain('预算不足');
    expect(r.events[0].message).toContain('账本不动');
  });
});

/* ═══════════════ ⑤ 越权/失败 fail-closed（留痕不静默吞） ═══════════════ */

describe('ENG-PROTO-01 · 越权与引擎拒收（fail-closed：账本零变动 + 🟡事件 + 🔴隔离区）', () => {
  it('注资不存在的实例 → 接缝拒收，状态引用相等，零引擎调用', () => {
    const state = mkState();
    const r = applyEngOrders(state, [{ verb: '注资', id: 'proj:幽灵工程@x', phase: 1 }], [DEF]);
    expect(r.next).toBe(state);
    expect(engineCalls.filter(c => c.fn === 'startPhase')).toHaveLength(0);
    expect(r.events.some(e => e.light === '🟡' && /不存在/.test(e.message))).toBe(true);
    expect(r.quarantine.some(q => q.tag === '工程' && /不存在/.test(q.error))).toBe(true);
  });

  it('暂停不存在的实例 → 引擎 not_found 拒收留痕，状态引用相等', () => {
    const state = mkState();
    const r = applyEngOrders(state, [{ verb: '暂停', id: 'proj:幽灵工程@x' }], [DEF]);
    expect(r.next).toBe(state);
    expect(engineCalls.find(c => c.fn === 'pauseProject')).toBeDefined(); // 引擎是裁决点
    expect(r.events.some(e => e.light === '🟡' && /not_found/.test(e.message))).toBe(true);
    expect(r.quarantine.some(q => q.tag === '工程' && /not_found/.test(q.error))).toBe(true);
  });

  it('注资越权阶段（越级注资）→ 引擎 phase_order 拒收，账本不动', () => {
    const started = applyEngOrders(mkState(), [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }], [
      DEF,
    ]).next;
    // 人为把首期阶段拨回未启动，构造「阶段 #1 前序未完工」现场
    const tampered = {
      ...started,
      projects: started.projects!.map(p => ({
        ...p,
        phases: p.phases.map(ph => (ph.idx === 0 ? { ...ph, status: '未启动' as const } : ph)),
      })),
    };
    const r = applyEngOrders(tampered, [{ verb: '注资', id: PROJECT_ID, phase: 1 }], [DEF]);
    expect(r.next).toBe(tampered);
    expect(r.events.some(e => e.light === '🟡' && /phase_order/.test(e.message))).toBe(true);
    expect(r.quarantine.some(q => q.tag === '工程' && /phase_order/.test(q.error))).toBe(true);
  });

  it('立项静态定义缺席（retrofits 空目录）→ 拒收留痕，不虚构资格', () => {
    const state = mkState();
    const r = applyEngOrders(state, [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }], []);
    expect(r.next).toBe(state);
    expect(engineCalls.filter(c => c.fn === 'startProject')).toHaveLength(0);
    expect(r.events.some(e => e.light === '🟡' && /不在工程目录/.test(e.message))).toBe(true);
    expect(r.quarantine.some(q => q.tag === '工程' && /不在工程目录/.test(q.error))).toBe(true);
  });

  it('立项资格门不过（缺前置科技）→ 引擎 research_gate 拒收留痕', () => {
    const state = mkState({ tech: { done: [] } });
    const r = applyEngOrders(state, [{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }], [DEF]);
    expect(r.next).toBe(state);
    expect(r.events.some(e => e.light === '🟡' && /research_gate/.test(e.message))).toBe(true);
    expect(r.quarantine.some(q => q.tag === '工程' && /research_gate/.test(q.error))).toBe(true);
  });
});

/* ═══════════════ ⑥ 端到端：parse → 接缝（StatData 贯通） ═══════════════ */

describe('ENG-PROTO-01 · 端到端（<工程> 标签 → parse → applyEngOrders → stat_data.projects 更新）', () => {
  it('立项标签贯通：解析产物直接喂接缝，工程实例入账且首期投影排队', () => {
    const baseline = Schema.parse({
      tech: { done: ['重装机甲理论'] },
      economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 100 } } },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
    });
    const parsed = parseMessageText(
      '<工程>\n立项: {name: 灰熊坦克现代化改装工程, base: 北坡基地}\n</工程>',
      baseline,
      {},
    );
    expect(parsed.engOrders).toEqual([{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }]);
    const r = applyEngOrders(parsed.data, parsed.engOrders, [DEF]);
    expect(r.next.projects).toHaveLength(1);
    expect(r.next.projects![0]).toMatchObject({ id: PROJECT_ID, ref: '灰熊坦克现代化改装工程', status: '在建' });
    expect(r.next.queues.some(q => q.type === '工程' && q.item === '灰熊坦克现代化改装工程·方案与备料')).toBe(true);
    // 归一保险网：接缝产物仍过 Schema 校验
    expect(() => Schema.parse(r.next)).not.toThrow();
  });

  it('驳回标签贯通：账本与基线逐字节一致', () => {
    const baseline = parseBaseline();
    const parsed = parseMessageText(
      '<工程>\n' + `驳回: {id: ${PROJECT_ID}, reason: 后勤处回绝-预算不足}\n` + '</工程>',
      baseline,
      {},
    );
    const r = applyEngOrders(parsed.data, parsed.engOrders, [DEF]);
    expect(r.next).toBe(parsed.data);
    expect(r.next.projects).toEqual(baseline.projects);
    expect(r.events[0].message).toContain('后勤处回绝-预算不足');
  });
});

/* ═══════════════ ⑦ V2-05：module 维度收集与互斥隔离（仓段化协议扩展） ═══════════════ */

const V2_PROJECT_ID = 'proj:空间站@beipo';

/** V2 工程解析侧基线：单基地（航天发射中心=eng.orbital 锚定）+ 一个在建仓段化实例（schema_version 2） */
const v2Baseline = () =>
  Schema.parse({
    bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
    projects: [
      {
        id: V2_PROJECT_ID,
        ref: '空间站',
        scope: 'base',
        bases: ['beipo'],
        lead_base: 'beipo',
        grade: '巨构',
        status: '在建',
        schema_version: 2,
        modules: [
          { id: 'core', name: '核心舱', status: '进行中', base: 'beipo', queue_index: null },
          { id: 'hab', name: '居住舱', status: '未启动', base: '', queue_index: null },
        ],
      },
    ],
  });

/** 仓段化静态定义（catalog.ProjectDef 形状；数值仅测试用，D12 对账归 V2-11） */
const V2DEF: ProjectDef = {
  kind: 'project',
  id: 'all.project.station',
  name: '空间站',
  desc: '测试用仓段化定义',
  grade: '巨构',
  modules: [
    { id: 'core', name: '核心舱', cost: 200, workload: { days: 3, min_days: 1 }, prereqs: [] },
    { id: 'hab', name: '居住舱', cost: 150, workload: { days: 2, min_days: 1 }, prereqs: ['core'] },
  ],
};

describe('V2-05 · module 键收集（注资/暂停/恢复 模块维度原样携带）', () => {
  it('注资 module（模块名）→ EngOrder.module 原样收集，🟢 留痕含模块名', () => {
    const result = parseMessageText(`<工程>\n注资: {id: ${V2_PROJECT_ID}, module: 核心舱}\n</工程>`, v2Baseline(), {});
    expect(result.quarantine).toHaveLength(0);
    expect(result.engOrders).toEqual([{ verb: '注资', id: V2_PROJECT_ID, module: '核心舱' }]);
    expect(result.events.some(e => e.layer === 'instruction' && /模块「核心舱」/.test(e.message))).toBe(true);
  });

  it('注资 module（模块 id）直通；暂停/恢复携带 module 收集为模块级令', () => {
    const result = parseMessageText(
      '<工程>\n' +
        `注资: {id: ${V2_PROJECT_ID}, module: hab}\n` +
        `暂停: {id: ${V2_PROJECT_ID}, module: 居住舱}\n` +
        `恢复: {id: ${V2_PROJECT_ID}, module: core}\n` +
        '</工程>',
      v2Baseline(),
      {},
    );
    expect(result.quarantine).toHaveLength(0);
    expect(result.engOrders).toEqual([
      { verb: '注资', id: V2_PROJECT_ID, module: 'hab' },
      { verb: '暂停', id: V2_PROJECT_ID, module: '居住舱' },
      { verb: '恢复', id: V2_PROJECT_ID, module: 'core' },
    ]);
  });

  it('module 别名键（模块/仓段）canon 容忍 + 全角冒号', () => {
    const result = parseMessageText(
      '\uFF1C工程\uFF1E\n' + `注资：{id：${V2_PROJECT_ID}，模块：核心舱}\n` + '\uFF1C/工程\uFF1E',
      v2Baseline(),
      {},
    );
    expect(result.engOrders).toEqual([{ verb: '注资', id: V2_PROJECT_ID, module: '核心舱' }]);
  });

  it('同动词数组多条 module 载荷按序收集；解析层只构造不动账本', () => {
    const baseline = v2Baseline();
    const result = parseMessageText(
      '<工程>\n' + `注资: [{id: ${V2_PROJECT_ID}, module: core}, {id: ${V2_PROJECT_ID}, module: 居住舱}]\n` + '</工程>',
      baseline,
      {},
    );
    expect(result.engOrders).toEqual([
      { verb: '注资', id: V2_PROJECT_ID, module: 'core' },
      { verb: '注资', id: V2_PROJECT_ID, module: '居住舱' },
    ]);
    expect(result.data.projects).toEqual(baseline.projects);
    expect(result.applied).toBe(false);
  });
});

describe('V2-05 · 互斥与动词×维度 fail-closed（出现即整令隔离）', () => {
  const cases: { name: string; body: string; error: RegExp }[] = [
    {
      name: '注资同时携带 phase 与 module（互斥违令）',
      body: `注资: {id: ${V2_PROJECT_ID}, phase: 1, module: 核心舱}`,
      error: /互斥/,
    },
    { name: '注资显式空 module（module: ""）', body: `注资: {id: ${V2_PROJECT_ID}, module: ""}`, error: /module 键为空/ },
    { name: '立项携带 module（工程级操作不认）', body: '立项: {name: 空间站, base: 北坡基地, module: 核心舱}', error: /不认 module/ },
    { name: '取消携带 module（工程级操作不认）', body: `取消: {id: ${V2_PROJECT_ID}, module: 核心舱}`, error: /不认 module/ },
    { name: 'module 键空值', body: `暂停: {id: ${V2_PROJECT_ID}, module: ""}`, error: /module 键为空/ },
  ];
  for (const c of cases) {
    it(`${c.name} → 元素隔离、零工程令、账本不动`, () => {
      const baseline = v2Baseline();
      const result = parseMessageText(`<工程>\n${c.body}\n</工程>`, baseline, {});
      expect(result.engOrders).toHaveLength(0);
      expect(result.quarantine.some(q => q.tag === '工程' && c.error.test(q.error))).toBe(true);
      expect(result.data.projects).toEqual(baseline.projects);
      expect(result.applied).toBe(false);
    });
  }

  it('V1 六键全收零回归：phase 令与 module 令互不拖累（同楼分立收集）', () => {
    const result = parseMessageText(
      '<工程>\n' + `注资: [{id: ${PROJECT_ID}, phase: 1}, {id: ${V2_PROJECT_ID}, module: core}]\n` + '</工程>',
      (() => {
        const b = parseBaseline();
        return Schema.parse({ ...b, projects: [...(b.projects ?? []), ...(v2Baseline().projects ?? [])] });
      })(),
      {},
    );
    expect(result.quarantine).toHaveLength(0);
    expect(result.engOrders).toEqual([
      { verb: '注资', id: PROJECT_ID, phase: 1 },
      { verb: '注资', id: V2_PROJECT_ID, module: 'core' },
    ]);
  });
});

describe('V2-05 · 接缝 V2 分流（module 解析 / 未知模块隔离 / 维度错配拒收）', () => {
  it('未知模块（id/name 均未命中）→ 接缝隔离、零 investModule 调用、账本不动', () => {
    const state = v2Baseline();
    const r = applyEngOrders(state, [{ verb: '注资', id: V2_PROJECT_ID, module: '幽灵舱' }], [], [V2DEF]);
    expect(r.next).toBe(state);
    expect(engineCalls.filter(c => c.fn === 'investModule')).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '工程' && /无模块「幽灵舱」/.test(q.error))).toBe(true);
  });

  it('模块名歧义（两模块同名）→ 接缝隔离，不静默取首个', () => {
    const ambiguous = Schema.parse({
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [] }],
      projects: [
        {
          id: V2_PROJECT_ID,
          ref: '空间站',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '巨构',
          status: '在建',
          schema_version: 2,
          modules: [
            { id: 'a', name: '同名舱', status: '未启动', base: '', queue_index: null },
            { id: 'b', name: '同名舱', status: '未启动', base: '', queue_index: null },
          ],
        },
      ],
    });
    const r = applyEngOrders(ambiguous, [{ verb: '注资', id: V2_PROJECT_ID, module: '同名舱' }], [], [V2DEF]);
    expect(r.next).toBe(ambiguous);
    expect(engineCalls.filter(c => c.fn === 'investModule')).toHaveLength(0);
    expect(r.quarantine.some(q => q.tag === '工程' && /匹配多个模块/.test(q.error))).toBe(true);
  });

  it('维度错配：V1 实例注资携带 module / V2 实例注资缺 module → 接缝拒收留痕', () => {
    const v1r = applyEngOrders(parseBaseline(), [{ verb: '注资', id: PROJECT_ID, module: '核心舱' }], [DEF], []);
    expect(v1r.quarantine.some(q => q.tag === '工程' && /V1 线性工程，不认 module/.test(q.error))).toBe(true);

    const v2r = applyEngOrders(v2Baseline(), [{ verb: '注资', id: V2_PROJECT_ID, phase: 0 }], [], [V2DEF]);
    expect(v2r.quarantine.some(q => q.tag === '工程' && /缺 module 键/.test(q.error))).toBe(true);
    expect(engineCalls.filter(c => c.fn === 'startPhase' || c.fn === 'investModule')).toHaveLength(0);
  });

  it('V2 动词路由端到端：注资 module（name 兜底）→ investModule；模块级暂停 → pauseModule', () => {
    // core 完工现场（hab 注资的拓扑前提）
    const base = v2Baseline();
    const coreDone = Schema.parse({
      ...base,
      tech: { done: ['空间站建造工学'] },
      economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 100 } } },
      projects: (base.projects ?? []).map(p =>
        isProjectV2(p)
          ? { ...p, modules: p.modules.map(m => (m.id === 'core' ? { ...m, status: '完工' as const, queue_index: null } : m)) }
          : p,
      ),
    });
    engineCalls.length = 0;
    const r = applyEngOrders(coreDone, [{ verb: '注资', id: V2_PROJECT_ID, module: '居住舱' }], [], [V2DEF]);
    const invest = engineCalls.find(c => c.fn === 'investModule');
    expect(invest).toBeDefined();
    expect(invest!.args[1]).toBe(V2_PROJECT_ID);
    expect(invest!.args[2]).toBe('hab'); // name 兜底收窄为模块 id
    expect(r.next.economy!.credits).toBe(4850); // hab 150 已扣
    expect(r.quarantine).toHaveLength(0);

    const paused = applyEngOrders(r.next, [{ verb: '暂停', id: V2_PROJECT_ID, module: '居住舱' }], [], [V2DEF]);
    expect(engineCalls.find(c => c.fn === 'pauseModule')!.args[2]).toBe('hab');
    const proj = paused.next.projects!.find(p => p.id === V2_PROJECT_ID);
    if (!proj || !isProjectV2(proj)) throw new Error('fixture 应为 V2 工程');
    expect(proj.modules.find(m => m.id === 'hab')!.status).toBe('暂停');
  });

  it('BUG-LIVE-07：<工程> 块兼容顶层 YAML 对象数组（简写对与嵌套对象）与顶层简写键值，不再整块误隔离', () => {
    const baseline = parseBaseline();
    const rawArrayShorthand = `<工程>
- 立项: 灰熊坦克现代化改装工程
  基地: 北坡基地
- 注资:
    id: ${PROJECT_ID}
    phase: 1
</工程>`;
    const r1 = parseMessageText(rawArrayShorthand, baseline, {});
    expect(r1.quarantine).toHaveLength(0);
    expect(r1.engOrders).toEqual([
      { verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' },
      { verb: '注资', id: PROJECT_ID, phase: 1 },
    ]);

    const rawTopShorthand = `<工程>
立项: 灰熊坦克现代化改装工程
基地: 北坡基地
</工程>`;
    const r2 = parseMessageText(rawTopShorthand, baseline, {});
    expect(r2.quarantine).toHaveLength(0);
    expect(r2.engOrders).toEqual([{ verb: '立项', name: '灰熊坦克现代化改装工程', base: 'beipo' }]);
  });

  it('BUG-LIVE-13（#42楼实机复现）：<工程> 顶层 YAML 数组「操作: 立项」+「操作: 指派模块」成功立项 V2 轨道空间站并确认指派 core 模块至恶土前哨主基地生成 eng:eng.orbital 队列项', () => {
    const orbitalStationDef: ProjectDef = {
      id: 'common.project.orbital_station',
      kind: 'project',
      name: '轨道空间站',
      grade: '巨构',
      requirements: {
        research: '空间站建造工学',
        credits: 600000,
        nanites: 20000,
      },
      modules: [
        { id: 'core', name: '核心舱', cost: 200000, workload: { days: 30, min_days: 15 }, prereqs: [] },
        { id: 'hab', name: '居住舱', cost: 120000, workload: { days: 18, min_days: 9 }, prereqs: ['core'] },
      ],
    };

    const floor42Baseline = Schema.parse({
      tech: { done: ['空间站建造工学'] },
      economy: {
        credits: 800000,
        resources: { nanites: { 标准纳米工料: 30000 } },
      },
      bases: [
        {
          id: '恶土前哨主基地',
          name: '恶土前哨主基地',
          buildings: [{ name: '大型航天发射综合体', state: '运转' }],
        },
      ],
      queues: [],
      projects: [],
    });

    const rawFloor42 = `<工程>
- 操作: 立项
  工程: 轨道空间站
  基地: 恶土前哨主基地
- 操作: 指派模块
  工程: 轨道空间站
  模块: core
  基地: 恶土前哨主基地
</工程>`;

    const parsed = parseMessageText(rawFloor42, floor42Baseline, {});
    expect(parsed.quarantine).toHaveLength(0);
    expect(parsed.engOrders).toEqual([
      { verb: '立项', name: '轨道空间站', base: '恶土前哨主基地' },
      {
        verb: '指派',
        action: 'allocate',
        id: '轨道空间站',
        instanceId: '轨道空间站',
        rawName: '轨道空间站',
        module: 'core',
        base: '恶土前哨主基地',
      },
    ]);

    const bridged = applyEngOrders(parsed.data, parsed.engOrders, [], [orbitalStationDef]);
    expect(bridged.quarantine).toHaveLength(0);
    expect(bridged.next.projects).toHaveLength(1);

    const createdProj = bridged.next.projects[0];
    expect(isProjectV2(createdProj)).toBe(true);
    if (!isProjectV2(createdProj)) return;
    expect(createdProj.ref).toBe('轨道空间站');
    expect(createdProj.lead_base).toBe('恶土前哨主基地');
    const coreMod = createdProj.modules.find(m => m.id === 'core');
    expect(coreMod).toMatchObject({
      id: 'core',
      name: '核心舱',
      status: '进行中',
      base: '恶土前哨主基地',
    });

    const orbitalQueue = bridged.next.queues.find(q => q.item === '轨道空间站·核心舱');
    expect(orbitalQueue).toMatchObject({
      type: '工程',
      item: '轨道空间站·核心舱',
      base: '恶土前哨主基地',
      lane: 'eng:eng.orbital',
      status: 'queued',
    });
  });

  it('BUG-LIVE-20a（#58楼实机复现）：<工程> 省略阶段号「操作: 注资, 工程: 犀牛坦克现代化改装工程」解析层放行，接缝层自动定位下一就绪未启动阶段', () => {
    const rhinoDef: RetrofitDef = {
      ...DEF,
      name: '犀牛坦克现代化改装工程',
    };
    const rhinoProjId = 'proj:犀牛坦克现代化改装工程@beipo';
    const rawFloor58 = `<工程>
- 操作: 注资
  工程: 犀牛坦克现代化改装工程
</工程>`;

    // 1. 当首阶段已完工、阶段 #1 未启动时，自动推导 phase=1 并成功启动
    const readyState = Schema.parse({
      tech: { done: ['重装机甲理论'] },
      economy: { credits: 5000, resources: { nanites: { 军工纳米工料: 100 } } },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
      projects: [
        {
          id: rhinoProjId,
          ref: '犀牛坦克现代化改装工程',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '中改',
          status: '在建',
          phases: [
            { idx: 0, name: '方案与备料', status: '完工', queue_index: null },
            { idx: 1, name: '总装与调校', status: '未启动', queue_index: null },
          ],
        },
      ],
    });
    const parsed58 = parseMessageText(rawFloor58, readyState, {});
    expect(parsed58.quarantine).toEqual([]);
    expect(parsed58.engOrders).toEqual([{ verb: '注资', id: rhinoProjId }]);

    const bridged58 = applyEngOrders(parsed58.data, parsed58.engOrders, [rhinoDef], []);
    expect(bridged58.quarantine).toEqual([]);
    const pAfter = bridged58.next.projects![0];
    expect(!isProjectV2(pAfter) && pAfter.phases[1].status).toBe('进行中');
    expect(bridged58.next.economy.credits).toBe(4200); // 5000 - 800

    // 2. 若前序阶段尚在进行中未完工，由引擎按 phase_order 门禁给出明确黄灯提示
    const inProgressState = parseBaseline();
    const parsedInProg = parseMessageText('<工程>\n- 操作: 注资\n  工程: 灰熊坦克现代化改装工程\n</工程>', inProgressState, {});
    expect(parsedInProg.quarantine).toEqual([]);
    const bridgedInProg = applyEngOrders(parsedInProg.data, parsedInProg.engOrders, [DEF], []);
    expect(bridgedInProg.events.some(e => e.light === '🟡' && /phase_order/.test(e.message))).toBe(true);

    // 3. V2 工程未指定 module：若仅有唯一可启动就绪模块（core 已完工，hab 为唯一未启动且前置满足），自动选用 hab；否则给黄灯提示
    const v2SingleReady = Schema.parse({
      economy: { credits: 5000, resources: { nanites: { 高能纳米工料: 100 } } },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '航天发射中心', state: '运转' }] }],
      projects: [
        {
          id: V2_PROJECT_ID,
          ref: '空间站',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '巨构',
          status: '在建',
          schema_version: 2,
          modules: [
            { id: 'core', name: '核心舱', status: '完工', base: 'beipo', queue_index: null },
            { id: 'hab', name: '居住舱', status: '未启动', base: '', queue_index: null },
          ],
        },
      ],
    });
    const bridgedV2Ready = applyEngOrders(v2SingleReady, [{ verb: '注资', id: V2_PROJECT_ID }], [], [V2DEF]);
    expect(bridgedV2Ready.quarantine).toEqual([]);
    const v2After = bridgedV2Ready.next.projects![0];
    expect(isProjectV2(v2After) && v2After.modules.find(m => m.id === 'hab')?.status).toBe('进行中');
  });

  it('BUG-R2-07：<工程> 动词别名支持 继续/继续工程/继续模块/重新启动 归一为 恢复', () => {
    const baseline = parseBaseline();
    for (const alias of ['继续', '继续工程', '继续模块', '重新启动']) {
      const raw = `<工程>\n- 操作: ${alias}\n  工程: ${PROJECT_ID}\n</工程>`;
      const parsed = parseMessageText(raw, baseline, {});
      expect(parsed.quarantine).toEqual([]);
      expect(parsed.engOrders).toEqual([{ verb: '恢复', id: PROJECT_ID }]);
    }
  });

  it('BUG-R2-07b（#28楼实机复现）：支持 <工程> 下 动词键 + 数组标量简写（如「继续:\\n  - 布拉德利现代化改装工程」）并恢复暂停中的工程', () => {
    const bradleyDef: RetrofitDef = {
      ...DEF,
      name: '布拉德利现代化改装工程',
    };
    const bradleyId = 'proj:布拉德利现代化改装工程@beipo';
    const pausedBaseline = Schema.parse({
      tech: { done: ['重装机甲理论'] },
      economy: { credits: 5000, resources: { nanites: { 军工纳米工料: 100 } } },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
      projects: [
        {
          id: bradleyId,
          ref: '布拉德利现代化改装工程',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '中改',
          status: '暂停',
          phases: [
            { idx: 0, name: '方案与备料', status: '暂停', queue_index: 0 },
            { idx: 1, name: '总装与调校', status: '未启动', queue_index: null },
          ],
        },
      ],
      queues: [
        {
          base: 'beipo',
          type: '工程',
          item: '布拉德利现代化改装工程·方案与备料',
          progress: 35,
          eta: '1d',
          status: 'active',
          hold: true,
        },
      ],
    });

    const rawFloor28 = `<工程>
继续:
  - 布拉德利现代化改装工程
</工程>`;
    const parsed28 = parseMessageText(rawFloor28, pausedBaseline, {});
    expect(parsed28.quarantine).toEqual([]);
    expect(parsed28.engOrders).toEqual([{ verb: '恢复', id: bradleyId }]);

    const bridged28 = applyEngOrders(parsed28.data, parsed28.engOrders, [bradleyDef], []);
    expect(bridged28.quarantine).toEqual([]);
    expect(bridged28.next.projects[0].status).toBe('在建');
    expect(!isProjectV2(bridged28.next.projects[0]) && bridged28.next.projects[0].phases[0].status).toBe('进行中');
    expect(bridged28.next.queues[0].hold).toBe(false);
  });
});
