/**
 * engCommands.ts —— 工程指令闭环五令文本拼装与状态门视图模型（ENG-UI-03 / ENG-PROTO-02）
 *
 * 真源与纪律：
 * - 指令语法（DIR-10 / D-R10-a，2026-10-11；历史契约 §3.8 的 `/工程 …` 斜杠形态由 DIR-10 废止——
 *   宿主 STScript 将 `/工程` 当斜杠令拦截，SlashCommandParserError，D-RM02-1）：
 *   改【工程指令】自然语言模板（对齐既有【指挥官战术指令】先例）：
 *     【工程指令】立项「<工程名>」，牵头基地：<基地名>    # 校验前置科技门 + 首期注资 + 纳米开工门
 *     【工程指令】注资「<工程实例>」第 <阶段号> 阶段       # 启动下一阶段
 *     【工程指令】暂停「<工程实例>」
 *     【工程指令】恢复「<工程实例>」
 *     【工程指令】取消「<工程实例>」                      # 附已注资结算说明
 * - 发送权红线（D-R10-b）：UI 只把指令文本填入宿主输入栏并聚焦，**不自动发送**（玩家可能要补充内容）。
 * - 写路径唯一：拼装产物交由 红警指挥系统/hostSendInput.ts 写入宿主 #send_textarea（或 /setinput），
 *   由 AI 下一轮结转调 projectEngine；本模块与 UI 零 MVU 写（中控台只读红线）。
 * - <工程实例> 口径 = Project.id（形如 proj:<ref>@<lead_base>，projectEngine 全 API 以 id 定位）；
 * - <阶段号> 口径 = ProjectPhase.idx（0 起，对齐 §3.1「阶段序号（0 起，对齐 retrofit 块
 *   phases[] 数组序）」与 projectEngine 事件文案 `阶段 #${idx}` 同口径）；
 * - 取消确认结算文案 = buildCancelSettlement，模板逐字镜像 projectEngine.ts cancelProject
 *   的 §3.3 固定文案（注资不退、进度作废、纳米开工门无抵扣）；本任务不直接调 projectEngine
 *   （结转侧职责），parity 由 __tests__/engCommands.test.ts 对 cancelProject 实调钉死。
 * - 🔴 纯函数：零 IO / 零 DOM / 零 vue·pinia / 零酒馆 API；非法输入 fail-closed 抛错
 *   （不产出半条指令——名内空白/控制字符会破坏单行指令形态与 AI 侧识别）。
 *
 * 仓段化 V2 面（V2-07 · 仓段化V2设计案 §6/§7 UI 行，2026-10-12 设计门冻结）：
 * - 模块级三令模板（模块定位用**模块名**不用 id——uid25 协议侧 id 优先 name 兜底，
 *   玩家侧模板用名对人友好）：
 *     【工程指令】注资「<工程实例>」<模块名>    # 模块注资 + 纳米开工门（前置完工门引擎复核）
 *     【工程指令】暂停「<工程实例>」<模块名>    # 单模块 hold（工程保持在建）
 *     【工程指令】恢复「<工程实例>」<模块名>
 * - 工程级 暂停/恢复/取消 与 V1 文本完全同形（V1 构建器直用）；立项同 V1 文本形态，
 *   牵头基地优选逻辑复用 initiateTargetFor（D-R10-d 排除废弃 + 工程槽容量优先；
 *   V2-12/D-V2RM-1：仓段化 def 按 eng.orbital 轨道泊位口径容量优选，与引擎
 *   startProjectV2 的 no_slot 锚定门同槽——V1 retrofit 维持首槽 eng.main 口径零变化）；
 * - 发送权红线（D-R10-b）对 V2 面同样生效：本模块只拼装文本，写入宿主输入栏归
 *   红警指挥系统/hostSendInput.ts（fillHostSendInput 只填栏聚焦，不自动发送）。
 */
import type { RetrofitDef } from '../../红警指挥系统/core/catalog';
import type { ProjectModule, ProjectPhase, ProjectV1, ProjectV2 } from '../../红警指挥系统/core/schema';
import { projectionItemName } from '../../红警指挥系统/engines/projectEngine';
import {
  ENGINEERING_SLOT_REGISTRY,
  engSlotCapacityInBase,
  type EngineeringSlotDef,
} from '../../红警指挥系统/engines/engineeringSlots';

/* ═══════════════ V2 立项优选槽（V2-12 · D-V2RM-1） ═══════════════ */

/**
 * 仓段化 V2 工程的立项容量口径槽：注册表中「只接 project」的首个专属槽（现=eng.orbital
 * 轨道组装泊位）。解析口径逐字镜像 projectEngine V2_PROJECT_SLOT——引擎 startProjectV2
 * 的 no_slot 锚定建筑门用的正是它，UI 优选基地必须与引擎受理同槽（真机 D-V2RM-1 实证：
 * UI 按首槽 eng.main 建造厂口径优选了无发射中心的废料主基地 → 引擎按 eng.orbital 拒收）。
 * 数据驱动：注册表追加 project-only 槽不改本行；注册表倒退（无 project-only 槽）兜底首槽
 * fail-open（与引擎同兜底，此时 UI 优选口径与引擎仍一致）。
 */
const V2_INITIATE_SLOT: EngineeringSlotDef =
  ENGINEERING_SLOT_REGISTRY.find(s => s.accepts.includes('project') && !s.accepts.includes('retrofit')) ??
  ENGINEERING_SLOT_REGISTRY[0];

/* ═══════════════ 文案集（组件零自建文案，对齐 DISPATCH_ORDER_COPY 先例） ═══════════════ */

export const ENG_COMMAND_COPY = {
  groupLabel: (ref: string) => `工程指令四令：${ref}`,
  /** 按钮文案 */
  label: {
    fund: (phaseIdx: number, phaseName: string) => `注资下一阶段 #${phaseIdx} ${phaseName}`,
    pause: '暂停工程',
    resume: '恢复工程',
    cancel: '取消工程',
  },
  /** 可用时 title 语义提示（逐字锚 §3.8 注释列） */
  hint: {
    fund: '注资令：启动下一阶段（扣阶段注资 + 纳米开工门校验，由 AI 结转 projectEngine.startPhase）',
    pause: '暂停令：在途阶段退回暂缓（进度保留），由 AI 结转 projectEngine.pauseProject',
    resume: '恢复令：清除暂缓重新竞争带宽，由 AI 结转 projectEngine.resumeProject',
    cancel: '取消令：终态不可逆，下达前请阅读结算说明（AI 结转 projectEngine.cancelProject）',
  },
  /** 禁用理由（title 照实呈现「为什么点不动」） */
  disabled: {
    terminal: (status: string) => `工程已「${status}」（终态），四令全不可用`,
    planning: '规划中待立项——立项令在工程信息容器底部下达',
    fundAllLaunched: '全部阶段已启动或完工，无下一阶段可注资',
    fundNeedActive: '注资令仅在建状态可受理（暂停请先恢复）',
    pauseNeedActive: '暂停令仅在建状态可受理',
    resumeNeedPaused: '恢复令仅暂停状态可受理',
    cancelNeedActiveOrPaused: '取消令仅在建/暂停状态可受理',
  },
  /** 取消二次确认弹层文案 */
  confirm: {
    title: '取消工程 · 二次确认',
    affirm: '确认下达取消令',
    deny: '再想想',
    note: '取消为终态操作，指令载入输入栏后由 AI 结转执行；确认前请核对结算说明。',
  },
  /** 立项按钮（ModalEngineering 工程信息容器底部） */
  initiate: {
    label: '【下达立项指令】',
    hint: (base: string) =>
      `立项令：校验前置科技门 + 首期注资 + 纳米开工门，牵头基地「${base}」（自动优选非废弃且有工程槽容量的基地，D-R10-d）；由 AI 结转 projectEngine.startProject`,
    noBase: '快照无可用基地（bases 为空），立项令无法指定牵头基地',
  },
  /** 仓段化 V2 面（V2-07；模块定位用模块名——uid25 协议 id 优先 name 兜底，模板用名对人友好） */
  v2: {
    groupLabel: (ref: string) => `仓段化工程指令：${ref}`,
    label: {
      fundModule: '注资此模块',
      pauseModule: '暂停此模块',
      resumeModule: '恢复此模块',
      allocateModule: '指派基地',
    },
    hint: {
      fundModule:
        '注资令：模块注资扣账 + 纳米开工门校验（前置模块完工门由引擎复核），由 AI 结转 projectEngine.investModule',
      pauseModule: '暂停令：单模块 hold（工程保持在建），由 AI 结转 projectEngine.pauseModule',
      resumeModule:
        '恢复令：清除单模块 hold 重新竞争属地工程槽带宽，由 AI 结转 projectEngine.resumeModule',
      allocateModule:
        '基地指派令（Allocate）：为未启动模块指派跨基地联建承建基地，由 AI 结转 projectEngine.assignModuleBase',
      pause:
        '暂停令：全部未完工在途模块联动退回暂缓（工程级），由 AI 结转 projectEngine.pauseProjectV2',
      resume: '恢复令：全部在途模块 hold 清除（工程级），由 AI 结转 projectEngine.resumeProjectV2',
      cancel: '取消令：终态不可逆，下达前请阅读结算说明（AI 结转 projectEngine.cancelProjectV2）',
      initiate: (base: string) =>
        `立项令：三门校验 + 模块拓扑校验（prereqs 闭包无环）+ 首根模块自动注资，牵头基地「${base}」（基地优选按${V2_INITIATE_SLOT.name}锚定：非废弃 + 属地有${V2_INITIATE_SLOT.anchor}且容量>0 优先，D-R10-d/D-V2RM-1）；由 AI 结转 projectEngine.startProjectV2`,
    },
    disabled: {
      noInstance: '无在册实例——工程级/模块级指令需要已建档工程（请先下达立项令）',
      moduleTerminal: (status: string) => `模块已「${status}」（终态），模块级三令全不可用`,
      moduleNeedPending: '注资令仅未启动模块可受理',
      moduleNeedActive: '模块暂停令仅进行中模块可受理（工程须在建）',
      moduleNeedPaused: '模块恢复令仅暂停模块可受理（工程须在建）',
      projectNotActive: '模块级令仅工程在建时可受理（工程级暂停请先整体恢复）',
      prereqUnmet: (names: string) => `前置模块未完工：${names}（拓扑版前置完工门）`,
    },
  },
} as const;

/* ═══════════════ 输入校验（fail-closed，不产出半条指令） ═══════════════ */

/** 名内禁含空白/控制字符（单行自然语言指令形态，名以「」包裹；空白/控制字符会破坏单行性与 AI 侧识别，保守 fail-closed） */
function assertToken(kind: string, raw: string, extra: RegExp | null = null): string {
  const v = (raw ?? '').trim();
  if (!v) throw new RangeError(`${kind}不能为空`);
  if (/\s/.test(v)) throw new RangeError(`${kind}含空白字符，会破坏指令分词：「${v}」`);
  // eslint-disable-next-line no-control-regex -- 显式拒控制字符（fail-closed）
  if (/[\0-\x1f\x7f]/.test(v)) throw new RangeError(`${kind}含控制字符：「${v}」`);
  if (extra && extra.test(v)) throw new RangeError(`${kind}含非法字符：「${v}」`);
  return v;
}

function assertPhaseIdx(phaseIdx: number): number {
  if (!Number.isInteger(phaseIdx) || phaseIdx < 0) {
    throw new RangeError(`阶段号必须为 ≥0 的整数（ProjectPhase.idx 口径），收到：${phaseIdx}`);
  }
  return phaseIdx;
}

/* ═══════════════ 五令拼装（DIR-10 自然语言模板，逐字钉死于测试） ═══════════════ */

/** 立项令：`【工程指令】立项「<工程名>」，牵头基地：<基地名>`（工程名禁含 `@`，保守 fail-closed——@ 是实例 id 形态 `proj:<ref>@<lead_base>` 的保留字符） */
export function buildInitiateOrder(projectName: string, base: string): string {
  const name = assertToken('工程名', projectName, /@/);
  const b = assertToken('基地', base);
  return `【工程指令】立项「${name}」，牵头基地：${b}`;
}

/** 注资令（启动下一阶段）：`【工程指令】注资「<工程实例>」第 <阶段号> 阶段` */
export function buildFundOrder(instanceId: string, phaseIdx: number): string {
  const id = assertToken('工程实例名', instanceId);
  return `【工程指令】注资「${id}」第 ${assertPhaseIdx(phaseIdx)} 阶段`;
}

/** 暂停令：`【工程指令】暂停「<工程实例>」` */
export function buildPauseOrder(instanceId: string): string {
  return `【工程指令】暂停「${assertToken('工程实例名', instanceId)}」`;
}

/** 恢复令：`【工程指令】恢复「<工程实例>」` */
export function buildResumeOrder(instanceId: string): string {
  return `【工程指令】恢复「${assertToken('工程实例名', instanceId)}」`;
}

/** 取消令：`【工程指令】取消「<工程实例>」`（按钮侧须先经二次确认弹层，结算说明见 buildCancelSettlement） */
export function buildCancelOrder(instanceId: string): string {
  return `【工程指令】取消「${assertToken('工程实例名', instanceId)}」`;
}

/* ═══════════════ 取消结算文案（§3.3 固定文案，镜像 cancelProject settlementText） ═══════════════ */

/**
 * 取消确认弹层结算说明。逐字镜像 projectEngine.ts cancelProject 的 settlementText 模板
 * （L622-633：已注资阶段注资不退、未完成阶段折算进度作废、纳米开工门从未抵扣）；
 * def 缺省时金额退化为「已注资金额」（与引擎同分支）。
 */
export function buildCancelSettlement(
  project: Pick<ProjectV1, 'ref' | 'phases'>,
  def?: Pick<RetrofitDef, 'phases'> | null,
): string {
  const fundedPhases = project.phases.filter(
    ph => ph.status === '完工' || ph.status === '进行中' || ph.status === '暂停',
  );
  const names = fundedPhases.map(ph => `「${ph.name}」`).join('、');
  const amounts = def
    ? fundedPhases.map(ph => (def.phases ?? [])[ph.idx]?.cost ?? 0)
    : null;
  const total = amounts ? amounts.reduce((s, v) => s + v, 0) : null;
  return (
    `工程「${project.ref}」取消结算：已注资 ${fundedPhases.length} 个阶段（${names || '无'}）` +
    (total !== null ? `，注资合计 ${total} 资金` : '，已注资金额') +
    `不予退还；未完成阶段的折算进度全部作废。` +
    `纳米开工门仅为开工校验、从未发生抵扣，纳米库存无变动（D8b/§3.5）。`
  );
}

/* ═══════════════ 状态门视图模型（组件纯映射，零自建判定） ═══════════════ */

export type EngCommandVerb = '注资' | '暂停' | '恢复' | '取消';

export interface EngCommandButton {
  verb: EngCommandVerb;
  label: string;
  enabled: boolean;
  /** title 提示：enabled=语义说明，disabled=禁用理由 */
  hint: string;
  /** 注资令目标阶段号（下一未启动阶段 idx；无则 null） */
  phaseIdx: number | null;
}

/** 下一可注资阶段：首个「未启动」（阶段顺序门在引擎侧复核，UI 只给最近目标） */
export function nextPendingPhase(phases: readonly ProjectPhase[]): ProjectPhase | null {
  return phases.find(p => p.status === '未启动') ?? null;
}

/**
 * 工程状态 → 四令按钮可用性矩阵：
 * - 在建：注资（有未启动阶段）/暂停/取消可用；
 * - 暂停：恢复/取消可用；
 * - 规划中：全禁（立项令在 ModalEngineering 工程信息容器底部下达）；
 * - 完工/取消（终态）：全禁。
 */
export function engCommandButtonsFor(
  project: Pick<ProjectV1, 'status' | 'phases'>,
): EngCommandButton[] {
  const status = project.status;
  const terminal = status === '完工' || status === '取消';
  const next = nextPendingPhase(project.phases);

  const fundEnabled = !terminal && status === '在建' && next !== null;
  const fundHint = terminal
    ? ENG_COMMAND_COPY.disabled.terminal(status)
    : status === '规划中'
      ? ENG_COMMAND_COPY.disabled.planning
      : status === '暂停'
        ? ENG_COMMAND_COPY.disabled.fundNeedActive
        : next === null
          ? ENG_COMMAND_COPY.disabled.fundAllLaunched
          : ENG_COMMAND_COPY.hint.fund;

  const pauseEnabled = status === '在建';
  const pauseHint = pauseEnabled
    ? ENG_COMMAND_COPY.hint.pause
    : terminal
      ? ENG_COMMAND_COPY.disabled.terminal(status)
      : status === '规划中'
        ? ENG_COMMAND_COPY.disabled.planning
        : ENG_COMMAND_COPY.disabled.pauseNeedActive;

  const resumeEnabled = status === '暂停';
  const resumeHint = resumeEnabled
    ? ENG_COMMAND_COPY.hint.resume
    : terminal
      ? ENG_COMMAND_COPY.disabled.terminal(status)
      : status === '规划中'
        ? ENG_COMMAND_COPY.disabled.planning
        : ENG_COMMAND_COPY.disabled.resumeNeedPaused;

  const cancelEnabled = status === '在建' || status === '暂停';
  const cancelHint = cancelEnabled
    ? ENG_COMMAND_COPY.hint.cancel
    : terminal
      ? ENG_COMMAND_COPY.disabled.terminal(status)
      : status === '规划中'
        ? ENG_COMMAND_COPY.disabled.planning
        : ENG_COMMAND_COPY.disabled.cancelNeedActiveOrPaused;

  return [
    {
      verb: '注资',
      label: next ? ENG_COMMAND_COPY.label.fund(next.idx, next.name) : '注资下一阶段',
      enabled: fundEnabled,
      hint: fundHint,
      phaseIdx: next?.idx ?? null,
    },
    { verb: '暂停', label: ENG_COMMAND_COPY.label.pause, enabled: pauseEnabled, hint: pauseHint, phaseIdx: null },
    { verb: '恢复', label: ENG_COMMAND_COPY.label.resume, enabled: resumeEnabled, hint: resumeHint, phaseIdx: null },
    { verb: '取消', label: ENG_COMMAND_COPY.label.cancel, enabled: cancelEnabled, hint: cancelHint, phaseIdx: null },
  ];
}

/* ═══════════════ 立项目标裁决（ModalEngineering 工程信息容器底部按钮） ═══════════════ */

export interface EngInitiateTarget {
  enabled: boolean;
  /** 牵头基地名（指令「牵头基地：<名>」用名，引擎侧按 id/name 双通道匹配，engineeringSlots.ts resolveBase） */
  base: string;
  hint: string;
}

/** 立项目标裁决消费的基地候选最小视图（调用方传 snapshot.bases 全量 Base 可直接赋值；status/buildings 缺席=不可判别） */
export interface EngInitiateBaseCandidate {
  id: string;
  name: string;
  /** Base.status；'废弃'=退役态（schema.ts Base 枚举唯一退役态，CTRL-RETIRE-01）——唯一明确排除信号 */
  status?: string;
  /** Base.buildings；缺席=工程槽容量不可判别（保守：不淘汰，仅不参与容量优选） */
  buildings?: readonly { name: string; state?: string }[];
}

/**
 * 立项目标裁决的工程定义最小视图（V2-12 · D-V2RM-1）：
 * - V1 retrofit：仅 name 即可（既有调用形状零变化——kind/modules 缺席即 V1 首槽口径）；
 * - V2 仓段化 def：catalog.ProjectDef / projectEngine.ProjectV2Def 全量可直接赋值，
 *   判别位 kind==='project' 或 modules 拓扑数组在场 → 按 V2_INITIATE_SLOT
 *   （eng.orbital 轨道组装泊位）容量口径优选，与引擎 startProjectV2 no_slot 门同槽。
 */
export interface EngInitiateDefView {
  name: string;
  /** catalog def 判别位（'project'=仓段化 V2；'retrofit'/缺席=V1 改装块口径） */
  kind?: unknown;
  /** 模块拓扑（V2 判别特征：数组在场=project-only 槽口径） */
  modules?: readonly unknown[];
}

/** V2 def 判别：kind==='project'（catalog 判别位）或 modules 拓扑数组在场（project-only 槽特征） */
function isV2InitiateDef(def: EngInitiateDefView): boolean {
  return def.kind === 'project' || Array.isArray(def.modules);
}

/**
 * 立项目标裁决（D-R10-d 修复 bases[0] 陷阱：真机 bases[0] 可能是废弃「待侦知部署点」，原样发出必被驳回）。
 * 选取规则（保守优先，不发明规则）：
 * 1. 排除明确标记废弃的基地（status==='废弃'；status 缺席=不可判别→保留）；
 * 2. 在剩余候选中优先选「有工程槽容量」者——容量=属地可运转锚定建筑数
 *    （复用 engineeringSlots.engSlotCapacityInBase，D10-A 同口径）。槽口径按 def 分流（V2-12 · D-V2RM-1）：
 *    V1 retrofit → 首槽 eng.main（建造厂口径，既有行为逐字节不变）；仓段化 V2 def
 *    （kind==='project'/modules 在场）→ V2_INITIATE_SLOT（eng.orbital，与引擎
 *    startProjectV2 no_slot 锚定门同槽——真机实证：eng.main 口径优选的废料主基地被引擎拒收 no_slot）；
 *    buildings 缺席=容量不可判别，不参与比较；
 * 3. 全部不可判别（无 buildings 信息）或无可判别的有容量候选 → 回退非废弃候选首条；
 *    全部基地均废弃（无候选）→ 回退 bases[0]（fail-open 保可下达，受理/驳回交由 AI 与引擎侧裁决）。
 * 快照缺席/无基地/名 id 皆空 → 禁用并照实说明。
 */
export function initiateTargetFor(
  def: EngInitiateDefView | null,
  bases: readonly EngInitiateBaseCandidate[] | undefined,
): EngInitiateTarget {
  if (!def || !bases || bases.length === 0) {
    return { enabled: false, base: '', hint: ENG_COMMAND_COPY.initiate.noBase };
  }
  const slot = isV2InitiateDef(def) ? V2_INITIATE_SLOT : ENGINEERING_SLOT_REGISTRY[0];
  const nonAbandoned = bases.filter(b => b.status !== '废弃');
  const candidates = nonAbandoned.length > 0 ? nonAbandoned : [...bases];
  const capacityOf = (b: EngInitiateBaseCandidate): number | undefined => {
    if (!b.buildings) return undefined; // 容量不可判别
    return engSlotCapacityInBase(
      { bases: [{ id: b.id, name: b.name, buildings: b.buildings }] },
      b.id,
      slot,
    );
  };
  const chosen = candidates.find(b => (capacityOf(b) ?? 0) > 0) ?? candidates[0];
  const base = chosen.name.trim() || chosen.id.trim();
  if (!base) {
    return { enabled: false, base: '', hint: ENG_COMMAND_COPY.initiate.noBase };
  }
  return { enabled: true, base, hint: ENG_COMMAND_COPY.initiate.hint(base) };
}

/** DetailDrawer 工程详情的四令载荷（useDetail.DetailData.eng 可选扩展位；V1 指令面——仓段化 V2 工程卡归 V2-07） */
export interface EngCommandDetail {
  project: ProjectV1;
  /** 静态定义（取消结算金额口径；缺省时金额退化，与引擎同分支） */
  def?: RetrofitDef | null;
}

/**
 * 四令按钮 → 指令文本（注资用按钮锁定的 phaseIdx，取消走二次确认后才调用）。
 * 非法输入向外抛 RangeError（fail-closed），组件捕获后 toast 告警、不写输入栏。
 */
export function buildOrderForButton(button: EngCommandButton, instanceId: string): string {
  switch (button.verb) {
    case '注资':
      if (button.phaseIdx === null) throw new RangeError('注资令缺目标阶段号');
      return buildFundOrder(instanceId, button.phaseIdx);
    case '暂停':
      return buildPauseOrder(instanceId);
    case '恢复':
      return buildResumeOrder(instanceId);
    case '取消':
      return buildCancelOrder(instanceId);
  }
}

/* ═══════════════ 仓段化 V2 面（V2-07 · 仓段化V2设计案 §6/§7 UI 行；V1 面零改动） ═══════════════ */

/**
 * V2 静态定义最小视图（结构兼容 catalog.ProjectDef 与 projectEngine.ProjectV2Def——
 * 均为 { modules: [{id,name,cost?,prereqs}] } 形状，readonly 数组双收）。
 */
export interface EngV2DefView {
  name: string;
  modules: readonly { id: string; name: string; cost?: number; prereqs: readonly string[] }[];
}

/** 模块名保留字符：「」是模板定界符、@ 是实例 id 形态 `proj:<ref>@<base>` 保留字符——含即 fail-closed */
function assertModuleName(raw: string): string {
  return assertToken('模块名', raw, /[「」@]/);
}

/** V2 模块注资令：`【工程指令】注资「<工程实例>」<模块名>`（模块名定位，不用 id——对人友好） */
export function buildFundModuleOrder(instanceId: string, moduleName: string): string {
  const id = assertToken('工程实例名', instanceId);
  return `【工程指令】注资「${id}」${assertModuleName(moduleName)}`;
}

/** V2 模块级暂停令：`【工程指令】暂停「<工程实例>」<模块名>`（单模块 hold，工程保持在建） */
export function buildPauseModuleOrder(instanceId: string, moduleName: string): string {
  const id = assertToken('工程实例名', instanceId);
  return `【工程指令】暂停「${id}」${assertModuleName(moduleName)}`;
}

/** V2 模块级恢复令：`【工程指令】恢复「<工程实例>」<模块名>` */
export function buildResumeModuleOrder(instanceId: string, moduleName: string): string {
  const id = assertToken('工程实例名', instanceId);
  return `【工程指令】恢复「${id}」${assertModuleName(moduleName)}`;
}

/** V2 模块跨基地指派令：`【工程指令】指派「<工程实例>」<模块名>，承建基地：<基地名>` */
export function buildAllocateModuleOrder(instanceId: string, moduleName: string, base: string): string {
  const id = assertToken('工程实例名', instanceId);
  const mod = assertModuleName(moduleName);
  const b = assertToken('基地', base);
  return `【工程指令】指派「${id}」${mod}，承建基地：${b}`;
}

/** 模块级三令按钮载荷（V2 专用；与 EngCommandButton 同构 + 模块定位二元组） */
export interface EngModuleCommandButton {
  verb: '注资' | '暂停' | '恢复';
  label: string;
  enabled: boolean;
  /** title 提示：enabled=语义说明，disabled=禁用理由 */
  hint: string;
  /** 模块定位（指令用模块名；id 供网格选中态回链） */
  moduleId: string;
  moduleName: string;
}

/**
 * V2 工程级按钮矩阵（暂停/恢复/取消；无注资——V2 注资是模块级指令）：
 * - 在建：暂停/取消可用；暂停：恢复/取消可用；
 * - 规划中/无实例：全禁（规划中提示立项；无实例提示先立项）；
 * - 完工/取消（终态）：全禁。门语义逐条镜像 projectEngine setProjectV2Hold/cancelProjectV2 前置校验。
 */
export function engV2ProjectButtons(project: Pick<ProjectV2, 'status'> | null): EngCommandButton[] {
  const status = project?.status ?? null;
  const terminal = status === '完工' || status === '取消';

  const pauseEnabled = status === '在建';
  const resumeEnabled = status === '暂停';
  const cancelEnabled = status === '在建' || status === '暂停';
  const projectHint = (enabledHint: string): string => {
    if (status === null) return ENG_COMMAND_COPY.v2.disabled.noInstance;
    if (terminal) return ENG_COMMAND_COPY.disabled.terminal(status);
    if (status === '规划中') return ENG_COMMAND_COPY.disabled.planning;
    return enabledHint;
  };

  return [
    {
      verb: '暂停',
      label: ENG_COMMAND_COPY.label.pause,
      enabled: pauseEnabled,
      hint: pauseEnabled ? ENG_COMMAND_COPY.v2.hint.pause : projectHint(ENG_COMMAND_COPY.disabled.pauseNeedActive),
      phaseIdx: null,
    },
    {
      verb: '恢复',
      label: ENG_COMMAND_COPY.label.resume,
      enabled: resumeEnabled,
      hint: resumeEnabled ? ENG_COMMAND_COPY.v2.hint.resume : projectHint(ENG_COMMAND_COPY.disabled.resumeNeedPaused),
      phaseIdx: null,
    },
    {
      verb: '取消',
      label: ENG_COMMAND_COPY.label.cancel,
      enabled: cancelEnabled,
      hint: cancelEnabled ? ENG_COMMAND_COPY.v2.hint.cancel : projectHint(ENG_COMMAND_COPY.disabled.cancelNeedActiveOrPaused),
      phaseIdx: null,
    },
  ];
}

/**
 * V2 模块级三令按钮矩阵（注资/暂停/恢复；取消恒工程级——引擎与解析层同口径）：
 * - 前置完工门（拓扑版阶段顺序门）：prereqs 全完工才可注资（引擎侧复核，UI 只给最近门）；
 * - 模块终态（完工/取消）→ 三令全禁；工程终态/暂停/规划中/无实例 → 模块令全禁（对齐 investModule/setModuleHold 前置校验）。
 */
export function engV2ModuleButtons(
  project: Pick<ProjectV2, 'status' | 'modules'> | null,
  def: EngV2DefView,
  moduleId: string,
): EngModuleCommandButton[] | null {
  const moduleDef = def.modules.find(m => m.id === moduleId);
  if (!moduleDef) return null;
  const inst = project?.modules.find(m => m.id === moduleId) ?? null;
  const moduleName = inst?.name.trim() || moduleDef.name.trim() || moduleDef.id;
  const status = project?.status ?? null;
  const terminal = status === '完工' || status === '取消';
  const mStatus = inst?.status ?? '未启动';
  const moduleTerminal = mStatus === '完工' || mStatus === '取消';

  const statusOf = (id: string) => project?.modules.find(m => m.id === id)?.status ?? '未启动';
  const blocking = moduleDef.prereqs.filter(dep => statusOf(dep) !== '完工');
  const prereqNames = blocking
    .map(dep => project?.modules.find(m => m.id === dep)?.name.trim() || def.modules.find(m => m.id === dep)?.name.trim() || dep);

  const fundEnabled = status === '在建' && mStatus === '未启动' && blocking.length === 0;
  const pauseEnabled = status === '在建' && mStatus === '进行中';
  const resumeEnabled = status === '在建' && mStatus === '暂停';

  const moduleHint = (enabledHint: string): string => {
    if (status === null) return ENG_COMMAND_COPY.v2.disabled.noInstance;
    if (terminal) return ENG_COMMAND_COPY.disabled.terminal(status);
    if (status === '规划中') return ENG_COMMAND_COPY.disabled.planning;
    if (status !== '在建') return ENG_COMMAND_COPY.v2.disabled.projectNotActive;
    return enabledHint;
  };

  return [
    {
      verb: '注资',
      label: ENG_COMMAND_COPY.v2.label.fundModule,
      enabled: fundEnabled,
      hint: fundEnabled
        ? ENG_COMMAND_COPY.v2.hint.fundModule
        : moduleHint(
            moduleTerminal
              ? ENG_COMMAND_COPY.v2.disabled.moduleTerminal(mStatus)
              : mStatus !== '未启动'
                ? ENG_COMMAND_COPY.v2.disabled.moduleNeedPending
                : ENG_COMMAND_COPY.v2.disabled.prereqUnmet(prereqNames.join('、')),
          ),
      moduleId,
      moduleName,
    },
    {
      verb: '暂停',
      label: ENG_COMMAND_COPY.v2.label.pauseModule,
      enabled: pauseEnabled,
      hint: pauseEnabled
        ? ENG_COMMAND_COPY.v2.hint.pauseModule
        : moduleHint(
            moduleTerminal
              ? ENG_COMMAND_COPY.v2.disabled.moduleTerminal(mStatus)
              : ENG_COMMAND_COPY.v2.disabled.moduleNeedActive,
          ),
      moduleId,
      moduleName,
    },
    {
      verb: '恢复',
      label: ENG_COMMAND_COPY.v2.label.resumeModule,
      enabled: resumeEnabled,
      hint: resumeEnabled
        ? ENG_COMMAND_COPY.v2.hint.resumeModule
        : moduleHint(
            moduleTerminal
              ? ENG_COMMAND_COPY.v2.disabled.moduleTerminal(mStatus)
              : ENG_COMMAND_COPY.v2.disabled.moduleNeedPaused,
          ),
      moduleId,
      moduleName,
    },
  ];
}

/** 工程级 V2 按钮 → 指令文本（暂停/恢复/取消与 V1 文本同形；注资是模块级令——工程级入口直接拒收） */
export function buildOrderForV2ProjectButton(button: EngCommandButton, instanceId: string): string {
  switch (button.verb) {
    case '注资':
      throw new RangeError('仓段化工程注资是模块级指令——请用 buildOrderForV2ModuleButton（模块名定位）');
    case '暂停':
      return buildPauseOrder(instanceId);
    case '恢复':
      return buildResumeOrder(instanceId);
    case '取消':
      return buildCancelOrder(instanceId);
  }
}

/** 模块级 V2 按钮 → 指令文本（模块定位用模块名；非法输入 fail-closed 抛 RangeError） */
export function buildOrderForV2ModuleButton(button: EngModuleCommandButton, instanceId: string): string {
  switch (button.verb) {
    case '注资':
      return buildFundModuleOrder(instanceId, button.moduleName);
    case '暂停':
      return buildPauseModuleOrder(instanceId, button.moduleName);
    case '恢复':
      return buildResumeModuleOrder(instanceId, button.moduleName);
  }
}

/**
 * V2 取消结算文案。逐字镜像 projectEngine.ts cancelProjectV2 的 settlementText 模板
 * （仓段化模块版 §3.3 固定口径：已注资模块点名＋金额合计不退＋折算进度作废＋纳米零抵扣）；
 * def 缺省时金额退化为「已注资金额」（与引擎同分支）。parity 由 engCommands.test.ts 对
 * cancelProjectV2 实调钉死（与 V1 buildCancelSettlement 同手法）。
 */
export function buildCancelSettlementV2(
  project: Pick<ProjectV2, 'ref' | 'modules'>,
  def?: { modules: readonly { id: string; cost?: number }[] } | null,
): string {
  const fundedModules = project.modules.filter(
    m => m.status === '完工' || m.status === '进行中' || m.status === '暂停',
  );
  const names = fundedModules.map(m => `「${m.name}」`).join('、');
  const amounts = def
    ? fundedModules.map(m => def.modules.find(d => d.id === m.id)?.cost ?? 0)
    : null;
  const total = amounts ? amounts.reduce((s, v) => s + v, 0) : null;
  return (
    `仓段化工程「${project.ref}」取消结算：已注资 ${fundedModules.length} 个模块（${names || '无'}）` +
    (total !== null ? `，注资合计 ${total} 资金` : '，已注资金额') +
    `不予退还；未完成模块的折算进度全部作废。` +
    `已消耗纳米不予退还，取消操作不再扣减纳米库存。`
  );
}

/** 模块网格卡片视图模型（V2 工程卡；五态色板键与 phase/场景热点同款语言） */
export interface EngV2ModuleCard {
  moduleId: string;
  /** 展示名：实例名 → 定义名 → id（三层兑底） */
  name: string;
  status: ProjectModule['status'];
  /** 五态色板键（pending/active/paused/done/cancelled，对齐 engScene 热点色语言） */
  stateKey: 'pending' | 'active' | 'paused' | 'done' | 'cancelled';
  /** 承建基地（Base.id；''=未指派——未启动模块注资时刻才指派） */
  baseId: string;
  /** 承建基地显示名（bases 名解析，缺席回退 id；''=待指派） */
  baseName: string;
  /** 投影 queue 索引指针；null=未投影 */
  queueIndex: number | null;
  /** queue 投影名（`ref·模块名` 命名合同，projectEngine projectionItemName 唯一真源）；null=未投影 */
  projectionName: string | null;
  /** prereqs 未满足（仅未启动模块参与判定）→ 置灰 */
  locked: boolean;
  /** 未完工前置模块显示名（标注前置用） */
  blockingPrereqs: string[];
  /** 模块注资额（声明位展示；undefined=未声明） */
  cost: number | undefined;
}

const ENG_V2_STATE_KEY: Record<ProjectModule['status'], EngV2ModuleCard['stateKey']> = {
  未启动: 'pending',
  进行中: 'active',
  暂停: 'paused',
  完工: 'done',
  取消: 'cancelled',
};

/**
 * 模块网格卡片集（纯派生）：def.modules 为骨架，实例 modules 按 id 回填五态/承建基地/queue 指针；
 * 无实例（未立项）→ 全未启动，非根模块一律置灰标前置（根模块=prereqs 空集可注资）。
 */
export function engV2ModuleCards(
  def: EngV2DefView,
  instance: Pick<ProjectV2, 'modules'> | null,
  bases: readonly EngInitiateBaseCandidate[] | undefined,
): EngV2ModuleCard[] {
  const statusOf = (id: string) => instance?.modules.find(m => m.id === id)?.status ?? '未启动';
  const displayNameOf = (id: string): string =>
    instance?.modules.find(m => m.id === id)?.name.trim() ||
    def.modules.find(m => m.id === id)?.name.trim() ||
    id;

  return def.modules.map(m => {
    const inst = instance?.modules.find(x => x.id === m.id) ?? null;
    const status = inst?.status ?? '未启动';
    const baseId = inst?.base || (inst as { assigned_base?: string } | null)?.assigned_base || '';
    const baseName = baseId ? bases?.find(b => b.id === baseId)?.name.trim() || baseId : '';
    const blockingPrereqs = m.prereqs.filter(dep => statusOf(dep) !== '完工').map(displayNameOf);
    return {
      moduleId: m.id,
      name: displayNameOf(m.id),
      status,
      stateKey: ENG_V2_STATE_KEY[status],
      baseId,
      baseName,
      queueIndex: inst && inst.queue_index !== null ? inst.queue_index : null,
      projectionName:
        inst && inst.queue_index !== null ? projectionItemName(def.name, displayNameOf(m.id)) : null,
      locked: status === '未启动' && blockingPrereqs.length > 0,
      blockingPrereqs,
      cost: m.cost,
    };
  });
}
