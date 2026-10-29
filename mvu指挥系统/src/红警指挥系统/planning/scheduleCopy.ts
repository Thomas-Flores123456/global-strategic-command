/**
 * scheduleCopy.ts —— 《当前工程日程》条令体文案模板常量集（CTRL-RECONCILE-01 · 设计案 §4.1.1 冻结稿）
 *
 * 真源：docs/design/systems/系统事务与时间推进总设计案.md §4.1.1（v2 · 条令体 · 2026-09-29 驾驶员冻结）；
 *       docs/reference/世界书文风与受控质感编写规范.md（总参条令体语域 / 零管线词 / 零臆造数值）；
 *       docs/project/plans/协议玩法MVP任务包.md §3.6.2 / §6 PRT-SCHED-01（D-P28 协议演训过程量与近期回执注入）。
 *
 * 纪律：
 * 1. 全部注入文案集中于此，与渲染逻辑（scheduleText.ts）分离——驾驶员调文案不动逻辑；
 * 2. 零臆造数值：模板只接收调用方从事务真源算出的实参，常量本身不含任何数字；
 * 3. 零管线词：token / 槽位 / 带宽 等词不出现在注入文本（研究槽显示名经 researchLaneName 翻成「研究序列」）；
 * 4. settling 谓语冻结为「实体已就绪，待战区呈报收讫确认」一档力度（§4.1.1：唯一保留的指令性暗示）。
 */

/** 排队状态谓语动词（§4.1.1「已立项待产/待研」；建造/改装同式延伸） */
export const SCHEDULE_QUEUED_VERB: Readonly<Record<string, string>> = {
  生产: '待产',
  研究: '待研',
  建造: '待建',
  改装: '待改',
};

/** 参谋排产回执动作谓语（PLN-SCHED-01 · 零管线词映射） */
export const PLANNING_ACTION_OP_VERB: Readonly<Record<string, string>> = {
  enqueue: '入队',
  promote: '提级',
  demote: '降级',
  hold: '暂缓',
  resume: '复工',
};

export const SCHEDULE_COPY = {
  /* ── 骨架 ── */
  tagOpen: '<当前工程日程>',
  tagClose: '</当前工程日程>',
  /** 战区时钟行（stat_data.clock 照实呈现；无 clock 不出行） */
  clockLine: (day: number, time: string) => `◆ 战区时：第 ${day} 日 ${time}`,
  baseHeader: (baseName: string) => `◆ 基地「${baseName}」`,
  /** 事务 base 无法解析到任何在册基地时的兜底组名（照实呈现原始 base 值，空值才用此行） */
  baseUnnamed: '（未标注属地的工程）',
  researchSectionHeader: '◆ 战区科研调度',

  /* ── 序列头 ── */
  /** 开通序列：占用/上限照实呈现（§4.1.1）；上限非有限数（不设限）时省略上限段 */
  laneHeader: (laneName: string, activeCount: number, limit: number) =>
    Number.isFinite(limit) ? `▸ ${laneName}（在编 ${activeCount}/${limit}）` : `▸ ${laneName}（在编 ${activeCount}）`,
  /** 未开通序列：世界内理由挂序列头（§4.1.1「X未建成，序列未开通」）；lane 下有在册条目时挂遗留计数（F1 措辞档） */
  laneLocked: (laneName: string, reason: string, legacyCount = 0) =>
    `▸ ${laneName}：${reason}${legacyCount > 0 ? `（遗留 ${legacyCount} 项在册）` : ''}`,
  lockedReason: (anchor: string) => `${anchor}未建成，序列未开通`,

  /* ── 序列显示名 ── */
  /** 研究槽显示名映射：注册表「XX槽」→ 条令体「XX研究序列」（管线词「槽」翻成世界内表述） */
  researchLaneName: (slotName: string) => `${slotName.replace(/槽$/, '')}研究序列`,
  /** 非研究序列默认显示名（建造/生产/改装产线；调用方可经 laneNameFor 覆盖） */
  defaultLaneName: (type: string) => `${type}产线`,
  /** laneKey 为 research: 前缀但调用方未供显示名时的兜底（不泄漏 slotId 这类管线标识） */
  fallbackResearchLaneName: '未登记研究序列',

  /* ── 空态（§4.1.1） ── */
  baseEmpty: '（当前无在编工程）',
  allEmpty: '当前各基地与科研序列均无在编工程',

  /* ── 条目句式（§4.1.1：`· 名称——{状态谓语句}`） ── */
  itemLine: (itemName: string, predicate: string) => `· ${itemName}——${predicate}`,

  /* ── 状态谓语对照（§4.1.1） ── */
  /** 待对账（settling）：冻结档力度，唯一保留的指令性暗示 */
  settling: '实体已就绪，待战区呈报收讫确认',
  settlingBatch: (done: number, qty: number) => `已下线 ${done}/${qty} 台；实体已就绪，待战区呈报收讫确认`,
  /** 在产/在研·单台：「进度X%；尚需T」 */
  activeSingle: (progress: number, need: string) => `进度 ${progress}%；尚需 ${need}`,
  /** 在产/在研·单台·效率投影：「按当前供给折算，尚需T（供给率N%，已按实计）」（§4.1.1 倒计时措辞） */
  activeSingleEff: (progress: number, need: string, supplyPct: number) =>
    `进度 ${progress}%；按当前供给折算，尚需 ${need}（供给率 ${supplyPct}%，已按实计）`,
  /** 在产·批次三段式：「已下线n/N台；节拍t」＋ 单台/全批尚需（数值全部来自事务真源） */
  activeBatch: (progress: number, done: number, qty: number, beat: string, perUnit: string, total: string) =>
    `进度 ${progress}%；已下线 ${done}/${qty} 台；节拍 ${beat}；单台尚需 ${perUnit}；全批尚需 ${total}`,
  /** 在产·批次·效率投影：供给率前置一次，随后各时段均已按实计 */
  activeBatchEff: (
    progress: number,
    done: number,
    qty: number,
    supplyPct: number,
    beat: string,
    perUnit: string,
    total: string,
  ) =>
    `进度 ${progress}%；已下线 ${done}/${qty} 台；按当前供给折算（供给率 ${supplyPct}%，已按实计）：` +
    `节拍 ${beat}；单台尚需 ${perUnit}；全批尚需 ${total}`,
  /** 工期未知（§4.1.1） */
  unknownDuration: (progress: number) => `进度 ${progress}%；工期未核定，暂不排定时限`,
  /** 停摆（eff≤0，§4.1.1） */
  stalled: (progress: number) => `进度 ${progress}%；因工况中断，进度冻结`,
  stalledBatch: (progress: number, done: number, qty: number) =>
    `进度 ${progress}%；已下线 ${done}/${qty} 台；因工况中断，进度冻结`,
  /** 排队（§4.1.1「已立项待产/待研，列于X之后」；无前置项时不出「列于」段） */
  queued: (verb: string) => `已立项${verb}`,
  queuedAfter: (verb: string, prevItem: string) => `已立项${verb}，列于「${prevItem}」之后`,
  /** 暂缓（§4.1.1「奉令暂缓」，追加在排队谓语尾） */
  holdSuffix: '；奉令暂缓',

  /* ── 最高统帅部协议与条令演训（PRT-SCHED-01 · §3.6.2 / D-P28） ── */
  /** 协议演训章节标题 */
  protocolSectionHeader: '◆ 最高统帅部协议与条令演训',
  /** 无专属科研院所在役时的基础推演兜底表述 */
  protocolNoActiveInstitute: '战地参谋部基础推演（尚无专属科研院所在役）',
  /** 在役院所与协议点流速态势行 */
  protocolInstituteStatusLine: (institutesText: string, currentPointsText: string, dailyRateText: string) =>
    `· 在役院所：${institutesText}（协议点：当前 ${currentPointsText} 点，+${dailyRateText} 点/日）`,
  /** 近期演训回执——突破定型揭示后缀 */
  protocolBreakthroughRevealsSuffix: '，已揭示相关后续特种科研方向',
  /** 近期演训回执——重大突破定型颁布（outcome === 'breakthrough'） */
  protocolReceiptBreakthrough: (protocolName: string, attempt: number, hasReveals = false, expAfter = 100) =>
    `· ★ 近期演训回执：《${protocolName}》第 ${attempt} 轮攻关实验取得重大突破，正式定型颁布（经验 ${expAfter}%）${
      hasReveals ? '，已揭示相关后续特种科研方向' : ''
    }！`,
  /** 近期演训回执——阶段性数据积累（outcome === 'accumulated'） */
  protocolReceiptAccumulated: (protocolName: string, attempt: number, expGained: number, expAfter: number) =>
    `· ★ 近期演训回执：《${protocolName}》第 ${attempt} 轮实验完成阶段数据积累（经验 +${expGained}% → ${expAfter}%）。`,
  /** 近期演训回执——立项启封（outcome === 'discovered'） */
  protocolReceiptDiscovered: (protocolName: string) =>
    `· ★ 近期演训回执：《${protocolName}》已完成立项启封，列入可攻关序列。`,
  /** 自动实验排程开启标注 */
  protocolAutoQueuedBadge: '[自动实验排程已启用]',
  /** 下轮同源确定性态势预判——阶段性数据积累 */
  protocolForecastAccumulated: (expAfter: number) => `预计完成阶段性数据积累（经验升至 ${expAfter}%）`,
  /** 下轮同源确定性态势预判——临界突破定型 */
  protocolForecastBreakthrough: (expAfter = 100) => `预计可达成临界突破定型（经验升至 ${expAfter}%）`,
  /** 攻关中/自动排程协议态势——对口实验室在线 */
  protocolActiveProgressOnline: (attempts: number, exp: number, nextProbPercent: number, forecastText: string) =>
    `已开展 ${attempts} 轮实验，定型经验 ${exp}%，下次实验突破率 ${nextProbPercent}%，下轮态势预判：${forecastText}`,
  /** 攻关中/自动排程协议态势——对口实验室离线封存 */
  protocolActiveProgressOffline: (exp: number, attempts = 0) =>
    attempts > 0
      ? `已开展 ${attempts} 轮实验，对口实验室当前离线，已攒经验 ${exp}% 封存保留`
      : `对口实验室当前离线，已攒经验 ${exp}% 封存保留`,
  /** 攻关中/自动排程协议条目行拼装 */
  protocolStatusLine: (protocolName: string, statusPredicate: string, autoQueued = false, hold = false) =>
    `· 《${protocolName}》${autoQueued ? ' [自动实验排程已启用]' : ''}——${statusPredicate}${hold ? '；奉令暂缓' : ''}`,

  /* ── 参谋部排产方案与执行回执（PLN-SCHED-01） ── */
  /** 排产回执章节标题 */
  planningSectionHeader: '◆ 参谋部排产方案与执行回执',
  /** 排产回执状态条令表述 */
  planningStatusCommitted: '单次委托已核准入列排程（已入队待产，尚未完工入列）',
  planningStatusAdvisoryReady: '参谋试排方案已备妥，待指挥官裁决批准（方案待批准，尚未入队执行）',
  planningStatusAwaitingApproval: '委托超出预算或触及保护边界，转为待指挥官复核（方案待批准，尚未入队执行）',
  planningStatusRejected: '排产方案未通过战备核验，已予驳回',
  planningStatusStaleSnapshot: '排产快照已过期，请基于最新战况重新提报',
  /** 排产回执状态行拼装 */
  planningStatusLine: (statusText: string) => `· 方案状态：${statusText}`,
  /** 排产回执摘要行 */
  planningSummaryLine: (summary: string) => `· 参谋摘要：${summary}`,
  /** 排产回执核验/复核原因行 */
  planningReasonLine: (reason: string) => `· 核验说明：${reason}`,
  /** 排产回执经费测算行 */
  planningBudgetLine: (totalCost: number, budgetCap?: number) =>
    typeof budgetCap === 'number'
      ? `· 经费测算：合计耗资 ${totalCost} 点（预算上限 ${budgetCap} 点）`
      : `· 经费测算：合计耗资 ${totalCost} 点`,
  /** 排产回执动作明细行——入队成功/预览：`· [入队] 基地「X」：Y ×N（测算耗资 C 点；预计工期 T）` */
  planningActionAcceptedLine: (
    baseName: string,
    target: string,
    qty: number,
    costCredits: number,
    durationText: string,
    opVerb = '入队',
  ) =>
    baseName
      ? `· [${opVerb}] 基地「${baseName}」：${target} ×${qty}（测算耗资 ${costCredits} 点；预计工期 ${durationText}）`
      : `· [${opVerb}] ${target} ×${qty}（测算耗资 ${costCredits} 点；预计工期 ${durationText}）`,
  /** 排产回执动作明细行——被拒阻塞：`· [驳回] Y——原因：{reason}；建议：{nextStep}` */
  planningActionRejectedLine: (target: string, reason: string, nextStep?: string) =>
    nextStep && nextStep.trim().length > 0
      ? `· [驳回] ${target}——原因：${reason}；建议：${nextStep.trim()}`
      : `· [驳回] ${target}——原因：${reason}`,

  /* ── 重大工程与改装项目（FD-45 · D-FF-COMP-04） ── */
  /** 重大工程章节标题 */
  projectSectionHeader: '◆ 重大工程与改装项目',
  /** 近期工程里程碑——整项工程全部阶段已正式竣工交付 */
  projectMilestoneComplete: (ref: string, baseName: string) =>
    `· ★ 近期工程里程碑：工程《${ref}》（主责：${baseName}）全部阶段已正式竣工交付！`,
  /** V1 分阶段工程——前序阶段完工待下达工程指令注资启动下一阶段 */
  projectPhaseAwaitingFunding: (
    ref: string,
    baseName: string,
    donePhaseIdx: number,
    donePhaseName: string,
    nextPhaseIdx: number,
    nextPhaseName: string,
    nextCost?: number,
  ) =>
    `· ★ 工程阶段待续：工程《${ref}》（主责：${baseName}）已完成第 ${donePhaseIdx + 1} 阶段「${donePhaseName}」，待下达【工程指令】注资启动第 ${nextPhaseIdx + 1} 阶段「${nextPhaseName}」${typeof nextCost === 'number' && nextCost > 0 ? `（核定经费 ${nextCost} 点）` : ''}！`,
  /** V1 分阶段工程——在建/暂停态势行 */
  projectV1ActiveLine: (
    ref: string,
    baseName: string,
    status: string,
    phaseIdx: number,
    totalPhases: number,
    phaseName: string,
    phaseStatus: string,
  ) =>
    `· 工程《${ref}》（主责：${baseName}）——${status}，当前推进第 ${phaseIdx + 1}/${totalPhases} 阶段「${phaseName}」（${phaseStatus}）`,
  /** V2 仓段工程——在建/暂停与可注资下一舱段汇总行 */
  projectV2ActiveLine: (
    ref: string,
    baseName: string,
    status: string,
    doneCount: number,
    totalCount: number,
    activeNames: ReadonlyArray<string>,
    readyNames: ReadonlyArray<string>,
  ) =>
    `· 仓段工程《${ref}》（主责：${baseName}）——${status}（已完工 ${doneCount}/${totalCount} 舱段${activeNames.length > 0 ? `；在建：${activeNames.join('、')}` : ''}${readyNames.length > 0 ? `；可注资下一舱段：${readyNames.join('、')}` : ''}）`,
} as const;
