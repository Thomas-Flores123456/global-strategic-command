/**
 * projectEngine.test.ts —— ENG-PROJ-01 验收测试（投影引擎与纳米开工门）
 *
 * 真源：docs/project/plans/工程玩法MVP任务包.md §3.1/§3.3/§3.5/§6 ENG-PROJ-01；
 *       决策记录 D1-C/D6/D8/D8b/D13-A/D21。
 * 覆盖任务卡验收①~⑧：
 * ① 立项前置科技门（缺科技拒立项）＋容量门＋首期注资扣账；
 * ② 纳米不足→开工门 hold（阶段不启动、工程不暴毙、库存不抵扣）；
 * ③ 资金断→阶段停摆不暴毙；
 * ④ 投影项吃 Δt 与两阶段加速（≤2x 天然上限＋min_days_lock 钳制断言）；
 * ⑤ 里程碑回写：投影项 done → 阶段完工 → 全完工 outcome mark（不写 codex）；
 * ⑥ 取消结算文本路径（注资不退、进度作废、纳米无变动）；
 * ⑦ theater 工程各阶段属地容量结算（D21 轮转归属＋属地槽容量）；
 * ⑧ laneBoard 不吞 '工程' 队列项（productionLanes 顺带守卫）；
 * ⑨ 全量回归零红由 npm test 佐证。
 *
 * 权重裁决已闭：D25 驾驶员授权（2026-10-10）weightsForType 加一行派发，
 * '工程' 沿用改装档 WEIGHT_TENSOR（0.3/0.7），断言钉在 twoStageAssemblyEngine.test.ts。
 */
import { describe, expect, it } from 'vitest';
import type { RetrofitDef } from '../core/catalog';
import { engSlotCapacityInBase, ENGINEERING_SLOT_REGISTRY, makeEngParallelLimitFor } from '../engines/engineeringSlots';
import { canon } from '../parse/parsePipeline';
import { laneBoard } from '../engines/productionLanes';
import { Schema } from '../core/schema';
import type { ProjectV1 } from '../core/schema';
import { settleFloor } from '../engines/settleFloor';
import { phase2Multiplier, rawSpeedup, settleWithTwoStage } from '../engines/twoStageAssemblyEngine';
import {
  availableNanites,
  cancelProject,
  engAssemblySpecFor,
  pauseProject,
  phaseBase,
  projectionItemName,
  resumeProject,
  startPhase,
  startProject,
  syncProjects,
  type ProjectQueueItem,
  type ProjectStateView,
} from '../engines/projectEngine';

/* ═══════════════ 测试工具 ═══════════════ */

/** 静态工程定义（中改 2 阶段；数值仅测试用，非 ENG-ECON-01 冻结数值） */
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

/** theater 变体（D21 属地轮转测试） */
const DEF_THEATER: RetrofitDef = { ...DEF, name: '战区电网现代化改装工程', scope: 'theater' };

interface TestState extends ProjectStateView {
  queues: ProjectQueueItem[];
  /** V2-01 适配：本文件 fixture 全为 V1 工程，收窄 projects 元素类型使 .phases 访问免守卫（断言零改动） */
  projects?: ProjectV1[];
}

/** 最小状态：单基地（一座可运转盟军建造厂=1 工程槽容量）、科技已就位、资金 5000、纳米 100 */
function mkState(overrides: Partial<TestState> = {}): TestState {
  return {
    tech: { done: ['重装机甲理论'] },
    economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 100, 高精构造型纳米: null } } },
    bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
    queues: [],
    projects: [],
    ...overrides,
  };
}

/** 把指定下标投影项标记为 done（模拟引擎/三色门终态，供里程碑回写测试） */
function markQueueDone<S extends TestState>(state: S, index: number): S {
  return {
    ...state,
    queues: state.queues.map((q, i) => (i === index ? { ...q, status: 'done' as const } : q)),
  };
}

/* ═══════════════ ① 立项：前置科技门 / 容量门 / 首期注资扣账 ═══════════════ */

describe('① 立项（§3.8 立项令：科技门＋容量门＋首期注资＋纳米开工门）', () => {
  it('缺前置科技 → 拒立项（research_gate），状态零写入', () => {
    const state = mkState({ tech: { done: [] } });
    const r = startProject(state, DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('research_gate');
    expect(r.message).toContain('重装机甲理论');
    expect(state.projects).toHaveLength(0);
    expect(state.queues).toHaveLength(0);
  });

  it('属地无锚定建筑 → 拒立项（no_slot）', () => {
    const state = mkState({
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '建造中' }] }],
    });
    const r = startProject(state, DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_slot');
  });

  it('静态定义缺 phases → 拒立项（no_phases）', () => {
    const r = startProject(mkState(), { ...DEF, phases: undefined }, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('no_phases');
  });

  it('通过：工程实例在建、阶段展开、首期注资扣账、首期投影 queued 带显式 lane 与工期/锁值', () => {
    const r = startProject(mkState(), DEF, { base: 'beipo' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const project = r.next.projects![0];
    expect(project).toMatchObject({
      id: 'proj:灰熊坦克现代化改装工程@beipo',
      ref: '灰熊坦克现代化改装工程',
      scope: 'base',
      bases: ['beipo'],
      lead_base: 'beipo',
      grade: '中改',
      status: '在建',
      schema_version: 1,
    });
    // 阶段从静态定义展开（D2-A），首期进行中并回写 queue_index
    expect(project.phases).toEqual([
      { idx: 0, name: '方案与备料', status: '进行中', queue_index: 0 },
      { idx: 1, name: '总装与调校', status: '未启动', queue_index: null },
    ]);
    // 首期注资扣账（只扣首期 400，不是总造价 1200——分阶段注资 D8）
    expect(r.next.economy!.credits).toBe(4600);
    // 投影项合同（§3.3）：type 工程 / 显式 lane / 工期与锁值投影时刻写入 / cost_paid 记账
    const item = r.next.queues[0];
    expect(item).toMatchObject({
      type: '工程',
      item: '灰熊坦克现代化改装工程·方案与备料',
      base: 'beipo',
      status: 'queued',
      lane: 'eng:eng.main',
      total_minutes: 3 * 1440,
      min_days_lock: 1,
      cost_paid: true,
      hold: false,
    });
    expect(r.events[0].type).toBe('project_started');
  });

  it('同 ref+lead 未完结工程 → 拒重复立项（duplicate）', () => {
    const first = startProject(mkState(), DEF, { base: 'beipo' });
    if (!first.ok) throw new Error('setup failed');
    const r = startProject(first.next as TestState, DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('duplicate');
  });
});

/* ═══════════════ ② 纳米开工门：不足→阶段不启动、工程不暴毙、不抵扣 ═══════════════ */

describe('② 纳米开工门（D8b/§3.5：门槛非抵扣）', () => {
  it('库存够首期不够次期：首期过门且库存分文未扣；次期注资 nanites_gate，工程保持在建、阶段未启动', () => {
    // 可用纳米 25：首期需求 20 过门，次期需求 30 被门拦下
    const state = mkState({ economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 25 } } } });
    const started = startProject(state, DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    // 开工门不抵扣：库存口径不变（D8b）
    expect(availableNanites(started.next)).toBe(25);

    // 首期完工（模拟投影项 done → 里程碑回写），再发次期注资令
    const s1 = syncProjects(markQueueDone(started.next as TestState, 0)).next as TestState;
    expect(s1.projects![0].phases[0].status).toBe('完工');

    const r = startPhase(s1, started.projectId, 1, DEF);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('nanites_gate');
    expect(r.message).toContain('开工门');
    expect(r.message).toContain('门槛不是抵扣');
    // 工程不暴毙：保持在建、阶段未启动、投影队列不增、资金未扣
    expect(s1.projects![0].status).toBe('在建');
    expect(s1.projects![0].phases[1]).toEqual({ idx: 1, name: '总装与调校', status: '未启动', queue_index: null });
    expect(s1.queues).toHaveLength(1);
    expect(s1.economy!.credits).toBe(4600);
  });

  it('立项期纳米不足 → 拒立项（nanites_gate），不留半成品工程', () => {
    const state = mkState({ economy: { credits: 5000, resources: { nanites: { 标准纳米工料: 5 } } } });
    const r = startProject(state, DEF, { base: 'beipo' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('nanites_gate');
    expect(state.projects).toHaveLength(0);
  });
});

/* ═══════════════ ③ 资金断链：阶段停摆不暴毙（D8） ═══════════════ */

describe('③ 资金分阶段注资（D8：断链=阶段停摆，非工程暴毙）', () => {
  it('次期资金不足 → 注资令搁置（funds），工程在建、阶段未启动、账务不动', () => {
    const state = mkState({ economy: { credits: 500, resources: { nanites: { 标准纳米工料: 100 } } } });
    const started = startProject(state, DEF, { base: 'beipo' }); // 扣首期 400 → 余 100
    if (!started.ok) throw new Error('setup failed');
    const s1 = syncProjects(markQueueDone(started.next as TestState, 0)).next as TestState;

    const r = startPhase(s1, started.projectId, 1, DEF); // 需 800 ＞ 100
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('funds');
    expect(r.message).toContain('停摆');
    expect(s1.projects![0].status).toBe('在建');
    expect(s1.projects![0].phases[1].status).toBe('未启动');
    expect(s1.queues).toHaveLength(1);
    expect(s1.economy!.credits).toBe(100);
  });

  it('越级注资 → phase_order（前序未完工不得启动后续阶段）', () => {
    const started = startProject(mkState(), DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const r = startPhase(started.next as TestState, started.projectId, 1, DEF);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('phase_order');
  });
});

/* ═══════════════ ④ 投影项吃 Δt 与两阶段加速（≤2x＋min_days_lock 钳制） ═══════════════ */

describe('④ 两阶段加速接缝（D6：继承冻结公式，不加新杠杆）', () => {
  const spec = engAssemblySpecFor([DEF], { type: '工程', item: '灰熊坦克现代化改装工程·方案与备料' });

  it('engAssemblySpecFor：按 `ref·阶段名` 解析静态 phase workload（只映射 tflops/tops，不映射 req_nanites）', () => {
    expect(spec).toEqual({ tflops: 10 });
    expect(spec).not.toHaveProperty('req_nanites'); // 开工门≠抵扣，结构性隔离
    expect(engAssemblySpecFor([DEF], { type: '研究', item: 'x·y' })).toBeUndefined();
    expect(engAssemblySpecFor([DEF], { type: '工程', item: '无分隔符' })).toBeUndefined();
    expect(engAssemblySpecFor([DEF], { type: '工程', item: '灰熊坦克现代化改装工程·查无此阶段' })).toBeUndefined();
  });

  it('加速天然上限 ≤2x（双轨齐声明且超配满足度封顶 → 1+w_f+w_t=2，永不越界）', () => {
    const dual = { tflops: 10, tops: 10 }; // 双轨均声明的需求侧（两阶段定义各一轨的并集形态）
    expect(rawSpeedup('工程', dual, { tflops: 1000, tops: 1000 })).toBeLessThanOrEqual(2);
    expect(rawSpeedup('工程', dual, { tflops: 1000, tops: 1000 })).toBe(2);
    // 单轨声明（本测试 DEF 阶段实况：只声明 tflops）→ 另一轨不参与，raw=1+w_f（D25 TENSOR=1.3）
    expect(rawSpeedup('工程', spec, { tflops: 1000, tops: 1000 })).toBe(1.3);
    // 算力缺席 → 恒 1（不吃加速；算力永不作前置的镜像：无算力不停工）
    expect(rawSpeedup('工程', spec, { tflops: 0, tops: 0 })).toBe(1);
  });

  it('min_days_lock 钳制（工程走 生产/建造/改装 冻结式：阶段二墙钟 ≥ lock）', () => {
    // 阶段工期 3 天（4320 分），50/50 分界 → 阶段二 2160 分；lock=1 天=1440 分
    // 双轨满配 raw=2 → 钳制乘子 = min(2, 2160/1440) = 1.5
    const txn = {
      type: '工程',
      total_minutes: 4320,
      min_days_lock: 1,
    } as Parameters<typeof phase2Multiplier>[0];
    const mult = phase2Multiplier(txn, { tflops: 10, tops: 10 }, { tflops: 1000, tops: 1000 });
    expect(mult).toBeCloseTo(1.5, 10);
    expect(mult).toBeLessThanOrEqual(2);
    // 无锁同名事务：乘子放满 raw（证明上例 1.5 来自 lock 钳制而非需求声明）
    const unlocked = phase2Multiplier({ ...txn, min_days_lock: 0 }, { tflops: 10, tops: 10 }, { tflops: 1000, tops: 1000 });
    expect(unlocked).toBe(2);
  });

  it('端到端：投影项经 settleWithTwoStage 吃 Δt，阶段二按钳制乘子积分；阶段一不吃加速', () => {
    const base: ProjectQueueItem = {
      type: '工程',
      item: '灰熊坦克现代化改装工程·方案与备料',
      base: 'beipo',
      progress: 0,
      eta: '',
      status: 'active',
      started_at: '2042-03-14 08:00',
      total_minutes: 4320,
      spent_minutes: 0,
      qty: 1,
      qty_done: 0,
      cost_paid: true,
      min_days_lock: 1,
      hold: false,
      lane: 'eng:eng.main',
    };
    const options = {
      assemblyFor: (t: { type: string; item: string }) => engAssemblySpecFor([DEF], t),
      computeFor: () => ({ tflops: 1000, tops: 1000 }),
    };
    // 阶段一（spent=1000 < 2160）：Δt=100 → 只吃基础 eff=1，不吃算力
    const p1 = settleWithTwoStage({ queues: [{ ...base, spent_minutes: 1000 }] }, 100, options);
    expect(p1.next.queues[0].spent_minutes).toBe(1100);
    // 阶段二（spent=2160）：Δt=100 × 乘子 1.3（D25 TENSOR 单轨 raw=1.3 与 lock 钳 1.5 取小）→ +130
    const p2 = settleWithTwoStage({ queues: [{ ...base, spent_minutes: 2160 }] }, 100, options);
    expect(p2.next.queues[0].spent_minutes).toBe(2290);
    expect(p2.next.queues[0].progress).toBeCloseTo((2290 / 4320) * 100, 6);
    // 双轨满配变体：raw 放到天然上限 2x，lock=1 天仍钳回 1.5（钳制优先级断言）
    const dualOptions = { ...options, assemblyFor: () => ({ tflops: 10, tops: 10 }) };
    const p3 = settleWithTwoStage({ queues: [{ ...base, spent_minutes: 2160 }] }, 100, dualOptions);
    expect(p3.next.queues[0].spent_minutes).toBe(2310);
    // 双轨满配＋无锁：乘子放满 2x → +200（证明上限恰为 2 且可被 lock 以外路径触达）
    const p4 = settleWithTwoStage(
      { queues: [{ ...base, spent_minutes: 2160, min_days_lock: 0 }] },
      100,
      dualOptions,
    );
    expect(p4.next.queues[0].spent_minutes).toBe(2360);
  });
});

/* ═══════════════ ⑤ 里程碑回写：done → 阶段完工 → 全完工 outcome mark ═══════════════ */

describe('⑤ 里程碑回写（§3.3；D13-A outcome mark 只记账不写 codex）', () => {
  it('投影项 done → 阶段完工＋queue_index 释放；全部完工 → 工程完工＋outcome={type:mark}', () => {
    const started = startProject(mkState(), DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');

    // 第一期 done → 阶段完工，工程仍在建
    const s1r = syncProjects(markQueueDone(started.next as TestState, 0));
    const s1 = s1r.next as TestState;
    expect(s1.projects![0].phases[0]).toEqual({ idx: 0, name: '方案与备料', status: '完工', queue_index: null });
    expect(s1.projects![0].status).toBe('在建');
    expect(s1r.events.some(e => e.type === 'phase_milestone')).toBe(true);

    // 第二期注资 → done → 全完工：工程完工＋outcome mark
    const s2 = startPhase(s1, started.projectId, 1, DEF);
    if (!s2.ok) throw new Error('setup failed: ' + s2.message);
    expect((s2.next as TestState).queues[1]).toMatchObject({
      item: '灰熊坦克现代化改装工程·总装与调校',
      total_minutes: 4 * 1440,
      min_days_lock: 2,
    });
    const s3r = syncProjects(markQueueDone(s2.next as TestState, 1));
    const s3 = s3r.next as TestState;
    expect(s3.projects![0].status).toBe('完工');
    expect(s3.projects![0].outcome).toEqual({ type: 'mark' });
    const completed = s3r.events.find(e => e.type === 'project_completed');
    expect(completed?.detail).toContain('已改装');
    expect(completed?.detail).toContain('不写 codex');
    // codex 零写入（本模块状态视图根本没有 codex 字段——结构性保证）
    expect(s3).not.toHaveProperty('codex');
  });

  it('queue_index 身份不符 → sync_warn 跳过、指针保留（fail-open 可自愈）', () => {
    const started = startProject(mkState(), DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const tampered = {
      ...(started.next as TestState),
      queues: [{ ...(started.next as TestState).queues[0], item: '别的工程·别的阶段' }],
    };
    const r = syncProjects(tampered);
    expect(r.events.some(e => e.type === 'sync_warn')).toBe(true);
    expect((r.next as TestState).projects![0].phases[0].queue_index).toBe(0); // 指针保留
    expect((r.next as TestState).projects![0].phases[0].status).toBe('进行中');
  });

  it('settleFloor 集成：每楼结算自动里程碑回写；projects[] 缺席零行为变化', () => {
    const prev = Schema.parse({ meta: { world_id: 't', date: '2042-03-14', day_count: 1 } });
    const next = Schema.parse({
      meta: { world_id: 't', date: '2042-03-14', day_count: 1 },
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
      queues: [
        {
          type: '工程',
          item: '灰熊坦克现代化改装工程·方案与备料',
          base: 'beipo',
          status: 'done',
          total_minutes: 4320,
          spent_minutes: 4320,
          progress: 100,
          lane: 'eng:eng.main',
        },
      ],
      projects: [
        {
          id: 'proj:灰熊坦克现代化改装工程@beipo',
          ref: '灰熊坦克现代化改装工程',
          scope: 'base',
          bases: ['beipo'],
          lead_base: 'beipo',
          grade: '中改',
          status: '在建',
          phases: [
            { idx: 0, name: '方案与备料', status: '进行中', queue_index: 0 },
            { idx: 1, name: '总装与调校', status: '完工', queue_index: null },
          ],
        },
      ],
    });
    const r = settleFloor(prev, next, '正文无时间标签');
    // V2-01 判别联合：断言目标不变，仅收窄接收者类型（settleFloor 回写产物为 V1 工程）
    const project = r.data.projects![0] as ProjectV1;
    expect(project.phases[0]).toMatchObject({ status: '完工', queue_index: null });
    expect(project.status).toBe('完工');
    expect(project.outcome).toEqual({ type: 'mark' });
    expect(r.events.some(e => e.message.includes('[工程] project_completed'))).toBe(true);
  });
});

/* ═══════════════ 暂停 / 恢复（透传 hold 语义） ═══════════════ */

describe('暂停/恢复（§3.3：投影项 hold 语义透传＋phase.status 同步）', () => {
  it('暂停：active 投影项退回 queued＋hold（进度保留），工程/阶段置暂停；恢复清 hold 重新竞争', () => {
    const started = startProject(mkState(), DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    // 模拟引擎升格为 active 且已有进度
    const active = {
      ...(started.next as TestState),
      queues: [{ ...(started.next as TestState).queues[0], status: 'active' as const, spent_minutes: 500, progress: 11 }],
    };

    const paused = pauseProject(active, started.projectId);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    const pState = paused.next as TestState;
    expect(pState.projects![0].status).toBe('暂停');
    expect(pState.projects![0].phases[0].status).toBe('暂停');
    expect(pState.queues[0]).toMatchObject({ status: 'queued', hold: true, spent_minutes: 500, progress: 11 });

    const resumed = resumeProject(pState, started.projectId);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    const rState = resumed.next as TestState;
    expect(rState.projects![0].status).toBe('在建');
    expect(rState.projects![0].phases[0].status).toBe('进行中');
    expect(rState.queues[0]).toMatchObject({ status: 'queued', hold: false, spent_minutes: 500 });
  });

  it('状态门：在建才能暂停、暂停才能恢复（bad_status）', () => {
    const started = startProject(mkState(), DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const r = resumeProject(started.next as TestState, started.projectId);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('bad_status');
  });
});

/* ═══════════════ ⑥ 取消：投影项 cancelled＋固定结算文案 ═══════════════ */

describe('⑥ 取消（§3.3：注资不退、进度作废，结算说明文本供 UI 复用）', () => {
  it('在途工程取消：投影项 cancelled、阶段置取消释放指针、工程置取消；结算文案要素齐全', () => {
    const started = startProject(mkState(), DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');

    const r = cancelProject(started.next as TestState, started.projectId, DEF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = r.next as TestState;
    expect(state.queues[0].status).toBe('cancelled');
    expect(state.projects![0].status).toBe('取消');
    expect(state.projects![0].phases[0]).toEqual({ idx: 0, name: '方案与备料', status: '取消', queue_index: null });
    // §3.3 固定文案：已注资阶段点名＋金额不退＋进度作废＋纳米无变动
    expect(r.settlementText).toContain('方案与备料');
    expect(r.settlementText).toContain('400');
    expect(r.settlementText).toContain('不予退还');
    expect(r.settlementText).toContain('折算进度全部作废');
    expect(r.settlementText).toContain('纳米库存无变动');
    expect(r.events[0].type).toBe('project_cancelled');
  });

  it('部分完工后取消：完工阶段保留不退，只在途阶段取消；金额只计已注资阶段', () => {
    const started = startProject(mkState(), DEF, { base: 'beipo' });
    if (!started.ok) throw new Error('setup failed');
    const s1 = syncProjects(markQueueDone(started.next as TestState, 0)).next as TestState;
    const s2 = startPhase(s1, started.projectId, 1, DEF);
    if (!s2.ok) throw new Error('setup failed');

    const r = cancelProject(s2.next as TestState, started.projectId, DEF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const state = r.next as TestState;
    expect(state.projects![0].phases[0].status).toBe('完工'); // 完工阶段不回滚
    expect(state.projects![0].phases[1].status).toBe('取消');
    expect(state.queues[0].status).toBe('done'); // 已终态不动
    expect(state.queues[1].status).toBe('cancelled');
    expect(r.settlementText).toContain('1200'); // 两期注资合计 400+800
    expect(r.settlementText).toContain('已注资 2 个阶段');
  });
});

/* ═══════════════ ⑦ theater 工程各阶段属地容量结算（D21） ═══════════════ */

describe('⑦ theater 属地结算（D21：各阶段占用属地基地工程槽容量）', () => {
  function mkTheaterState(): TestState {
    return mkState({
      bases: [
        { id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] },
        {
          id: 'south',
          name: '南岭基地',
          buildings: [
            { name: '苏联建造厂', state: '运转' },
            { name: '战地维修所', state: '运转' },
          ],
        },
      ],
    });
  }

  it('阶段属地轮转：phase0→bases[0]、phase1→bases[1]；投影项 base 即属地', () => {
    const started = startProject(mkTheaterState(), DEF_THEATER, { base: 'beipo', bases: ['beipo', 'south'] });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const project = (started.next as TestState).projects![0];
    expect(project.scope).toBe('theater');
    expect(phaseBase(project, 0)).toBe('beipo');
    expect(phaseBase(project, 1)).toBe('south');
    expect((started.next as TestState).queues[0].base).toBe('beipo');

    const s1 = syncProjects(markQueueDone(started.next as TestState, 0)).next as TestState;
    const s2 = startPhase(s1, started.projectId, 1, DEF_THEATER);
    if (!s2.ok) throw new Error('setup failed: ' + s2.message);
    expect((s2.next as TestState).queues[1].base).toBe('south');
  });

  it('属地容量分基地独立裁决：south 双锚=2、beipo 单锚=1，跨基地互不挤占', () => {
    const state = mkTheaterState();
    const limitFor = makeEngParallelLimitFor(state);
    const at = (base: string): ProjectQueueItem => ({
      type: '工程',
      item: '战区电网现代化改装工程·方案与备料',
      base,
      progress: 0,
      eta: '',
      status: 'active',
      started_at: '',
      total_minutes: 4320,
      spent_minutes: 0,
      qty: 1,
      qty_done: 0,
      cost_paid: true,
      min_days_lock: 0,
      hold: false,
      lane: 'eng:eng.main',
    });
    expect(limitFor(at('beipo'))).toBe(1);
    expect(limitFor(at('south'))).toBe(2);
    expect(engSlotCapacityInBase(state, 'south', ENGINEERING_SLOT_REGISTRY[0])).toBe(2);
  });

  it('theater 参与基地 <2 → invalid_bases（对齐 schema superRefine 口径）', () => {
    const r = startProject(mkTheaterState(), DEF_THEATER, { base: 'beipo', bases: ['beipo'] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('invalid_bases');
  });
});

/* ═══════════════ ⑧ laneBoard 不吞 '工程' 队列项（顺带守卫） ═══════════════ */

describe('⑧ laneBoard 展示层守卫（productionLanes 归线循环 工程 continue）', () => {
  it('工程投影项不进任何产线条目的 active/queued', () => {
    const item: ProjectQueueItem = {
      type: '工程',
      item: projectionItemName(DEF.name, '方案与备料'),
      base: 'beipo',
      progress: 0,
      eta: '',
      status: 'active',
      started_at: '',
      total_minutes: 4320,
      spent_minutes: 0,
      qty: 1,
      qty_done: 0,
      cost_paid: true,
      min_days_lock: 0,
      hold: false,
      lane: 'eng:eng.main',
    };
    const state = {
      bases: [{ id: 'beipo', name: '北坡基地', buildings: [{ name: '盟军建造厂', state: '运转' }] }],
      queues: [item],
    };
    const board = laneBoard(state);
    const swallowed = board.some(
      entry => entry.active.some(name => canon(name) === canon(item.item)) || entry.queued > 0,
    );
    expect(swallowed).toBe(false);
  });

  it('FIX-P1-02：已激活战略协议（protocols.status===active）满足 V1 工程立项前置门', () => {
    const defWithProto: RetrofitDef = {
      ...DEF,
      name: '侦察无人机改装工程',
      research: '高空无人侦察协定',
    };
    const state = mkState({
      tech: { done: [] },
      protocols: {
        'all.protocol.ra3.high_altitude_uav_pact': {
          id: 'all.protocol.ra3.high_altitude_uav_pact',
          title: '高空无人侦察协定',
          status: 'active',
        },
      },
    } as Partial<TestState>);
    const r = startProject(state, defWithProto, { base: 'beipo' });
    expect(r.ok).toBe(true);
  });

  it('FIX-P1-03：queue_index 下标漂移时 pauseProject / cancelProject 自动按 (工程, base, item) 重定位，且暂停项释放工程槽位', () => {
    const started = startProject(mkState(), DEF, { base: 'beipo' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const s0 = started.next as TestState;

    // 模拟 reconcileProduction 在队列头部插入了一条非工程项，导致原 queue_index=0 漂移到 index=1
    const drifted: TestState = {
      ...s0,
      queues: [
        {
          type: '建筑',
          item: '发电厂',
          base: 'beipo',
          progress: 50,
          eta: '',
          status: 'active',
          started_at: '',
          total_minutes: 60,
          spent_minutes: 30,
          qty: 1,
          qty_done: 0,
          cost_paid: true,
          min_days_lock: 0,
          hold: false,
        },
        ...s0.queues,
      ],
    };

    const paused = pauseProject(drifted, started.projectId);
    expect(paused.ok).toBe(true);
    if (!paused.ok) return;
    // index 0 的「发电厂」未被误伤，index 1 的工程投影项被正确置 hold 并重定位回写 queue_index=1
    expect((paused.next as TestState).queues[0].item).toBe('发电厂');
    expect((paused.next as TestState).queues[0].hold).toBe(false);
    expect((paused.next as TestState).queues[1].hold).toBe(true);
    expect((paused.next as TestState).projects![0].phases[0].queue_index).toBe(1);
    // 暂停后释放工程槽位（单槽基地可立即立项新工程而不报 slot_full）
    const secondDef: ProjectDef = { ...DEF, name: '二号试验装置' };
    const started2 = startProject(paused.next as TestState, secondDef, { base: 'beipo' });
    expect(started2.ok).toBe(true);
  });
});
