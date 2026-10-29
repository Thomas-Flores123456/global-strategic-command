/**
 * engCommands.test.ts —— ENG-UI-03 / ENG-PROTO-02 指令闭环五令拼装与状态门钉死
 *
 * 覆盖（任务卡验收①④）：
 * 1. 五令文本逐字断言（DIR-10 / D-R10-a【工程指令】自然语言模板）+ 不含 `/` 前缀（D-RM02-1）；
 * 2. 非法输入 fail-closed（空串/空白/控制字符/@ 碰撞/非法阶段号一律 RangeError，不产出半条指令）；
 * 3. 取消结算文案 parity——对 projectEngine.cancelProject 实调比对 settlementText 逐字相等
 *    （本任务不直接调引擎；测试侧比对钉死模板漂移）；
 * 4. 状态门矩阵（在建/暂停/规划中/完工/取消 × 注资/暂停/恢复/取消）；
 * 5. 立项目标裁决（D-R10-d：废弃排除/容量优选/回退、快照缺席禁用）与 buildOrderForButton 派发；
 *    V2-12/D-V2RM-1：槽感知分流——V2 def（kind==='project'/modules 在场）按 eng.orbital 轨道泊位
 *    口径优选（与引擎 startProjectV2 no_slot 门同槽），V1 retrofit 维持 eng.main 口径零变化；
 * 6. 不自动发送红线（D-R10-b）grep 断言：UI 链路（hostSendInput/ModalEngineering/DetailDrawer）零 send 触发；
 * 7. V2-07 仓段化面：模块级三令逐字断言（模块名定位，不用 id）+ 模块名转义 fail-closed；
 * 8. V2-07 按钮派发与状态门矩阵（工程级同 V1 文本、工程级注资拒收；模块级拓扑前置门/终态禁用）；
 * 9. V2-07 取消结算 parity（对 cancelProjectV2 实调）与 engV2ModuleCards 网格派生（五态/承建/投影名/置灰）。
 */
import { describe, expect, it } from 'vitest';
// 项目 tsconfig 的 types 白名单不含 node（静态 import 'node:fs' 会产生 TS2591/TS2304 基线外错误，
// 验收④：tsc 零新增）；以运行时动态导入 + 本地最小类型契约替代（对齐 engScene.test.ts 先例），
// 路径一律走 import.meta.url 派生的 file: URL（node fs 直收 URL）。
interface NodeFsLike {
  readFileSync(path: URL, encoding: 'utf8'): string;
}
const nodeFs: Promise<NodeFsLike> = import('node:' + 'fs') as unknown as Promise<NodeFsLike>;
import {
  ENG_COMMAND_COPY,
  buildCancelOrder,
  buildCancelSettlement,
  buildCancelSettlementV2,
  buildFundModuleOrder,
  buildFundOrder,
  buildInitiateOrder,
  buildOrderForButton,
  buildOrderForV2ModuleButton,
  buildOrderForV2ProjectButton,
  buildPauseModuleOrder,
  buildPauseOrder,
  buildResumeModuleOrder,
  buildResumeOrder,
  engCommandButtonsFor,
  engV2ModuleButtons,
  engV2ModuleCards,
  engV2ProjectButtons,
  initiateTargetFor,
  nextPendingPhase,
} from '../models/engCommands';
import { cancelProject, cancelProjectV2, type ProjectV2Def } from '../../红警指挥系统/engines/projectEngine';
import {
  alignEngineeringActionWithDispatchBus,
  engVerbToUnifiedCommandType,
  projectEngineeringObserverView,
} from '../../红警指挥系统/engines/engOrderBridge';
import type { RetrofitDef } from '../../红警指挥系统/core/catalog';
import type { ProjectV1, ProjectV2 } from '../../红警指挥系统/core/schema';

/** UI 链路源码 URL（红线 grep 断言用） */
const HOST_SEND_INPUT_URL = new URL('../../红警指挥系统/worldbook/hostSendInput.ts', import.meta.url);
const MODAL_ENGINEERING_URL = new URL('../modals/ModalEngineering.vue', import.meta.url);
const MODAL_TECH_TREE_URL = new URL('../modals/ModalTechTree.vue', import.meta.url);
const ENG_ORDER_BRIDGE_URL = new URL('../../红警指挥系统/engines/engOrderBridge.ts', import.meta.url);
const DETAIL_DRAWER_URL = new URL('../../红警指挥系统/ui/DetailDrawer.vue', import.meta.url);

/* ═══════════════ 夹具 ═══════════════ */

function makeProject(overrides: Partial<ProjectV1> = {}): ProjectV1 {
  return {
    id: 'proj:灰熊坦克现代化改装工程@beipo',
    ref: '灰熊坦克现代化改装工程',
    scope: 'base',
    bases: ['beipo'],
    lead_base: 'beipo',
    grade: '大改',
    status: '在建',
    phases: [
      { idx: 0, name: '底盘拆解', status: '完工', queue_index: null },
      { idx: 1, name: '混动APU换装', status: '完工', queue_index: null },
      { idx: 2, name: '主动防御集成', status: '进行中', queue_index: null },
      { idx: 3, name: '车际网络联调', status: '未启动', queue_index: null },
      { idx: 4, name: '出厂验收', status: '未启动', queue_index: null },
    ],
    outcome: { type: 'mark' },
    schema_version: 1,
    ...overrides,
  };
}

const DEF: RetrofitDef = {
  kind: 'retrofit',
  name: '灰熊坦克现代化改装工程',
  research: '混合动力装甲工学',
  grade: '大改',
  desc: '混动APU+主动防御系统+车际数据网络。',
  cost: 3000,
  phases: [
    { name: '底盘拆解', workload: { days: 5, min_days: 2 }, cost: 600, resources: { nanites: 10 } },
    { name: '混动APU换装', workload: { days: 5, min_days: 2 }, cost: 600, resources: { nanites: 10 } },
    { name: '主动防御集成', workload: { days: 5, min_days: 2 }, cost: 600, resources: { nanites: 10 } },
    { name: '车际网络联调', workload: { days: 5, min_days: 2 }, cost: 600, resources: { nanites: 10 } },
    { name: '出厂验收', workload: { days: 5, min_days: 2 }, cost: 600, resources: { nanites: 10 } },
  ],
};

/* ═══════════════ ① 五令文本逐字断言（DIR-10 自然语言模板） ═══════════════ */

describe('ENG-PROTO-02 · 五令文本逐字断言（DIR-10【工程指令】模板）', () => {
  it('立项令：【工程指令】立项「<工程名>」，牵头基地：<基地名>', () => {
    expect(buildInitiateOrder('灰熊坦克现代化改装工程', '北坡主基地')).toBe(
      '【工程指令】立项「灰熊坦克现代化改装工程」，牵头基地：北坡主基地',
    );
  });

  it('注资令：【工程指令】注资「<工程实例>」第 <阶段号> 阶段', () => {
    expect(buildFundOrder('proj:灰熊坦克现代化改装工程@beipo', 3)).toBe(
      '【工程指令】注资「proj:灰熊坦克现代化改装工程@beipo」第 3 阶段',
    );
  });

  it('暂停令：【工程指令】暂停「<工程实例>」', () => {
    expect(buildPauseOrder('proj:灰熊坦克现代化改装工程@beipo')).toBe(
      '【工程指令】暂停「proj:灰熊坦克现代化改装工程@beipo」',
    );
  });

  it('恢复令：【工程指令】恢复「<工程实例>」', () => {
    expect(buildResumeOrder('proj:灰熊坦克现代化改装工程@beipo')).toBe(
      '【工程指令】恢复「proj:灰熊坦克现代化改装工程@beipo」',
    );
  });

  it('取消令：【工程指令】取消「<工程实例>」', () => {
    expect(buildCancelOrder('proj:灰熊坦克现代化改装工程@beipo')).toBe(
      '【工程指令】取消「proj:灰熊坦克现代化改装工程@beipo」',
    );
  });

  it('五令均不含 `/` 前缀（D-RM02-1：宿主 STScript 斜杠令拦截红线）', () => {
    const texts = [
      buildInitiateOrder('灰熊坦克现代化改装工程', '北坡主基地'),
      buildFundOrder('proj:灰熊坦克现代化改装工程@beipo', 0),
      buildPauseOrder('proj:灰熊坦克现代化改装工程@beipo'),
      buildResumeOrder('proj:灰熊坦克现代化改装工程@beipo'),
      buildCancelOrder('proj:灰熊坦克现代化改装工程@beipo'),
    ];
    for (const t of texts) {
      expect(t.startsWith('/')).toBe(false);
      expect(t).not.toContain('/工程');
      expect(t.startsWith('【工程指令】')).toBe(true);
    }
  });

  it('名首尾空白先 trim 再拼（确定性规范化）', () => {
    expect(buildInitiateOrder('  灰熊坦克现代化改装工程  ', ' 北坡主基地 ')).toBe(
      '【工程指令】立项「灰熊坦克现代化改装工程」，牵头基地：北坡主基地',
    );
  });
});

/* ═══════════════ ② 非法输入 fail-closed ═══════════════ */

describe('ENG-UI-03 · 非法输入拒令（不产出半条指令）', () => {
  it('空名/纯空白 → RangeError', () => {
    expect(() => buildInitiateOrder('', '北坡主基地')).toThrow(RangeError);
    expect(() => buildInitiateOrder('   ', '北坡主基地')).toThrow(RangeError);
    expect(() => buildInitiateOrder('灰熊坦克现代化改装工程', '')).toThrow(RangeError);
    expect(() => buildPauseOrder('')).toThrow(RangeError);
  });

  it('名内空白（空格/换行/制表）会破坏单行指令形态 → RangeError', () => {
    expect(() => buildInitiateOrder('灰熊 坦克', '北坡主基地')).toThrow(/空白/);
    expect(() => buildFundOrder('proj:x\n@y', 1)).toThrow(/空白/);
    expect(() => buildCancelOrder('proj:x\t@y')).toThrow(/空白/);
    expect(() => buildInitiateOrder('灰熊坦克现代化改装工程', '北坡 主基地')).toThrow(/空白/);
  });

  it('工程名含 @（实例 id 保留字符，防混淆）→ RangeError；实例 id 含 @ 合法', () => {
    expect(() => buildInitiateOrder('灰熊@坦克', '北坡主基地')).toThrow(RangeError);
    expect(buildPauseOrder('proj:灰熊坦克现代化改装工程@beipo')).toContain('@beipo');
  });

  it('控制字符 → RangeError', () => {
    expect(() => buildResumeOrder('proj:x\u0007y')).toThrow(RangeError);
  });

  it('非法阶段号（负数/非整数/NaN）→ RangeError', () => {
    expect(() => buildFundOrder('proj:x@y', -1)).toThrow(RangeError);
    expect(() => buildFundOrder('proj:x@y', 1.5)).toThrow(RangeError);
    expect(() => buildFundOrder('proj:x@y', Number.NaN)).toThrow(RangeError);
  });
});

/* ═══════════════ ③ 取消结算文案 parity（对 cancelProject 实调比对） ═══════════════ */

describe('ENG-UI-03 · 取消结算文案 = cancelProject settlementText（§3.3 固定文案）', () => {
  it('带静态定义：金额口径逐字相等', () => {
    const p = makeProject();
    const res = cancelProject({ projects: [p], queues: [] }, p.id, DEF);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(buildCancelSettlement(p, DEF)).toBe(res.settlementText);
    // 结算要素钉死：注资不退 + 进度作废 + 纳米开工门无抵扣
    expect(res.settlementText).toContain('不予退还');
    expect(res.settlementText).toContain('折算进度全部作废');
    expect(res.settlementText).toContain('注资合计 1800 资金'); // 完工×2 + 进行中×1 = 3 阶段 × 600
  });

  it('缺静态定义：金额退化分支逐字相等', () => {
    const p = makeProject({ status: '暂停' });
    const res = cancelProject({ projects: [p], queues: [] }, p.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(buildCancelSettlement(p, null)).toBe(res.settlementText);
    expect(res.settlementText).toContain('已注资金额不予退还');
  });

  it('全未注资工程：已注资 0 个阶段（无）', () => {
    const p = makeProject({
      phases: [{ idx: 0, name: '底盘拆解', status: '未启动', queue_index: null }],
    });
    const res = cancelProject({ projects: [p], queues: [] }, p.id, DEF);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(buildCancelSettlement(p, DEF)).toBe(res.settlementText);
    expect(res.settlementText).toContain('已注资 0 个阶段（无）');
  });
});

/* ═══════════════ ④ 状态门矩阵 ═══════════════ */

describe('ENG-UI-03 · 状态门矩阵（按钮可用性按工程状态）', () => {
  const enabledMap = (status: ProjectV1['status'], phases = makeProject().phases) =>
    Object.fromEntries(engCommandButtonsFor(makeProject({ status, phases })).map(b => [b.verb, b.enabled]));

  it('在建：注资/暂停/取消可用，恢复禁用', () => {
    expect(enabledMap('在建')).toEqual({ 注资: true, 暂停: true, 恢复: false, 取消: true });
  });

  it('在建但全部阶段已启动（无未启动）：注资禁用并给出理由', () => {
    const phases = makeProject().phases.map(ph => (ph.status === '未启动' ? { ...ph, status: '进行中' as const } : ph));
    const buttons = engCommandButtonsFor(makeProject({ status: '在建', phases }));
    const fund = buttons.find(b => b.verb === '注资')!;
    expect(fund.enabled).toBe(false);
    expect(fund.hint).toBe(ENG_COMMAND_COPY.disabled.fundAllLaunched);
    expect(fund.phaseIdx).toBeNull();
  });

  it('暂停：恢复/取消可用，注资/暂停禁用', () => {
    expect(enabledMap('暂停')).toEqual({ 注资: false, 暂停: false, 恢复: true, 取消: true });
  });

  it('规划中：四令全禁（立项令在工程信息容器底部下达）', () => {
    const m = enabledMap('规划中');
    expect(m).toEqual({ 注资: false, 暂停: false, 恢复: false, 取消: false });
    const buttons = engCommandButtonsFor(makeProject({ status: '规划中' }));
    expect(buttons.every(b => !b.enabled)).toBe(true);
    expect(buttons.find(b => b.verb === '取消')!.hint).toBe(ENG_COMMAND_COPY.disabled.planning);
  });

  it('完工/取消（终态）：四令全禁', () => {
    for (const status of ['完工', '取消'] as const) {
      const buttons = engCommandButtonsFor(makeProject({ status }));
      expect(buttons.every(b => !b.enabled)).toBe(true);
      expect(buttons.find(b => b.verb === '注资')!.hint).toBe(ENG_COMMAND_COPY.disabled.terminal(status));
    }
  });

  it('注资按钮锁定下一未启动阶段（label 含阶段号与阶段名）', () => {
    const fund = engCommandButtonsFor(makeProject()).find(b => b.verb === '注资')!;
    expect(fund.phaseIdx).toBe(3);
    expect(fund.label).toBe('注资下一阶段 #3 车际网络联调');
  });

  it('nextPendingPhase：首个未启动；全完工 → null', () => {
    expect(nextPendingPhase(makeProject().phases)?.idx).toBe(3);
    const done = makeProject().phases.map(ph => ({ ...ph, status: '完工' as const }));
    expect(nextPendingPhase(done)).toBeNull();
  });
});

/* ═══════════════ ⑤ 立项目标裁决（D-R10-d）与按钮派发 ═══════════════ */

describe('ENG-PROTO-02 · 立项目标裁决与 buildOrderForButton', () => {
  it('常规：非废弃首条基地中选（name 优先，id 兜底）', () => {
    const t = initiateTargetFor({ name: '灰熊坦克现代化改装工程' }, [{ id: 'beipo', name: '北坡主基地' }]);
    expect(t).toMatchObject({ enabled: true, base: '北坡主基地' });
    const t2 = initiateTargetFor({ name: 'x' }, [{ id: 'beipo', name: '  ' }]);
    expect(t2).toMatchObject({ enabled: true, base: 'beipo' });
  });

  it('D-R10-d：bases[0] 为废弃「待侦知部署点」时跳过，选非废弃基地', () => {
    const t = initiateTargetFor({ name: '灰熊坦克现代化改装工程' }, [
      { id: 'scout', name: '待侦知部署点', status: '废弃', buildings: [] },
      { id: 'beipo', name: '北坡主基地', buildings: [{ name: '盟军建造厂', state: '运转' }] },
    ]);
    expect(t).toMatchObject({ enabled: true, base: '北坡主基地' });
  });

  it('容量优选：非废弃候选中优先选有工程槽容量（锚定建筑非建造中）的基地', () => {
    const t = initiateTargetFor({ name: 'x' }, [
      { id: 'yunxi', name: '云溪前哨', buildings: [{ name: '兵营', state: '运转' }] },
      { id: 'beipo', name: '北坡主基地', buildings: [{ name: '盟军建造厂', state: '运转' }] },
    ]);
    expect(t.base).toBe('北坡主基地');
  });

  it('锚定建筑建造中不计容量（对齐 engSlotCapacityInBase）', () => {
    const t = initiateTargetFor({ name: 'x' }, [
      { id: 'yunxi', name: '云溪前哨', buildings: [{ name: '盟军建造厂', state: '建造中' }] },
      { id: 'beipo', name: '北坡主基地', buildings: [{ name: '盟军建造厂', state: '运转' }] },
    ]);
    expect(t.base).toBe('北坡主基地');
  });

  it('容量不可判别（buildings 缺席）→ 不淘汰，回退非废弃首条', () => {
    const t = initiateTargetFor({ name: 'x' }, [
      { id: 'scout', name: '待侦知部署点', status: '废弃' },
      { id: 'yunxi', name: '云溪前哨' },
      { id: 'beipo', name: '北坡主基地' },
    ]);
    expect(t.base).toBe('云溪前哨');
  });

  it('全部基地均废弃 → 回退 bases[0]（fail-open 保可下达，受理/驳回交 AI 与引擎侧）', () => {
    const t = initiateTargetFor({ name: 'x' }, [
      { id: 'scout', name: '待侦知部署点', status: '废弃', buildings: [] },
      { id: 'old', name: '旧基地', status: '废弃', buildings: [] },
    ]);
    expect(t).toMatchObject({ enabled: true, base: '待侦知部署点' });
  });

  it('快照缺席/无基地 → 禁用并照实说明', () => {
    expect(initiateTargetFor({ name: 'x' }, undefined).enabled).toBe(false);
    expect(initiateTargetFor({ name: 'x' }, []).hint).toBe(ENG_COMMAND_COPY.initiate.noBase);
    expect(initiateTargetFor(null, [{ id: 'beipo', name: '北坡主基地' }]).enabled).toBe(false);
  });

  it('buildOrderForButton 四动词派发（注资用锁定阶段号）', () => {
    const p = makeProject();
    const buttons = engCommandButtonsFor(p);
    const text = (verb: string) =>
      buildOrderForButton(
        buttons.find(b => b.verb === verb)!,
        p.id,
      );
    expect(text('注资')).toBe(`【工程指令】注资「${p.id}」第 3 阶段`);
    expect(text('暂停')).toBe(`【工程指令】暂停「${p.id}」`);
    expect(text('取消')).toBe(`【工程指令】取消「${p.id}」`);
    const paused = engCommandButtonsFor(makeProject({ status: '暂停' }));
    expect(
      buildOrderForButton(
        paused.find(b => b.verb === '恢复')!,
        p.id,
      ),
    ).toBe(`【工程指令】恢复「${p.id}」`);
  });

  it('注资按钮缺阶段号 → RangeError（不产出半条指令）', () => {
    expect(() =>
      buildOrderForButton({ verb: '注资', label: '', enabled: true, hint: '', phaseIdx: null }, 'proj:x@y'),
    ).toThrow(RangeError);
  });
});

/* ═══════════════ ⑤b 立项目标裁决 · V2 槽感知（V2-12 / D-V2RM-1，真机实证复刻） ═══════════════ */

describe('V2-12 · 立项裁决槽感知（V2 def 按 eng.orbital 轨道泊位口径优选，D-V2RM-1）', () => {
  /** 真机场景复刻（ENG-V2-RM-01 §三第 1 轮）：废料主基地只有建造厂（eng.main 锚定），灰谷前进基地有航天发射中心（eng.orbital 锚定） */
  const RM_BASES = [
    { id: 'feiliao', name: '废料堆填区主基地', buildings: [{ name: '盟军建造厂', state: '运转' }] },
    { id: 'huigu', name: '灰谷前进基地', buildings: [{ name: '航天发射中心', state: '运转' }] },
  ];
  /** V2 def 判别形（kind+modules 双判别位齐备，对齐 catalog.ProjectDef） */
  const DEF_V2_STATION = {
    name: '轨道空间站',
    kind: 'project',
    modules: [{ id: 'core', name: '核心舱', cost: 200000, prereqs: [] }],
  };

  it('真机场景：bases 中唯一有航天发射中心类锚定（eng.orbital）的基地被选中——选灰谷前进基地，不再选有建造厂的废料主基地', () => {
    const t = initiateTargetFor(DEF_V2_STATION, RM_BASES);
    expect(t).toMatchObject({ enabled: true, base: '灰谷前进基地' });
  });

  it('判别位分流：同 bases 下 V1 def（无 kind/modules）仍按 eng.main 建造厂口径选废料主基地（V1 零变化对照）', () => {
    const t = initiateTargetFor({ name: '灰熊坦克现代化改装工程' }, RM_BASES);
    expect(t).toMatchObject({ enabled: true, base: '废料堆填区主基地' });
  });

  it("单判别位亦分流：modules 数组在场（无 kind）与 kind==='project'（无 modules）均走轨道泊位口径", () => {
    expect(initiateTargetFor({ name: '轨道空间站', modules: [] }, RM_BASES).base).toBe('灰谷前进基地');
    expect(initiateTargetFor({ name: '轨道空间站', kind: 'project' }, RM_BASES).base).toBe('灰谷前进基地');
  });

  it('锚定词表数据驱动：航天发射中心之外的 eng.orbital 锚定建筑（山体发射场）同样命中容量优选', () => {
    const t = initiateTargetFor(DEF_V2_STATION, [
      { id: 'feiliao', name: '废料堆填区主基地', buildings: [{ name: '盟军建造厂', state: '运转' }] },
      { id: 'shanpo', name: '山坡隐蔽基地', buildings: [{ name: '山体发射场', state: '运转' }] },
    ]);
    expect(t.base).toBe('山坡隐蔽基地');
  });

  it('排除废弃仍前置：eng.orbital 锚定基地废弃 → 跳过，非废弃中无泊位容量 → 回退非废弃首条（fail-open 同 V1 链路）', () => {
    const t = initiateTargetFor(DEF_V2_STATION, [
      { id: 'feiliao', name: '废料堆填区主基地', buildings: [{ name: '盟军建造厂', state: '运转' }] },
      { id: 'huigu', name: '灰谷前进基地', status: '废弃', buildings: [{ name: '航天发射中心', state: '运转' }] },
      { id: 'yunxi', name: '云溪前哨', buildings: [{ name: '兵营', state: '运转' }] },
    ]);
    expect(t.base).toBe('废料堆填区主基地');
  });

  it('锚定建筑建造中不计容量（对齐 engSlotCapacityInBase）→ 回退非废弃首条', () => {
    const t = initiateTargetFor(DEF_V2_STATION, [
      { id: 'feiliao', name: '废料堆填区主基地', buildings: [{ name: '盟军建造厂', state: '运转' }] },
      { id: 'huigu', name: '灰谷前进基地', buildings: [{ name: '航天发射中心', state: '建造中' }] },
    ]);
    expect(t.base).toBe('废料堆填区主基地');
  });

  it('buildings 缺席（容量不可判别）→ 不淘汰，回退非废弃首条', () => {
    const t = initiateTargetFor(DEF_V2_STATION, [
      { id: 'feiliao', name: '废料堆填区主基地' },
      { id: 'huigu', name: '灰谷前进基地' },
    ]);
    expect(t.base).toBe('废料堆填区主基地');
  });

  it('hint 文案同步：V2 立项提示说明按轨道组装泊位锚定优选（D-V2RM-1）；V1 立项提示逐字不变（零变化冻结）', () => {
    const v2Hint = ENG_COMMAND_COPY.v2.hint.initiate('灰谷前进基地');
    expect(v2Hint).toContain('轨道组装泊位');
    expect(v2Hint).toContain('航天发射中心/发射场系');
    expect(v2Hint).toContain('D-V2RM-1');
    expect(ENG_COMMAND_COPY.initiate.hint('北坡主基地')).toBe(
      '立项令：校验前置科技门 + 首期注资 + 纳米开工门，牵头基地「北坡主基地」（自动优选非废弃且有工程槽容量的基地，D-R10-d）；由 AI 结转 projectEngine.startProject',
    );
  });
});

/* ═══════════════ ⑥ 不自动发送红线（D-R10-b）grep 断言 ═══════════════ */

describe('ENG-PROTO-02 · 不自动发送红线（UI 链路零 send 触发）', () => {
  it('hostSendInput.ts：只填 #send_textarea + focus（或 /setinput 兜底），零发送触发', async () => {
    const fs = await nodeFs;
    const HOST_SEND_INPUT_TS = fs.readFileSync(HOST_SEND_INPUT_URL, 'utf8');
    expect(HOST_SEND_INPUT_TS).toMatch(/#send_textarea/);
    expect(HOST_SEND_INPUT_TS).toMatch(/textarea\.focus\(\)/);
    expect(HOST_SEND_INPUT_TS).toMatch(/\/setinput/);
    // 红线：禁止任何发送触发——宿主发送按钮 / click() / 宿主 generate 类 API
    expect(HOST_SEND_INPUT_TS).not.toMatch(/#send_but/);
    expect(HOST_SEND_INPUT_TS).not.toMatch(/\.click\s*\(/);
    expect(HOST_SEND_INPUT_TS).not.toMatch(/sendMessage|triggerSlash\(['"`]\/send|Generate\s*\(/);
  });

  it('ModalEngineering.vue / DetailDrawer.vue：指令只经 fillHostSendInput 写输入栏，零 send 按钮触发', async () => {
    const fs = await nodeFs;
    for (const url of [MODAL_ENGINEERING_URL, DETAIL_DRAWER_URL]) {
      const src = fs.readFileSync(url, 'utf8');
      expect(src).toMatch(/fillHostSendInput/);
      expect(src).not.toMatch(/#send_but/);
      expect(src).not.toMatch(/\.click\s*\(/);
      expect(src).not.toMatch(/sendMessage|triggerSlash\(['"`]\/send|Generate\s*\(/);
    }
  });
});

/* ═══════════════ ⑦ V2-07 仓段化：夹具（与 ModalEngineering MOCK-ENG-V2-07 同拓扑，另加可注资根链模块 lab） ═══════════════ */

function makeProjectV2(overrides: Partial<ProjectV2> = {}): ProjectV2 {
  return {
    id: 'proj:空间站仓段化工程@beipo',
    ref: '空间站仓段化工程',
    scope: 'base',
    bases: ['beipo'],
    lead_base: 'beipo',
    grade: '巨构',
    status: '在建',
    modules: [
      { id: 'core', name: '核心舱', status: '完工', base: 'beipo', queue_index: null },
      { id: 'hab', name: '居住舱', status: '进行中', base: 'beipo', queue_index: 0 },
      { id: 'dock', name: '对接舱段', status: '未启动', base: '', queue_index: null },
      { id: 'solar', name: '太阳能翼', status: '暂停', base: 'beipo', queue_index: 1 },
      { id: 'truss', name: '桁架段', status: '取消', base: '', queue_index: null },
      { id: 'lab', name: '实验舱', status: '未启动', base: '', queue_index: null },
    ],
    outcome: { type: 'mark' },
    schema_version: 2,
    ...overrides,
  };
}

const DEF_V2: ProjectV2Def = {
  id: 'all.project.station',
  name: '空间站仓段化工程',
  grade: '巨构',
  scope: 'base',
  requirements: { research: '轨道工程学', credits: 8000, nanites: 120 },
  modules: [
    { id: 'core', name: '核心舱', cost: 2000, prereqs: [] },
    { id: 'hab', name: '居住舱', cost: 1800, prereqs: ['core'] },
    { id: 'dock', name: '对接舱段', cost: 1200, prereqs: ['core', 'hab'] },
    { id: 'solar', name: '太阳能翼', cost: 900, prereqs: ['core'] },
    { id: 'truss', name: '桁架段', cost: 600, prereqs: ['core', 'hab'] },
    { id: 'lab', name: '实验舱', cost: 500, prereqs: ['core'] },
  ],
};

/* ═══════════════ ⑧ V2-07 模块级三令逐字断言（模块名定位，不用 id） ═══════════════ */

describe('V2-07 · V2 模块级三令文本逐字断言（uid25：id 优先 name 兑底，模板用名对人友好）', () => {
  it('注资模块令：【工程指令】注资「<工程实例>」<模块名>', () => {
    expect(buildFundModuleOrder('proj:空间站仓段化工程@beipo', '核心舱')).toBe(
      '【工程指令】注资「proj:空间站仓段化工程@beipo」核心舱',
    );
  });

  it('模块级暂停/恢复令：同形态（单模块 hold / 清 hold，工程保持在建）', () => {
    expect(buildPauseModuleOrder('proj:空间站仓段化工程@beipo', '太阳能翼')).toBe(
      '【工程指令】暂停「proj:空间站仓段化工程@beipo」太阳能翼',
    );
    expect(buildResumeModuleOrder('proj:空间站仓段化工程@beipo', '太阳能翼')).toBe(
      '【工程指令】恢复「proj:空间站仓段化工程@beipo」太阳能翼',
    );
  });

  it('三令无 `/` 前缀（D-RM02-1）、以【工程指令】开头、模块名首尾空白先 trim', () => {
    for (const t of [
      buildFundModuleOrder('proj:x@y', ' 核心舱 '),
      buildPauseModuleOrder('proj:x@y', '居住舱'),
      buildResumeModuleOrder('proj:x@y', '桁架段'),
    ]) {
      expect(t.startsWith('/')).toBe(false);
      expect(t.startsWith('【工程指令】')).toBe(true);
    }
    expect(buildFundModuleOrder('proj:x@y', ' 核心舱 ')).toBe('【工程指令】注资「proj:x@y」核心舱');
  });
});

/* ═══════════════ ⑨ V2-07 模块令 fail-closed（不产出半条指令） ═══════════════ */

describe('V2-07 · 模块令 fail-closed（「」=模板定界符 / @=实例 id 保留字符）', () => {
  it('模块名含「」或 @ → RangeError', () => {
    expect(() => buildFundModuleOrder('proj:x@y', '「核心舱」')).toThrow(RangeError);
    expect(() => buildPauseModuleOrder('proj:x@y', '核心@舱')).toThrow(RangeError);
    expect(() => buildResumeModuleOrder('proj:x@y', '」')).toThrow(RangeError);
  });

  it('模块名空/纯空白/内嵌空白/控制字符 → RangeError', () => {
    expect(() => buildFundModuleOrder('proj:x@y', '')).toThrow(RangeError);
    expect(() => buildFundModuleOrder('proj:x@y', '   ')).toThrow(RangeError);
    expect(() => buildPauseModuleOrder('proj:x@y', '核心 舱')).toThrow(/空白/);
    expect(() => buildResumeModuleOrder('proj:x@y', '核心\u0007舱')).toThrow(RangeError);
  });

  it('实例名非法（空/内嵌空白）→ RangeError', () => {
    expect(() => buildFundModuleOrder('', '核心舱')).toThrow(RangeError);
    expect(() => buildPauseModuleOrder('proj:x\n@y', '核心舱')).toThrow(RangeError);
  });
});

/* ═══════════════ ⑩ V2-07 按钮派发与状态门矩阵 ═══════════════ */

describe('V2-07 · V2 按钮派发（工程级同 V1 文本；工程级注资拒收）', () => {
  const p = makeProjectV2();

  it('工程级 暂停/取消（在建）与 恢复（暂停）与 V1 文本逐字同形', () => {
    const buttons = engV2ProjectButtons(p);
    expect(
      buildOrderForV2ProjectButton(
        buttons.find(b => b.verb === '暂停')!,
        p.id,
      ),
    ).toBe(`【工程指令】暂停「${p.id}」`);
    expect(
      buildOrderForV2ProjectButton(
        buttons.find(b => b.verb === '取消')!,
        p.id,
      ),
    ).toBe(`【工程指令】取消「${p.id}」`);
    const paused = engV2ProjectButtons(makeProjectV2({ status: '暂停' }));
    expect(
      buildOrderForV2ProjectButton(
        paused.find(b => b.verb === '恢复')!,
        p.id,
      ),
    ).toBe(`【工程指令】恢复「${p.id}」`);
  });

  it('工程级注资 → RangeError（仓段化注资恒模块级——模块名定位）', () => {
    expect(() =>
      buildOrderForV2ProjectButton({ verb: '注资', label: '', enabled: true, hint: '', phaseIdx: null }, 'proj:x@y'),
    ).toThrow(/模块级/);
  });

  it('模块级三令派发（模块名定位，不用 id）', () => {
    const hab = engV2ModuleButtons(p, DEF_V2, 'hab')!;
    expect(
      buildOrderForV2ModuleButton(
        hab.find(b => b.verb === '暂停')!,
        p.id,
      ),
    ).toBe(`【工程指令】暂停「${p.id}」居住舱`);
    const lab = engV2ModuleButtons(p, DEF_V2, 'lab')!;
    expect(
      buildOrderForV2ModuleButton(
        lab.find(b => b.verb === '注资')!,
        p.id,
      ),
    ).toBe(`【工程指令】注资「${p.id}」实验舱`);
  });
});

describe('V2-07 · V2 工程级按钮矩阵（暂停/恢复/取消；无注资键）', () => {
  const map = (status: ProjectV2['status'] | null) =>
    Object.fromEntries(
      engV2ProjectButtons(status === null ? null : makeProjectV2({ status })).map(b => [b.verb, b.enabled]),
    );

  it('在建：暂停/取消可用，恢复禁用', () => {
    expect(map('在建')).toEqual({ 暂停: true, 恢复: false, 取消: true });
  });

  it('暂停：恢复/取消可用，暂停禁用', () => {
    expect(map('暂停')).toEqual({ 暂停: false, 恢复: true, 取消: true });
  });

  it('规划中/完工/取消/无实例：全禁并照实说明（terminal/planning/noInstance）', () => {
    for (const status of ['规划中', '完工', '取消'] as const) {
      expect(engV2ProjectButtons(makeProjectV2({ status })).every(b => !b.enabled)).toBe(true);
    }
    const none = engV2ProjectButtons(null);
    expect(none.every(b => !b.enabled)).toBe(true);
    expect(none.find(b => b.verb === '暂停')!.hint).toBe(ENG_COMMAND_COPY.v2.disabled.noInstance);
    expect(engV2ProjectButtons(makeProjectV2({ status: '完工' })).find(b => b.verb === '取消')!.hint).toBe(
      ENG_COMMAND_COPY.disabled.terminal('完工'),
    );
    expect(engV2ProjectButtons(makeProjectV2({ status: '规划中' })).find(b => b.verb === '取消')!.hint).toBe(
      ENG_COMMAND_COPY.disabled.planning,
    );
  });
});

describe('V2-07 · V2 模块级三令矩阵（拓扑前置门 + 终态禁用 + 工程门）', () => {
  const p = makeProjectV2();
  const verbs = (moduleId: string, project: Pick<ProjectV2, 'status' | 'modules'> | null = p) => {
    const btns = engV2ModuleButtons(project, DEF_V2, moduleId)!;
    return Object.fromEntries(btns.map(b => [b.verb, b.enabled]));
  };

  it('进行中模块：暂停可用；暂停模块：恢复可用；前置全完工的未启动模块：注资可用', () => {
    expect(verbs('hab')).toEqual({ 注资: false, 暂停: true, 恢复: false });
    expect(verbs('solar')).toEqual({ 注资: false, 暂停: false, 恢复: true });
    expect(verbs('lab')).toEqual({ 注资: true, 暂停: false, 恢复: false });
  });

  it('终态模块（完工/取消）：三令全禁（moduleTerminal 理由）', () => {
    expect(verbs('core')).toEqual({ 注资: false, 暂停: false, 恢复: false });
    expect(verbs('truss')).toEqual({ 注资: false, 暂停: false, 恢复: false });
    expect(engV2ModuleButtons(p, DEF_V2, 'core')!.find(b => b.verb === '注资')!.hint).toBe(
      ENG_COMMAND_COPY.v2.disabled.moduleTerminal('完工'),
    );
  });

  it('前置未完工：注资禁用并点名前置模块（拓扑版前置完工门，UI 只给最近门）', () => {
    const fund = engV2ModuleButtons(p, DEF_V2, 'dock')!.find(b => b.verb === '注资')!;
    expect(fund.enabled).toBe(false);
    expect(fund.hint).toBe(ENG_COMMAND_COPY.v2.disabled.prereqUnmet('居住舱'));
  });

  it('工程非在建（暂停/终态/无实例）：模块三令全禁（projectNotActive/noInstance 理由）', () => {
    const pausedInst = makeProjectV2({ status: '暂停' });
    expect(verbs('hab', pausedInst)).toEqual({ 注资: false, 暂停: false, 恢复: false });
    expect(engV2ModuleButtons(pausedInst, DEF_V2, 'hab')!.find(b => b.verb === '暂停')!.hint).toBe(
      ENG_COMMAND_COPY.v2.disabled.projectNotActive,
    );
    expect(verbs('hab', null)).toEqual({ 注资: false, 暂停: false, 恢复: false });
    expect(engV2ModuleButtons(null, DEF_V2, 'hab')!.find(b => b.verb === '暂停')!.hint).toBe(
      ENG_COMMAND_COPY.v2.disabled.noInstance,
    );
  });

  it('def 无此模块 id → null（不产出按钮组）', () => {
    expect(engV2ModuleButtons(p, DEF_V2, 'ghost')).toBeNull();
  });
});

/* ═══════════════ ⑪ V2-07 取消结算 parity + 模块网格卡片派生 ═══════════════ */

describe('V2-07 · V2 取消结算 = cancelProjectV2 settlementText（§3.3 固定文案模块版，parity 实调）', () => {
  it('带静态定义：已注资模块点名 + 金额合计逐字相等（core 2000 + hab 1800 + solar 900 = 4700）', () => {
    const p = makeProjectV2();
    const res = cancelProjectV2({ projects: [p], queues: [] }, p.id, DEF_V2);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(buildCancelSettlementV2(p, DEF_V2)).toBe(res.settlementText);
    expect(res.settlementText).toContain('已注资 3 个模块（「核心舱」、「居住舱」、「太阳能翼」）');
    expect(res.settlementText).toContain('注资合计 4700 资金不予退还');
    expect(res.settlementText).toContain('已消耗纳米不予退还，取消操作不再扣减纳米库存');
    expect(res.settlementText).not.toContain('从未发生抵扣');
  });

  it('缺静态定义：金额退化分支逐字相等（，已注资金额不予退还）', () => {
    const paused = makeProjectV2({ status: '暂停' });
    const res = cancelProjectV2({ projects: [paused], queues: [] }, paused.id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(buildCancelSettlementV2(paused, null)).toBe(res.settlementText);
    expect(res.settlementText).toContain('，已注资金额不予退还');
  });
});

describe('V2-07 · engV2ModuleCards 派生（五态/承建基地/queue 投影名/前置置灰）', () => {
  it('实例驱动：五态色板、承建基地名解析、`ref·模块名` 投影名、未指派/未投影兑底', () => {
    const cards = engV2ModuleCards(DEF_V2, makeProjectV2(), [{ id: 'beipo', name: '北坡主基地' }]);
    expect(cards).toHaveLength(6);
    const hab = cards.find(c => c.moduleId === 'hab')!;
    expect(hab.stateKey).toBe('active');
    expect(hab.baseName).toBe('北坡主基地');
    expect(hab.queueIndex).toBe(0);
    expect(hab.projectionName).toBe('空间站仓段化工程·居住舱');
    const core = cards.find(c => c.moduleId === 'core')!;
    expect(core.stateKey).toBe('done');
    expect(core.projectionName).toBeNull(); // 完工模块指针已回写 → 未投影
    const dock = cards.find(c => c.moduleId === 'dock')!;
    expect(dock.stateKey).toBe('pending');
    expect(dock.baseName).toBe(''); // 未指派 → 待指派
    expect(dock.locked).toBe(true); // prereqs core✓+hab✗（进行中未完工）
    expect(dock.blockingPrereqs).toEqual(['居住舱']);
    const lab = cards.find(c => c.moduleId === 'lab')!;
    expect(lab.locked).toBe(false); // 根链满足（core 完工）→ 可注资
    expect(lab.cost).toBe(500); // def 声明位透传
  });

  it('未立项（无实例）：def 骨架全未启动，非根模块置灰标前置，承建/投影全部待定', () => {
    const cards = engV2ModuleCards(DEF_V2, null, []);
    expect(cards.every(c => c.status === '未启动')).toBe(true);
    expect(cards.every(c => c.stateKey === 'pending')).toBe(true);
    expect(cards.find(c => c.moduleId === 'core')!.locked).toBe(false); // 根模块可注资
    expect(cards.find(c => c.moduleId === 'hab')!.locked).toBe(true); // 前置未完工
    expect(cards.find(c => c.moduleId === 'hab')!.blockingPrereqs).toEqual(['核心舱']);
    expect(cards.every(c => c.baseName === '' && c.projectionName === null)).toBe(true);
  });
});

/* ═══════════════ ⑫ UTO-UI-DOMAIN-01 · UnifiedDispatchBus 动词对齐与红线审查 ═══════════════ */

describe('UTO-UI-DOMAIN-01 · engCommands 与 UnifiedDispatchBus（Hold / Resume / Cancel / Allocate）对齐', () => {
  const pV1 = makeProject();
  const pV2 = makeProjectV2();
  const observer = projectEngineeringObserverView({ projects: [pV1, pV2], queues: [] });

  it('V1 工程按钮（注资/暂停/恢复/取消）与 alignEngineeringActionWithDispatchBus 输出 100% 对齐', () => {
    const btns = engCommandButtonsFor(pV1);
    const fundBtn = btns.find(b => b.verb === '注资')!;
    const pauseBtn = btns.find(b => b.verb === '暂停')!;
    const cancelBtn = btns.find(b => b.verb === '取消')!;
    const resumeBtn = engCommandButtonsFor(makeProject({ status: '暂停' })).find(b => b.verb === '恢复')!;

    const alignedFund = alignEngineeringActionWithDispatchBus(
      { verb: fundBtn.verb, projectId: pV1.id, phaseIdx: fundBtn.phaseIdx },
      observer.allTasks,
    );
    expect(alignedFund.commandType).toBe('Allocate');
    expect(alignedFund.commandText).toBe(buildOrderForButton(fundBtn, pV1.id));

    const alignedPause = alignEngineeringActionWithDispatchBus(
      { verb: pauseBtn.verb, projectId: pV1.id },
      observer.allTasks,
    );
    expect(alignedPause.commandType).toBe('Hold');
    expect(alignedPause.commandText).toBe(buildOrderForButton(pauseBtn, pV1.id));

    const alignedResume = alignEngineeringActionWithDispatchBus(
      { verb: resumeBtn.verb, projectId: pV1.id },
      observer.allTasks,
    );
    expect(alignedResume.commandType).toBe('Resume');
    expect(alignedResume.commandText).toBe(buildOrderForButton(resumeBtn, pV1.id));

    const alignedCancel = alignEngineeringActionWithDispatchBus(
      { verb: cancelBtn.verb, projectId: pV1.id },
      observer.allTasks,
    );
    expect(alignedCancel.commandType).toBe('Cancel');
    expect(alignedCancel.commandText).toBe(buildOrderForButton(cancelBtn, pV1.id));
  });

  it('V2 工程级按钮（Hold/Resume/Cancel）与模块级按钮（Allocate/Hold/Resume）同源对齐', () => {
    const projBtns = engV2ProjectButtons(pV2);
    for (const btn of projBtns) {
      const aligned = alignEngineeringActionWithDispatchBus(
        { verb: btn.verb, projectId: pV2.id, isV2ProjectLevel: true },
        observer.allTasks,
      );
      expect(aligned.commandType).toBe(engVerbToUnifiedCommandType(btn.verb));
      expect(aligned.commandText).toBe(buildOrderForV2ProjectButton(btn, pV2.id));
    }

    const modBtns = engV2ModuleButtons(pV2, DEF_V2, 'hab')!;
    for (const btn of modBtns) {
      const aligned = alignEngineeringActionWithDispatchBus(
        {
          verb: btn.verb,
          projectId: pV2.id,
          moduleId: btn.moduleId,
          moduleName: btn.moduleName,
        },
        observer.allTasks,
      );
      expect(aligned.commandType).toBe(engVerbToUnifiedCommandType(btn.verb));
      expect(aligned.commandText).toBe(buildOrderForV2ModuleButton(btn, pV2.id));
    }

    // 基地指派（Allocate）
    const allocate = alignEngineeringActionWithDispatchBus(
      {
        verb: '指派',
        projectId: pV2.id,
        moduleId: 'lab',
        moduleName: '实验舱',
        baseId: 'beipo',
      },
      observer.allTasks,
    );
    expect(allocate.commandType).toBe('Allocate');
    expect(allocate.commandText).toBe(`【工程指令】指派「${pV2.id}」实验舱，承建基地：beipo`);
  });

  it('ModalTechTree.vue 与 engOrderBridge.ts 同样严守零 MVU 写 API 与零自动发送红线', async () => {
    const fs = await nodeFs;
    const bannedWrite =
      /replaceVariables|insertVariables|updateVariablesWith|insertOrAssignVariables|deleteVariable|createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook/;
    const bannedSend = /#send_but|sendMessage|triggerSlash\s*\(\s*['"`]\/send|\bGenerate\s*\(/;
    for (const [label, url] of [
      ['ModalTechTree.vue', MODAL_TECH_TREE_URL],
      ['engOrderBridge.ts', ENG_ORDER_BRIDGE_URL],
    ] as const) {
      const src = fs.readFileSync(url, 'utf8');
      expect(src, `${label} 不得含 MVU/世界书写入 API`).not.toMatch(bannedWrite);
      expect(src, `${label} 不得含自动发送调用`).not.toMatch(bannedSend);
    }
  });
});
