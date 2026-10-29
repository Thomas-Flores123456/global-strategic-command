/**
 * scheduleText 测试（CTRL-RECONCILE-01 标准① · §4.1.1 冻结稿）：
 * 两级分组骨架 / 条令体谓语对照 / 空态 / 产线同源（消费注入 laneKeyFor）/ 显示名兜底 /
 * 研究序列一节（含未开通理由）/ 效率投影与停摆 / 纯函数零突变。
 *
 * 沿革：本文件改写自 productionReconciliation.test.ts 原「② buildScheduleText（§4.1 SPEC）」7 例
 * （逐例对照见 CTRL-RECONCILE-01 标准① 回执），并扩展两级分组与产线同源新例。
 */
import { describe, expect, it } from 'vitest';
import type { DynamicWorldbookCatalog } from '../core/catalogEffective';
import { predictExperimentOutcome } from '../engines/protocolEngine';
import { SCHEDULE_COPY } from '../planning/scheduleCopy';
import {
  buildScheduleText,
  hasProjectScheduleActivity,
  hasProtocolScheduleActivity,
  planScheduleInjection,
  renderProjectSection,
  SCHEDULE_INJECT_CONFIG,
  SCHEDULE_INJECT_ID,
  type ScheduleResearchLane,
} from '../planning/scheduleText';
import type { Project, ProtocolInstance } from '../core/schema';
import type { TransactionItem } from '../engines/transactionEngine';

/** 造一条 v2 全字段事务（默认 active、工期 1000 分钟，风格对齐 transactionEngine.test.ts） */
function txn(overrides: Partial<TransactionItem> = {}): TransactionItem {
  return {
    type: '生产',
    item: '测试载具',
    base: 'alpha',
    progress: 0,
    eta: '',
    status: 'active',
    started_at: '',
    total_minutes: 1000,
    spent_minutes: 0,
    qty: 1,
    qty_done: 0,
    cost_paid: true,
    min_days_lock: 0,
    hold: false,
    ...overrides,
  };
}

const BASES = [
  { id: 'b1', name: '青岚基地' },
  { id: 'b2', name: '北坡基地' },
];

/** 模拟调用方接线的研究序列表（laneKey 与注入 laneKeyFor 输出对齐） */
const RESEARCH_LANES: ScheduleResearchLane[] = [
  { key: 'research:slot.vehicle', name: '载具研究序列', limit: 1 },
  {
    key: 'research:slot.industry',
    name: '工业基础研究序列',
    limit: 0,
    lockedReason: '矿石精炼厂未建成，序列未开通',
  },
];

/** 模拟调用方接线的 laneKeyFor（研究 → research: 槽 lane；其余 → base|type） */
const laneKeyFor = (t: TransactionItem) => (t.type === '研究' ? 'research:slot.vehicle' : `${t.base} ${t.type}`);

describe('CTRL-RECONCILE-01 标准① · buildScheduleText（§4.1.1 两级分组条令体）', () => {
  it('空队列：标签完整＋全空条令句（原「空队列占位行」例改写）', () => {
    const text = buildScheduleText([]);
    expect(text.startsWith('<当前工程日程>')).toBe(true);
    expect(text.endsWith('</当前工程日程>')).toBe(true);
    expect(text).toContain('当前各基地与科研序列均无在编工程');
  });

  it('批次流水：节拍＝total/qty，单台尚需＝单位−(spent mod 单位)，全批尚需＝total−spent（数值钉死）', () => {
    // unit=2880（2天）；spent=3600 → 已下线 1 台、本台已走 720 → 单台尚需 2160=1天12小时；全批尚需 10800=7天12小时
    const q = txn({
      item: '犀牛主战坦克',
      total_minutes: 14400,
      spent_minutes: 3600,
      qty: 5,
      qty_done: 1,
      progress: 25,
    });
    const text = buildScheduleText([q]);
    expect(text).toContain('· 犀牛主战坦克——进度 25%；已下线 1/5 台；节拍 2天；单台尚需 1天12小时；全批尚需 7天12小时');
  });

  it('批次 spent=0：单台尚需＝整批节拍', () => {
    const q = txn({ item: '犀牛主战坦克', total_minutes: 14400, spent_minutes: 0, qty: 5, qty_done: 0 });
    const text = buildScheduleText([q]);
    expect(text).toContain('节拍 2天；单台尚需 2天；全批尚需 10天');
  });

  it('单台（qty=1）：尚需＝total−spent', () => {
    const q = txn({ type: '建造', item: '战车工厂', total_minutes: 1440, spent_minutes: 360, progress: 25 });
    const text = buildScheduleText([q]);
    expect(text).toContain('· 战车工厂——进度 25%；尚需 18小时');
  });

  it('settling 谓语冻结档：实体已就绪，待战区呈报收讫确认；不出倒计时数字', () => {
    const q = txn({
      item: '犀牛主战坦克',
      status: 'settling',
      total_minutes: 14400,
      spent_minutes: 14400,
      qty: 5,
      qty_done: 5,
      progress: 100,
    });
    const text = buildScheduleText([q]);
    expect(text).toContain('· 犀牛主战坦克——已下线 5/5 台；实体已就绪，待战区呈报收讫确认');
    expect(text).not.toContain('尚需');
    // 冻结谓语常量钉死（§4.1.1 唯一保留的指令性暗示）
    expect(SCHEDULE_COPY.settling).toBe('实体已就绪，待战区呈报收讫确认');
  });

  it('工期未核定（total_minutes=0）：不推算时限', () => {
    const q = txn({ type: '研究', item: '装甲载具工学', total_minutes: 0, progress: 35 });
    const text = buildScheduleText([q]);
    expect(text).toContain('· 装甲载具工学——进度 35%；工期未核定，暂不排定时限');
  });

  it('排队谓语：首项无「列于」段；后续「列于X之后」（同 lane 数组序）；暂缓奉令', () => {
    const qs = [txn({ item: '磁暴步兵', status: 'queued', hold: true }), txn({ item: '防空履带车', status: 'queued' })];
    const text = buildScheduleText(qs);
    expect(text).toContain('· 磁暴步兵——已立项待产；奉令暂缓');
    expect(text).toContain('· 防空履带车——已立项待产，列于「磁暴步兵」之后');
    expect(text.indexOf('磁暴步兵')).toBeLessThan(text.indexOf('防空履带车'));
  });

  it('效率投影：供给率措辞钉死；eff=0 记「因工况中断，进度冻结」', () => {
    const q = txn({
      item: '犀牛主战坦克',
      total_minutes: 14400,
      spent_minutes: 3600,
      qty: 5,
      qty_done: 1,
      progress: 25,
    });
    const half = buildScheduleText([q], { effFor: () => 0.5 });
    expect(half).toContain('按当前供给折算（供给率 50%，已按实计）：节拍 4天；单台尚需 3天；全批尚需 15天');
    const stalled = buildScheduleText([q], { effFor: () => 0 });
    expect(stalled).toContain('· 犀牛主战坦克——进度 25%；已下线 1/5 台；因工况中断，进度冻结');
  });

  it('纯函数：入参队列与选项零突变', () => {
    const qs = [txn({ item: '犀牛主战坦克', total_minutes: 14400, spent_minutes: 3600, qty: 5, qty_done: 1 })];
    const options = { bases: BASES, researchLanes: RESEARCH_LANES, laneKeyFor };
    const qsSnapshot = structuredClone(qs);
    const optionsSnapshot = structuredClone({ bases: BASES, researchLanes: RESEARCH_LANES });
    buildScheduleText(qs, options);
    expect(qs).toStrictEqual(qsSnapshot);
    expect(options.bases).toStrictEqual(optionsSnapshot.bases);
    expect(options.researchLanes).toStrictEqual(optionsSnapshot.researchLanes);
  });

  it('两级骨架：基地按 bases 数组序（id/名 双解归属），序列头在编/上限照实呈现', () => {
    const qs = [
      txn({ item: '犀牛主战坦克', base: 'b1' }),
      txn({ item: '围墙', type: '建造', base: '青岚基地' }), // 基地名归属与 id 互解 → 同基地
      txn({ item: '灰熊坦克', base: 'b2' }),
    ];
    const text = buildScheduleText(qs, { bases: BASES });
    const iQinglan = text.indexOf('◆ 基地「青岚基地」');
    const iBeipo = text.indexOf('◆ 基地「北坡基地」');
    expect(iQinglan).toBeGreaterThanOrEqual(0);
    expect(iBeipo).toBeGreaterThan(iQinglan);
    // 青岚基地下两条 lane（生产/建造），各在编 1/1
    expect(text).toContain('▸ 生产产线（在编 1/1）');
    expect(text).toContain('▸ 建造产线（在编 1/1）');
    expect(text.indexOf('▸ 生产产线')).toBeLessThan(text.indexOf('▸ 建造产线'));
    // 占用口径与引擎一致：仅 active 占产线（settling/queued 不计）
    const mixed = buildScheduleText(
      [
        txn({ item: 'A', status: 'active' }),
        txn({ item: 'B', status: 'settling' }),
        txn({ item: 'C', status: 'queued' }),
      ],
      { bases: [{ id: 'alpha', name: '甲基地' }] },
    );
    expect(mixed).toContain('▸ 生产产线（在编 1/1）');
  });

  it('空基地列「（当前无在编工程）」；未登记基地按原始 base 值兜底列后', () => {
    const qs = [txn({ item: '幽灵坦克', base: 'ghost' })];
    const text = buildScheduleText(qs, { bases: BASES });
    // 在册空基地照常列出空态
    expect(text).toContain('◆ 基地「青岚基地」\n（当前无在编工程）');
    // 未登记基地兜底组列在在册基地之后
    expect(text.indexOf('◆ 基地「北坡基地」')).toBeLessThan(text.indexOf('◆ 基地「ghost」'));
    expect(text).toContain('· 幽灵坦克——');
  });

  it('研究单列「战区科研调度」一节：占用/未开通理由照实；研究事务不落基地组', () => {
    const qs = [
      txn({ type: '研究', item: '机动侦察工学', base: 'b1', progress: 35 }),
      txn({ item: '犀牛主战坦克', base: 'b1' }),
    ];
    const text = buildScheduleText(qs, { bases: BASES, researchLanes: RESEARCH_LANES, laneKeyFor });
    const iResearch = text.indexOf('◆ 战区科研调度');
    expect(iResearch).toBeGreaterThan(text.indexOf('◆ 基地「青岚基地」'));
    expect(text).toContain('▸ 载具研究序列（在编 1/1）\n· 机动侦察工学——进度 35%');
    expect(text).toContain('▸ 工业基础研究序列：矿石精炼厂未建成，序列未开通');
    // 研究条目不出现在基地段（青岚基地段只含生产产线）
    const baseSection = text.slice(text.indexOf('◆ 基地「青岚基地」'), iResearch);
    expect(baseSection).not.toContain('机动侦察工学');
    expect(baseSection).toContain('▸ 生产产线（在编 1/1）');
  });

  it('F1 措辞档：未开通序列下存在在册条目时，序列头挂「（遗留 N 项在册）」；零条目不挂', () => {
    const qs = [
      txn({ type: '研究', item: '精炼工艺改良', base: 'b1', status: 'queued' }),
      txn({ type: '研究', item: '矿石分选法', base: 'b1', progress: 20 }),
    ];
    const toIndustry = (t: TransactionItem) => (t.type === '研究' ? 'research:slot.industry' : `${t.base} ${t.type}`);
    const text = buildScheduleText(qs, { bases: BASES, researchLanes: RESEARCH_LANES, laneKeyFor: toIndustry });
    expect(text).toContain('▸ 工业基础研究序列：矿石精炼厂未建成，序列未开通（遗留 2 项在册）');
    // 遗留条目照常呈现（谓语不受锁头影响）
    expect(text).toContain('· 精炼工艺改良——已立项待研');
    expect(text).toContain('· 矿石分选法——进度 20%');
    // 零条目锁头不挂计数（对照：未开通且无在册条目）
    expect(text).toContain('▸ 载具研究序列（在编 0/1）');
  });

  it('F1 对照：未开通且零在册条目的序列头维持冻结原档（无遗留计数段）', () => {
    const text = buildScheduleText([txn({ item: '犀牛主战坦克', base: 'b1' })], {
      bases: BASES,
      researchLanes: RESEARCH_LANES,
      laneKeyFor,
    });
    expect(text).toContain('▸ 工业基础研究序列：矿石精炼厂未建成，序列未开通\n');
    expect(text).not.toContain('序列未开通（遗留');
  });

  it('产线同源（红线）：分组只消费注入 laneKeyFor 的真实输出，文本侧不自建分类', () => {
    const qs = [txn({ item: '甲', type: '生产' }), txn({ item: '乙', type: '改装' })];
    // 注入 laneKeyFor 把两条不同 type 事务并入同一 lane → 文本必须照此呈现
    const text = buildScheduleText(qs, {
      laneKeyFor: () => 'shared-lane',
      laneNameFor: () => '联合整备产线',
    });
    expect(text).toContain('▸ 联合整备产线（在编 2/1）');
    expect(text).not.toContain('改装产线');
    const laneAt = text.indexOf('▸ 联合整备产线');
    expect(text.indexOf('· 甲——')).toBeGreaterThan(laneAt);
    expect(text.indexOf('· 乙——')).toBeGreaterThan(laneAt);
  });

  it('lane 显示名兜底：非研究默认「{type}产线」；研究 lane 缺显示名不泄漏 slotId', () => {
    const qs = [txn({ type: '研究', item: '黑箱科技', base: 'b1' })];
    const text = buildScheduleText(qs, {
      bases: BASES,
      researchLanes: RESEARCH_LANES,
      laneKeyFor: () => 'research:slot.unlisted', // 序列表缺漏的 lane
    });
    expect(text).toContain(`▸ ${SCHEDULE_COPY.fallbackResearchLaneName}`);
    expect(text).not.toContain('slot.unlisted');
    // 非研究 lane 默认显示名
    const plain = buildScheduleText([txn({ item: '犀牛主战坦克', base: 'b1' })], { bases: BASES });
    expect(plain).toContain('▸ 生产产线（在编 1/1）');
  });

  it('战区时钟行：clock 存在照实呈现，缺席不出行', () => {
    const qs = [txn({ item: '犀牛主战坦克', base: 'b1' })];
    const withClock = buildScheduleText(qs, { bases: BASES, clock: { day: 3, time: '14:05' } });
    expect(withClock).toContain('◆ 战区时：第 3 日 14:05');
    const without = buildScheduleText(qs, { bases: BASES });
    expect(without).not.toContain('战区时');
  });

  it('done/cancelled 不上日程；仅终态时落全空句', () => {
    const qs = [txn({ item: '旧账', status: 'done', progress: 100 }), txn({ item: '废案', status: 'cancelled' })];
    const text = buildScheduleText(qs, { bases: BASES, researchLanes: RESEARCH_LANES, laneKeyFor });
    expect(text).toContain('当前各基地与科研序列均无在编工程');
    expect(text).not.toContain('旧账');
  });

  it('注入配置对齐 §3.8 先例：in_chat / depth 0 / system / should_scan false', () => {
    expect(SCHEDULE_INJECT_ID).toBe('tavernweave.schedule.v1');
    expect(SCHEDULE_INJECT_CONFIG).toEqual({
      id: 'tavernweave.schedule.v1',
      position: 'in_chat',
      depth: 0,
      role: 'system',
      should_scan: false,
    });
  });
});

/* ═══════════════ E2d 接缝②：planScheduleInjection 注入 deployOf（通道B 同源三回调） ═══════════════ */

describe('E2d 通道B（批（八十八）：planScheduleInjection 接缝注入 deployOf）', () => {
  const generation = { type: 'normal', options: { depth: 0 }, dryRun: false, hasStartedToken: true };
  const readFloorAt = (stat_data: unknown) => (id: number) =>
    id === 0 ? { role: 'assistant' as const, is_hidden: false, stat_data } : null;
  const mkStatData = (buildings: { name: string; state: string }[], queues: TransactionItem[]) => ({
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    bases: [{ id: 'B1', name: '主基地', power: { gen: 100, use: 0 }, buildings }],
    queues,
  });

  it('lane limitFor：在场 deploy 目标建筑（produce.* 覆盖）→ 陆线上限 1；无 deploy 块对照 0', () => {
    const statData = mkStatData(
      [{ name: '前线战车组装场', state: '运转' }],
      [txn({ item: '犀牛坦克', base: 'B1', status: 'queued', total_minutes: 1440 })],
    );
    const overlay = {
      id: 'e2d-test',
      productions: [
        {
          name: '前线战车组装车',
          cost: 2000,
          need_building: '前线战车组装场',
          need_buildings: [],
          desc: 'E2d 测试合成载具',
          deploy: { into: '前线战车组装场', capabilities: ['produce.*'] },
        },
      ],
    };
    const plan = planScheduleInjection({
      generation,
      lastMessageId: 0,
      readFloor: readFloorAt(statData),
      overlays: [overlay as never],
    });
    expect(plan).not.toBeNull();
    // 「前线战车组装场」不含「战车工厂」：上限 1 唯通道B 可达
    expect(plan!.injection.content).toContain('▸ 陆地载具生产线（在编 0/1）');

    const plan0 = planScheduleInjection({
      generation,
      lastMessageId: 0,
      readFloor: readFloorAt(statData),
      overlays: [],
    });
    expect(plan0!.injection.content).toContain('▸ 陆地载具生产线（在编 0/0）');
  });

  it('slotBoard：deploy 授予 research → 主建筑研究序列开通；无 deploy 块对照锁头（能力面不覆盖仍锁）', () => {
    const statData = mkStatData(
      [{ name: '机动科研前哨', state: '运转' }],
      [txn({ item: '犀牛坦克', base: 'B1', status: 'active' })],
    );
    const overlay = {
      id: 'e2d-test',
      productions: [
        {
          name: '机动科研车',
          cost: 1500,
          need_building: '机动科研前哨',
          need_buildings: [],
          desc: 'E2d 测试合成载具',
          deploy: { into: '机动科研前哨', capabilities: ['research'] },
        },
      ],
    };
    const plan = planScheduleInjection({
      generation,
      lastMessageId: 0,
      readFloor: readFloorAt(statData),
      overlays: [overlay as never],
    });
    // 「机动科研前哨」不含「建造厂」/「MCV」：开通唯通道B 可达
    expect(plan!.injection.content).toContain('▸ 主建筑研究序列（在编 0/1）');

    const plan0 = planScheduleInjection({
      generation,
      lastMessageId: 0,
      readFloor: readFloorAt(statData),
      overlays: [],
    });
    expect(plan0!.injection.content).toContain(SCHEDULE_COPY.lockedReason('建造厂核心（MCV）'));

    // 能力面不覆盖：前沿工地 build.whitelist 解不开研究槽（结构性红线）
    const statData2 = mkStatData(
      [{ name: '前沿工地', state: '运转' }],
      [txn({ item: '犀牛坦克', base: 'B1', status: 'active' })],
    );
    const overlay2 = {
      id: 'e2d-test',
      productions: [
        {
          name: '前沿基地建设车',
          cost: 2000,
          need_building: '前沿工地',
          need_buildings: [],
          desc: 'E2d 测试合成载具',
          deploy: { into: '前沿工地', capabilities: ['build.whitelist'] },
        },
      ],
    };
    const plan2 = planScheduleInjection({
      generation,
      lastMessageId: 0,
      readFloor: readFloorAt(statData2),
      overlays: [overlay2 as never],
    });
    expect(plan2!.injection.content).toContain(SCHEDULE_COPY.lockedReason('建造厂核心（MCV）'));
  });
});

/* ═════════ R3：世界书动态目录通道（dynamicWb → lineOf 命中世界书 line） ═════════ */

describe('R3 世界书动态目录通道（planScheduleInjection.dynamicWb）', () => {
  const generation = { type: 'normal', options: { depth: 0 }, dryRun: false, hasStartedToken: true };
  const readFloorAt = (stat_data: unknown) => (id: number) =>
    id === 0 ? { role: 'assistant' as const, is_hidden: false, stat_data } : null;
  /** 世界书新增研究：line=工业基础 → 经 lineIndexFromCatalog 命中 slot.industry（静态基线查无此名） */
  const WB_DYNAMIC: DynamicWorldbookCatalog = {
    researches: [
      {
        type: 'research',
        id: 'WB-R3-001',
        name: '世界书新增研究',
        cost: 200,
        eta: '约2日',
        line: '工业基础',
        tier: 1,
        prereqs: [],
        need_buildings: [],
        tags: [],
        desc: 'R3 接线测试条目',
      },
    ],
  };
  /** 矿石精炼厂在场（工业基础序列开通，上限 1）；在编事务为世界书新增研究 */
  const statData = {
    meta: { world_id: 'cyber2042', date: '2042-03-14', day_count: 1, location: '锈蚀低壑' },
    bases: [
      { id: 'B1', name: '主基地', power: { gen: 100, use: 0 }, buildings: [{ name: '矿石精炼厂', state: '运转' }] },
    ],
    queues: [txn({ type: '研究', item: '世界书新增研究', base: 'B1' })],
  };
  const planWith = (dynamicWb?: DynamicWorldbookCatalog | null) =>
    planScheduleInjection({ generation, lastMessageId: 0, readFloor: readFloorAt(statData), overlays: [], dynamicWb });

  it('传 dynamicWb：世界书研究按世界书 line 落入工业基础研究序列', () => {
    const plan = planWith(WB_DYNAMIC);
    expect(plan).not.toBeNull();
    // 矿石精炼厂在场 → 工业基础序列开通（上限 1），世界书研究在册 1
    expect(plan!.injection.content).toContain('▸ 工业基础研究序列（在编 1/1）');
    expect(plan!.injection.content).toContain('· 世界书新增研究——');
    // 主建筑序列无遗留（研究未被兜底进 slot.main）
    expect(plan!.injection.content).not.toContain('遗留');
  });

  it('不传 dynamicWb：查无 line → 兜底主建筑序列（改造前基线行为）', () => {
    const plan0 = planWith();
    expect(plan0).not.toBeNull();
    // 工业基础序列空载
    expect(plan0!.injection.content).toContain('▸ 工业基础研究序列（在编 0/1）');
    // 世界书研究兜底进锁定的主建筑序列（遗留计数挂序列头）
    expect(plan0!.injection.content).toContain(
      `▸ 主建筑研究序列：${SCHEDULE_COPY.lockedReason('建造厂核心（MCV）')}（遗留 1 项在册）`,
    );
  });

  it('dynamicWb 为 null / 空对象：注入文本与不传逐字节一致', () => {
    const baseline = planWith()!.injection.content;
    expect(planWith(null)!.injection.content).toBe(baseline);
    expect(planWith({})!.injection.content).toBe(baseline);
  });
});

/* ═════════ PRT-SCHED-01：协议演训过程量与近期结果前馈注入（§3.6.2 / D-P28） ═════════ */

describe('PRT-SCHED-01 · <当前工程日程> 协议演训过程量与近期结果前馈注入（§3.6.2 / D-P28）', () => {
  const generation = { type: 'normal', options: { depth: 0 }, dryRun: false, hasStartedToken: true };
  const readFloorAt = (stat_data: unknown) => (id: number) =>
    id === 0 ? { role: 'assistant' as const, is_hidden: false, stat_data } : null;

  function proto(overrides: Partial<ProtocolInstance> & { ref: string }): ProtocolInstance {
    return {
      status: 'locked',
      attempts: 0,
      exp: 0,
      points_spent: 0,
      credits_spent: 0,
      auto_queued: false,
      hold: false,
      updated_at_day: 12,
      schema_version: 1,
      ...overrides,
    };
  }

  it('验收① 黄金对照：无协议或仅有 locked/available/active（无 last_result 与 auto_queued）时，输出与基线逐字节一致', () => {
    const qs = [
      txn({
        item: '犀牛主战坦克',
        base: 'b1',
        total_minutes: 14400,
        spent_minutes: 3600,
        qty: 5,
        qty_done: 1,
        progress: 25,
      }),
      txn({ type: '研究', item: '机动侦察工学', base: 'b1', progress: 35 }),
    ];
    const baseline = buildScheduleText(qs, {
      bases: BASES,
      researchLanes: RESEARCH_LANES,
      laneKeyFor,
      clock: { day: 12, time: '08:00' },
    });

    const quietProtocols: ProtocolInstance[] = [
      proto({ ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker', status: 'active', exp: 100 }),
      proto({ ref: 'sov.research.t2.iron_curtain_emergency_overload', status: 'available', exp: 0 }),
      proto({ ref: 'sov.research.t3.nuclear_command_succession_rebuild', status: 'locked', exp: 0 }),
      proto({ ref: 'all.research.t1.european_defense_agreement', status: 'undiscovered', exp: 0 }),
    ];

    expect(hasProtocolScheduleActivity(undefined)).toBe(false);
    expect(hasProtocolScheduleActivity([])).toBe(false);
    expect(hasProtocolScheduleActivity(quietProtocols)).toBe(false);

    const withQuietProtocols = buildScheduleText(qs, {
      bases: BASES,
      researchLanes: RESEARCH_LANES,
      laneKeyFor,
      clock: { day: 12, time: '08:00' },
      protocols: quietProtocols,
      protocolPoints: 3.5,
    });

    expect(withQuietProtocols).toBe(baseline);
    expect(withQuietProtocols).not.toContain('◆ 最高统帅部协议与条令演训');

    // 空队列 + 静默协议：planScheduleInjection 保持零注入（null）
    const emptyFloorPlan = planScheduleInjection({
      generation,
      lastMessageId: 0,
      readFloor: readFloorAt({
        meta: { world_id: 'cyber2042', date: '2042-03-26', day_count: 12, location: '青岚山' },
        bases: [{ id: 'b1', name: '青岚基地', power: { gen: 100, use: 40 }, buildings: [] }],
        queues: [],
        protocols: quietProtocols,
        protocol_points: 2.0,
      }),
      overlays: [],
    });
    expect(emptyFloorPlan).toBeNull();
  });

  it('验收② 演训章节全要素：在役院所与协议点流速、三类 last_result 回执、在线同源预判与自动排程标注', () => {
    const basesWithInstitutes = [
      {
        id: 'b1',
        name: '青岚基地',
        status: '正常',
        buildings: [
          { name: '07·红星实验设计局综合体', state: '运转' },
          { name: '25·超算中心', state: '运转' },
        ],
      },
    ];

    // 1. breakthrough（带揭示科技）
    // 2. accumulated（经验 +35% → 35%，且当前处于 experimenting + auto_queued）
    // 3. discovered（刚完成立项启封）
    // 4. Tier 1 第 2 轮已成 90% 经验，下一轮（第 3 轮硬保底）必成突破预判
    const protocols: ProtocolInstance[] = [
      proto({
        ref: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
        status: 'active',
        attempts: 2,
        exp: 100,
        last_result: {
          day: 12,
          outcome: 'breakthrough',
          attempt: 2,
          exp_before: 50,
          exp_after: 100,
          next_prob: 100,
        },
      }),
      proto({
        ref: 'sov.research.t2.iron_curtain_emergency_overload',
        status: 'experimenting',
        attempts: 1,
        exp: 35,
        auto_queued: true,
        queue_order: 1,
        last_result: {
          day: 12,
          outcome: 'accumulated',
          attempt: 1,
          exp_before: 0,
          exp_after: 35,
          next_prob: 65,
        },
      }),
      proto({
        ref: 'all.research.t1.european_defense_agreement',
        status: 'available',
        attempts: 0,
        exp: 0,
        last_result: {
          day: 12,
          outcome: 'discovered',
          attempt: 0,
          exp_before: 0,
          exp_after: 0,
          next_prob: 35,
        },
      }),
      proto({
        ref: 'sov.protocol.ra3.sputnik_one_way_deployment',
        status: 'experimenting',
        attempts: 2,
        exp: 90,
        auto_queued: false,
      }),
    ];

    const protocolCatalog = [
      {
        id: 'sov.protocol.ra3.combat_engineer_prefab_bunker',
        name: '战斗工兵—预制战斗碉堡协议',
        faction: '苏联',
        tier: 1 as const,
        reveals: ['sov.research.special_fortification'],
      },
      {
        id: 'sov.research.t2.iron_curtain_emergency_overload',
        name: '铁幕紧急过载协议',
        faction: '苏联',
        tier: 2 as const,
        reveals: [],
      },
    ];

    const ironPrediction = predictExperimentOutcome(
      { id: 'sov.research.t2.iron_curtain_emergency_overload', name: '铁幕紧急过载协议', faction: '苏联', tier: 2 },
      protocols[1],
      12,
    );
    const expectedIronForecast = ironPrediction.willBreakthrough
      ? '预计可达成临界突破定型（经验升至 100%）'
      : `预计完成阶段性数据积累（经验升至 ${ironPrediction.expAfter}%）`;

    const text = buildScheduleText([txn({ item: '犀牛主战坦克', base: 'b1' })], {
      bases: basesWithInstitutes,
      clock: { day: 12, time: '14:00' },
      protocols,
      protocolPoints: 2.4,
      protocolCatalog,
    });

    // 章节头与在役院所流速（基础 0.10 + 红星设计局 0.15 + 超算中心 0.10 = 0.35 点/日）
    expect(text).toContain('◆ 最高统帅部协议与条令演训');
    expect(text).toContain('· 在役院所：红星实验设计局综合体＋超算中心（协议点：当前 2.40 点，+0.35 点/日）');

    // 三类近期演训回执
    expect(text).toContain(
      '· ★ 近期演训回执：《战斗工兵—预制战斗碉堡协议》第 2 轮攻关实验取得重大突破，正式定型颁布（经验 100%），已揭示相关后续特种科研方向！',
    );
    expect(text).toContain('· ★ 近期演训回执：《铁幕紧急过载协议》第 1 轮实验完成阶段数据积累（经验 +35% → 35%）。');
    expect(text).toContain('· ★ 近期演训回执：《欧洲联合防务协议》已完成立项启封，列入可攻关序列。');

    // 攻关中 + 自动排程协议态势行（含同源确定性预判）
    expect(text).toContain(
      `· 《铁幕紧急过载协议》 [自动实验排程已启用]——已开展 1 轮实验，定型经验 35%，下次实验突破率 65%，下轮态势预判：${expectedIronForecast}`,
    );
    // 第 3 轮 Tier 1 硬保底 100% 突破预判
    expect(text).toContain(
      '· 《Sputnik一次展开前沿节点协议》——已开展 2 轮实验，定型经验 90%，下次实验突破率 100%，下轮态势预判：预计可达成临界突破定型（经验升至 100%）',
    );
  });

  it('验收② 实验室离线封存守卫：对口实验室断电/损毁离线时，输出已攒经验封存保留提示', () => {
    const offlineBases = [
      {
        id: 'b1',
        name: '青岚基地',
        status: '正常',
        buildings: [{ name: '07·红星实验设计局综合体', state: '断电' }],
      },
    ];
    const protocols: ProtocolInstance[] = [
      proto({
        ref: 'sov.research.t2.iron_curtain_emergency_overload',
        status: 'experimenting',
        attempts: 2,
        exp: 70,
        auto_queued: true,
      }),
    ];

    const text = buildScheduleText([txn({ item: '犀牛主战坦克', base: 'b1' })], {
      bases: offlineBases,
      clock: { day: 15, time: '09:30' },
      protocols,
      protocolPoints: 1.25,
    });

    expect(text).toContain('◆ 最高统帅部协议与条令演训');
    expect(text).toContain(
      '· 在役院所：战地参谋部基础推演（尚无专属科研院所在役）（协议点：当前 1.25 点，+0.10 点/日）',
    );
    expect(text).toContain('对口实验室当前离线，已攒经验 70% 封存保留');
    expect(text).toContain('[自动实验排程已启用]');
  });

  it('验收②+③ planScheduleInjection 端到端接线与零管线词泄漏断言', () => {
    const statData = {
      meta: { world_id: 'cyber2042', date: '2042-03-26', day_count: 8, location: '锈蚀低壑' },
      clock: { day: 8, time: '18:00' },
      bases: [
        {
          id: 'B1',
          name: '主基地',
          power: { gen: 200, use: 120 },
          buildings: [
            { name: '07·红星实验设计局综合体', state: '运转' },
            { name: '26·量子超算中心', state: '运转' },
          ],
        },
      ],
      queues: [],
      protocol_points: 3.2,
      protocols: [
        proto({
          ref: 'sov.research.t2.iron_curtain_emergency_overload',
          status: 'experimenting',
          attempts: 1,
          exp: 35,
          points_spent: 1,
          credits_spent: 1500,
          auto_queued: true,
          last_result: {
            day: 8,
            outcome: 'accumulated',
            attempt: 1,
            exp_before: 0,
            exp_after: 35,
            next_prob: 65,
          },
        }),
      ],
    };

    const plan = planScheduleInjection({
      generation,
      lastMessageId: 0,
      readFloor: readFloorAt(statData),
      overlays: [],
    });

    expect(plan).not.toBeNull();
    const content = plan!.injection.content;
    expect(content).toContain('◆ 最高统帅部协议与条令演训');
    expect(content).toContain('· 在役院所：红星实验设计局综合体＋量子超算中心（协议点：当前 3.20 点，+0.50 点/日）');
    expect(content).toContain('· ★ 近期演训回执：《铁幕紧急过载协议》第 1 轮实验完成阶段数据积累（经验 +35% → 35%）。');
    expect(content).toContain(
      '《铁幕紧急过载协议》 [自动实验排程已启用]——已开展 1 轮实验，定型经验 35%，下次实验突破率 65%',
    );

    // 验收③ 零管线词泄漏断言：严禁出现内部字段名或引擎函数名
    const forbiddenPipelineTokens = [
      'protocol_points',
      'auto_queued',
      'last_result',
      'deterministicRoll',
      'credits_spent',
      'points_spent',
      'settleFloor',
      'exp_before',
      'exp_after',
      'next_prob',
      'queue_order',
      'discovered_via',
      'schema_version',
      'sov.research.',
      'sov.protocol.',
      'all.research.',
    ];
    for (const token of forbiddenPipelineTokens) {
      expect(content).not.toContain(token);
    }
    expect(content).not.toMatch(/\b(?:exp|attempts)\b/);
  });
});

/* ═════════ FD-45：重大工程与改装项目日程章节（D-FF-COMP-04） ═════════ */

describe('FD-45 · 重大工程与改装项目日程章节', () => {
  const generation = { type: 'normal', options: { depth: 0 }, dryRun: false, hasStartedToken: true };

  it('空工程与纯历史已完工工程：零污染守卫生效，输出与基线逐字节一致', () => {
    const qs = [txn({ item: '犀牛主战坦克', base: 'b1', progress: 40, total_minutes: 1440, spent_minutes: 576 })];
    const baseline = buildScheduleText(qs, { bases: BASES, clock: { day: 10, time: '12:00' } });

    const historicalDone: Project[] = [
      {
        id: 'proj:history_retrofit@b1',
        ref: '59式主战坦克信息化改装',
        scope: 'base',
        bases: ['b1'],
        lead_base: 'b1',
        grade: '小改',
        status: '完工',
        outcome: { type: 'mark' },
        phases: [{ idx: 0, name: '火控换装', status: '完工', queue_index: null }],
        schema_version: 1,
      },
    ];

    expect(hasProjectScheduleActivity(undefined)).toBe(false);
    expect(hasProjectScheduleActivity([])).toBe(false);
    // 未提供 prevProjects 时，已完工工程视为历史归档
    expect(hasProjectScheduleActivity(historicalDone)).toBe(false);
    // prevProjects 中同样已完工时，亦视为历史归档
    expect(hasProjectScheduleActivity(historicalDone, historicalDone)).toBe(false);
    expect(renderProjectSection({ bases: BASES, projects: historicalDone, prevProjects: historicalDone })).toBeNull();

    const withHistory = buildScheduleText(qs, {
      bases: BASES,
      clock: { day: 10, time: '12:00' },
      projects: historicalDone,
      prevProjects: historicalDone,
    });
    expect(withHistory).toBe(baseline);
    expect(withHistory).not.toContain(SCHEDULE_COPY.projectSectionHeader);
  });

  it('V1 分阶段工程：阶段完工待注资断档提醒与常规在建态势行', () => {
    const v1Projects: Project[] = [
      {
        id: 'proj:cv63_emals@b1',
        ref: 'CV-63小鹰级电弹现代化改装',
        scope: 'base',
        bases: ['b1'],
        lead_base: 'b1',
        grade: '大改',
        status: '在建',
        outcome: { type: 'variant' },
        phases: [
          { idx: 0, name: '蒸汽弹射器拆除与甲板开槽', status: '完工', queue_index: null },
          { idx: 1, name: '中压直流盘车与直线电机舾装', status: '未启动', queue_index: null, cost: 1800 } as never,
          { idx: 2, name: '全舰电磁兼容系泊联调', status: '未启动', queue_index: null },
        ],
        schema_version: 1,
      },
      {
        id: 'proj:2s19_fcs@b2',
        ref: '2S19自行榴弹炮自动化火控改装',
        scope: 'base',
        bases: ['b2'],
        lead_base: 'b2',
        grade: '中改',
        status: '在建',
        outcome: { type: 'mark' },
        phases: [
          { idx: 0, name: '旧式瞄具拆解', status: '完工', queue_index: null },
          { idx: 1, name: '自动装弹机数控总线换装', status: '进行中', queue_index: 0 },
        ],
        schema_version: 1,
      },
    ];

    const text = buildScheduleText([txn({ item: '灰熊主战坦克', base: 'b1' })], {
      bases: BASES,
      projects: v1Projects,
    });

    expect(text).toContain('◆ 重大工程与改装项目');
    expect(text).toContain(
      '· ★ 工程阶段待续：工程《CV-63小鹰级电弹现代化改装》（主责：青岚基地）已完成第 1 阶段「蒸汽弹射器拆除与甲板开槽」，待下达【工程指令】注资启动第 2 阶段「中压直流盘车与直线电机舾装」（核定经费 1800 点）！',
    );
    expect(text).toContain(
      '· 工程《2S19自行榴弹炮自动化火控改装》（主责：北坡基地）——在建，当前推进第 2/2 阶段「自动装弹机数控总线换装」（进行中）',
    );
  });

  it('V2 仓段工程：准确汇总已完工舱段数、在建舱段名与前置已满足的可注资下一舱段', () => {
    const v2Project: Project = {
      id: 'proj:orbital_dock@b2',
      ref: '天基轨道组装船坞',
      scope: 'base',
      bases: ['b2'],
      lead_base: 'b2',
      grade: '巨构',
      status: '在建',
      outcome: { type: 'mark' },
      modules: [
        { id: 'mod_truss', name: '核心桁架舱', status: '完工', base: 'b2', queue_index: null },
        {
          id: 'mod_arm',
          name: '零重力机械装配臂',
          status: '进行中',
          base: 'b2',
          queue_index: 0,
          depends_on: ['mod_truss'],
        } as never,
        {
          id: 'mod_laser',
          name: '高能激光焊装舱',
          status: '未启动',
          base: 'b2',
          queue_index: null,
          depends_on: ['mod_truss'],
        } as never,
        {
          id: 'mod_berth',
          name: '深空船台总成',
          status: '未启动',
          base: 'b2',
          queue_index: null,
          depends_on: ['mod_arm', 'mod_laser'],
        } as never,
      ],
      schema_version: 2,
    };

    const text = buildScheduleText([], {
      bases: BASES,
      projects: [v2Project],
    });

    expect(text).toContain('◆ 重大工程与改装项目');
    expect(text).toContain(
      '· 仓段工程《天基轨道组装船坞》（主责：北坡基地）——在建（已完工 1/4 舱段；在建：零重力机械装配臂；可注资下一舱段：高能激光焊装舱）',
    );
    // 前置未满足的「深空船台总成」不提前列入可注资名单
    expect(text).not.toContain('深空船台总成');
  });

  it('跨楼层 #N-1 -> #N：整项工程本轮刚变为完工时输出星标里程碑回执，旧完工工程不重复刷屏', () => {
    const prevProjects: Project[] = [
      {
        id: 'proj:old_done@b1',
        ref: '早期防空网改造',
        scope: 'base',
        bases: ['b1'],
        lead_base: 'b1',
        grade: '小改',
        status: '完工',
        outcome: { type: 'mark' },
        phases: [{ idx: 0, name: '雷达并网', status: '完工', queue_index: null }],
        schema_version: 1,
      },
      {
        id: 'proj:just_done@b2',
        ref: '赤星天锤轨道打击平台',
        scope: 'base',
        bases: ['b2'],
        lead_base: 'b2',
        grade: '巨构',
        status: '在建',
        outcome: { type: 'mark' },
        modules: [{ id: 'm1', name: '再入制导舱', status: '进行中', base: 'b2', queue_index: 0 }],
        schema_version: 2,
      },
    ];

    const currentProjects: Project[] = [
      prevProjects[0],
      {
        ...prevProjects[1],
        status: '完工',
        modules: [{ id: 'm1', name: '再入制导舱', status: '完工', base: 'b2', queue_index: null }],
      },
    ];

    expect(hasProjectScheduleActivity(currentProjects, prevProjects)).toBe(true);
    const text = buildScheduleText([], {
      bases: BASES,
      projects: currentProjects,
      prevProjects,
    });

    expect(text).toContain('◆ 重大工程与改装项目');
    expect(text).toContain(
      '· ★ 近期工程里程碑：工程《赤星天锤轨道打击平台》（主责：北坡基地）全部阶段已正式竣工交付！',
    );
    expect(text).not.toContain('早期防空网改造');
  });

  it('planScheduleInjection 端到端：双楼扫描仅工程活跃时正常注入，且严格零管线词泄漏', () => {
    const floor0Stat = {
      schema_version: 2,
      meta: { world_id: 'cyber2042', date: '2042-04-01', day_count: 15, location: '青岚山' },
      clock: { day: 15, time: '10:00' },
      bases: [
        { id: 'b1', name: '青岚基地', power: { gen: 150, use: 80 }, buildings: [] },
        { id: 'b2', name: '北坡基地', power: { gen: 120, use: 60 }, buildings: [] },
      ],
      queues: [],
      projects: [
        {
          id: 'proj:radar_upgrade@b1',
          ref: '超视距相控阵预警网改装',
          scope: 'base',
          bases: ['b1'],
          lead_base: 'b1',
          grade: '中改',
          status: '在建',
          outcome: { type: 'mark' },
          phases: [
            { idx: 0, name: '阵列天线吊装', status: '完工', queue_index: null },
            { idx: 1, name: '后端超算滤波并网', status: '进行中', queue_index: 0 },
          ],
          schema_version: 1,
        },
      ],
    };

    const floor1Stat = {
      ...floor0Stat,
      clock: { day: 16, time: '08:00' },
      projects: [
        {
          ...floor0Stat.projects[0],
          status: '完工',
          phases: [
            { idx: 0, name: '阵列天线吊装', status: '完工', queue_index: null },
            { idx: 1, name: '后端超算滤波并网', status: '完工', queue_index: null },
          ],
        },
        {
          id: 'proj:carrier_refit@b2',
          ref: 'CV-63小鹰级电弹现代化改装',
          scope: 'base',
          bases: ['b2'],
          lead_base: 'b2',
          grade: '大改',
          status: '在建',
          outcome: { type: 'variant' },
          phases: [
            { idx: 0, name: '蒸汽管线拆除', status: '完工', queue_index: null },
            { idx: 1, name: '直线电机导轨铺设', status: '未启动', queue_index: null },
          ],
          schema_version: 1,
        },
      ],
    };

    const floors = [
      { role: 'assistant' as const, is_hidden: false, stat_data: floor0Stat },
      { role: 'user' as const, is_hidden: false, stat_data: undefined },
      { role: 'assistant' as const, is_hidden: false, stat_data: floor1Stat },
    ];

    const plan = planScheduleInjection({
      generation,
      lastMessageId: 2,
      readFloor: id => floors[id] ?? null,
      overlays: [],
    });

    expect(plan).not.toBeNull();
    expect(plan!.snapshot.floorId).toBe(2);
    const content = plan!.injection.content;
    expect(content).toContain('◆ 重大工程与改装项目');
    expect(content).toContain(
      '· ★ 近期工程里程碑：工程《超视距相控阵预警网改装》（主责：青岚基地）全部阶段已正式竣工交付！',
    );
    expect(content).toContain(
      '· ★ 工程阶段待续：工程《CV-63小鹰级电弹现代化改装》（主责：北坡基地）已完成第 1 阶段「蒸汽管线拆除」，待下达【工程指令】注资启动第 2 阶段「直线电机导轨铺设」！',
    );

    const forbiddenTokens = [
      'proj:',
      'queue_index',
      'schema_version',
      'lead_base',
      'depends_on',
      'radar_upgrade',
      'carrier_refit',
    ];
    for (const token of forbiddenTokens) {
      expect(content).not.toContain(token);
    }
  });
});

