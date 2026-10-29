/**
 * researchAdvisory 纯函数测试（RAC-ADV-01）：
 * §3.4 生成类型矩阵（含全部 fail-closed 行）/ §3.5 令牌判定 / §3.7 多基地分组推导 / prompt 格式化 / §3.8 注入配置。
 * 事件监听、令牌消费、真实 injectPrompts 属 RAC-ENTRY-01 与真机边界，此处不涉及。
 */
import { describe, expect, it } from 'vitest';
import { deriveResearchableWithContext } from '../core/catalog';
import { mergeEffectiveCatalog, type DlcOverlay, type DynamicWorldbookCatalog } from '../core/catalogEffective';
import type { WorldbookResearchData } from '../../中控悬浮窗/models/worldbookCatalogParser';
import { buildCatalogPrerequisiteContext, queueItemsForAction } from '../core/catalogRuntimeContext';
import type { FloorCandidate, FloorSnapshot } from '../parse/floorScanner';
import {
  buildResearchAdvisoryInjection,
  deriveResearchAdvisory,
  formatResearchAdvisory,
  planResearchAdvisory,
  RESEARCH_ADVISORY_INJECT_CONFIG,
  RESEARCH_ADVISORY_INJECT_ID,
  RESEARCH_ADVISORY_READONLY_NOTICE,
  resolveGenerationEntry,
  shouldInject,
  type GenerationDescriptor,
} from '../planning/researchAdvisory';
import { Schema, SCHEMA_VERSION } from '../core/schema';

// ───────── 夹具 ─────────

/** 核心 Generate 发射 AFTER_COMMANDS 时的 options 形状（含 depth=0、automatic_trigger 未定义） */
const coreOptions = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  automatic_trigger: undefined,
  signal: undefined,
  depth: 0,
  ...extra,
});

const core = (type: string | undefined, extra: Partial<GenerationDescriptor> = {}): GenerationDescriptor => ({
  type,
  options: coreOptions(),
  dryRun: false,
  hasStartedToken: true,
  ...extra,
});

const initialBase = (id = 'b1', name = '初始基地', buildings: { name: string; state?: string }[] = []) => ({
  id,
  name,
  buildings,
});

const snapshotOf = (stat: Record<string, unknown>, floorId = 3): FloorSnapshot => ({
  floorId,
  schemaVersion: SCHEMA_VERSION,
  data: Schema.parse(stat),
});

const NO_OVERLAYS: DlcOverlay[] = [];

/** ActionBar 权威链（ActionBar.vue 163-198）在测试内的直接复刻，用于一致性对照 */
function authorityResearchable(data: Schema, baseId: string, overlays: DlcOverlay[]) {
  const ctx = buildCatalogPrerequisiteContext({
    bases: data.bases,
    selectedBaseId: baseId,
    techDone: data.tech.done,
    forces: data.forces,
  });
  if (!ctx) return null;
  const queued = queueItemsForAction(data.queues, '研究', baseId, data.bases);
  return deriveResearchableWithContext(mergeEffectiveCatalog(overlays).researches, ctx, queued).map(r => r.name);
}

// ───────── §3.5 令牌判定 ─────────

describe('shouldInject（§3.5 Helper 自定义 generate 过滤）', () => {
  it('令牌存在 + options 含核心字段 → true', () => {
    expect(shouldInject({ hasStartedToken: true, options: coreOptions() })).toBe(true);
    expect(shouldInject({ hasStartedToken: true, options: { signal: undefined } })).toBe(true);
    expect(shouldInject({ hasStartedToken: true, options: { depth: 0 } })).toBe(true);
    expect(shouldInject({ hasStartedToken: true, options: { automatic_trigger: false } })).toBe(true);
  });
  it('无 STARTED 令牌 → false（Helper generate 只发 AFTER_COMMANDS）', () => {
    expect(shouldInject({ hasStartedToken: false, options: coreOptions() })).toBe(false);
  });
  it('options 为空对象 / 无核心字段 / 非对象 → false', () => {
    expect(shouldInject({ hasStartedToken: true, options: {} })).toBe(false);
    expect(shouldInject({ hasStartedToken: true, options: { force_name2: 'x' } })).toBe(false);
    expect(shouldInject({ hasStartedToken: true, options: null as unknown as Record<string, unknown> })).toBe(false);
  });
});

// ───────── §3.4 生成类型矩阵 ─────────

describe('resolveGenerationEntry（§3.4 生成类型→基线矩阵）', () => {
  it('顶部正常发送（type normal / undefined）→ normal', () => {
    expect(resolveGenerationEntry(core('normal'))).toBe('normal');
    expect(resolveGenerationEntry(core(undefined))).toBe('normal');
  });
  it('ActionBar（sendAction 已创建 user 楼，调用方标记）→ actionbar', () => {
    expect(resolveGenerationEntry(core('normal', { viaActionBar: true }))).toBe('actionbar');
  });
  it('regenerate / swipe / continue 原样映射', () => {
    expect(resolveGenerationEntry(core('regenerate'))).toBe('regenerate');
    expect(resolveGenerationEntry(core('swipe'))).toBe('swipe');
    expect(resolveGenerationEntry(core('continue'))).toBe('continue');
  });
  it('fail-closed：quiet / impersonate / 未知类型 → null', () => {
    expect(resolveGenerationEntry(core('quiet'))).toBeNull();
    expect(resolveGenerationEntry(core('impersonate'))).toBeNull();
    expect(resolveGenerationEntry(core('ask_command'))).toBeNull();
  });
  it('fail-closed：dry_run → null', () => {
    expect(resolveGenerationEntry(core('normal', { dryRun: true }))).toBeNull();
  });
  it('fail-closed：depth>0 → null；depth=0 放行', () => {
    expect(resolveGenerationEntry(core('normal', { options: coreOptions({ depth: 1 }) }))).toBeNull();
    expect(resolveGenerationEntry(core('normal', { options: coreOptions({ depth: 0 }) }))).toBe('normal');
  });
  it('fail-closed：automatic_trigger 为真 → null', () => {
    expect(resolveGenerationEntry(core('normal', { options: coreOptions({ automatic_trigger: true }) }))).toBeNull();
  });
  it('fail-closed：Helper 自定义 generate（无 STARTED 令牌 / options 为 {}）→ null', () => {
    expect(resolveGenerationEntry(core('normal', { hasStartedToken: false }))).toBeNull();
    expect(resolveGenerationEntry(core('normal', { options: {} }))).toBeNull();
  });
});

// ───────── §3.7 多基地分组推导 ─────────

describe('deriveResearchAdvisory（§3.7 多基地分组推导）', () => {
  it('初始基地正常三候选：与 ActionBar 权威链一致，含 基础步兵训练学 / 石油勘探学 / 合成燃料学', () => {
    const snap = snapshotOf({ economy: { credits: 1000 }, bases: [initialBase()] });
    const advisory = deriveResearchAdvisory(snap, NO_OVERLAYS);
    expect(advisory).not.toBeNull();
    expect(advisory!.floorId).toBe(3);
    expect(advisory!.schemaVersion).toBe(SCHEMA_VERSION);
    expect(advisory!.credits).toBe(1000);
    expect(advisory!.groups).toHaveLength(1);

    const group = advisory!.groups[0];
    expect(group.baseId).toBe('b1');
    expect(group.baseName).toBe('初始基地');
    expect(group.researchSlotBusy).toBe(false);
    expect(group.queuedResearch).toEqual([]);

    const names = group.candidates.map(c => c.name);
    expect(names).toEqual(authorityResearchable(snap.data, 'b1', NO_OVERLAYS));
    expect(names).toEqual(expect.arrayContaining(['基础步兵训练学', '石油勘探学', '合成燃料学']));
    expect(names).toHaveLength(3);
    for (const c of group.candidates) {
      expect(typeof c.cost).toBe('number');
      expect(c.eta).not.toBe('');
      expect(c.affordable).toBe(true);
    }
  });

  it('研究槽占用：研究队列非空 → researchSlotBusy=true，队列项从候选中剔除', () => {
    const snap = snapshotOf({
      economy: { credits: 1000 },
      bases: [initialBase()],
      queues: [{ type: '研究', item: '石油勘探学', base: 'b1' }],
    });
    const group = deriveResearchAdvisory(snap, NO_OVERLAYS)!.groups[0];
    expect(group.researchSlotBusy).toBe(true);
    expect(group.queuedResearch).toEqual(['石油勘探学']);
    const names = group.candidates.map(c => c.name);
    expect(names).not.toContain('石油勘探学');
    expect(names).toEqual(authorityResearchable(snap.data, 'b1', NO_OVERLAYS));
  });

  it('资金不足标记：credits 低于费用的候选 affordable=false，其余为 true', () => {
    const snap = snapshotOf({ economy: { credits: 320 }, bases: [initialBase()] });
    const candidates = deriveResearchAdvisory(snap, NO_OVERLAYS)!.groups[0].candidates;
    const byName = Object.fromEntries(candidates.map(c => [c.name, c]));
    expect(byName['石油勘探学'].cost).toBe(300);
    expect(byName['石油勘探学'].affordable).toBe(true);
    expect(byName['合成燃料学'].cost).toBe(350);
    expect(byName['合成燃料学'].affordable).toBe(false);
  });

  it('已完成研究从候选中剔除；建筑前置按当前基地三态求值', () => {
    const snap = snapshotOf({
      economy: { credits: 1000 },
      tech: { done: ['石油勘探学'] },
      bases: [initialBase('b1', '初始基地', [{ name: '兵营', state: '运转' }])],
    });
    const names = deriveResearchAdvisory(snap, NO_OVERLAYS)!.groups[0].candidates.map(c => c.name);
    expect(names).not.toContain('石油勘探学');
    expect(names).toContain('石油开采学'); // prereqs: ['石油勘探学']
    expect(names).toContain('个人装备工程学'); // need_buildings: ['兵营']
    expect(names).toEqual(authorityResearchable(snap.data, 'b1', NO_OVERLAYS));
  });

  it('多基地：每个 Base.id 独立推导，建筑前置只看本基地', () => {
    const snap = snapshotOf({
      economy: { credits: 1000 },
      bases: [initialBase('b1', '主基地', [{ name: '兵营', state: '运转' }]), initialBase('b2', '前哨', [])],
    });
    const advisory = deriveResearchAdvisory(snap, NO_OVERLAYS)!;
    expect(advisory.groups.map(g => [g.baseId, g.baseName])).toEqual([
      ['b1', '主基地'],
      ['b2', '前哨'],
    ]);
    const [main, outpost] = advisory.groups;
    expect(main.candidates.map(c => c.name)).toContain('个人装备工程学');
    expect(outpost.candidates.map(c => c.name)).not.toContain('个人装备工程学');
    expect(main.candidates.map(c => c.name)).toEqual(authorityResearchable(snap.data, 'b1', NO_OVERLAYS));
    expect(outpost.candidates.map(c => c.name)).toEqual(authorityResearchable(snap.data, 'b2', NO_OVERLAYS));
  });

  it('多基地：研究队列全局可见（镜像 ActionBar hasResearchInQueue），两组均标记占用', () => {
    const snap = snapshotOf({
      bases: [initialBase('b1', '主基地'), initialBase('b2', '前哨')],
      queues: [{ type: '研究', item: '合成燃料学', base: 'b2' }],
    });
    const advisory = deriveResearchAdvisory(snap, NO_OVERLAYS)!;
    expect(advisory.groups.every(g => g.researchSlotBusy)).toBe(true);
    expect(advisory.groups.every(g => !g.candidates.some(c => c.name === '合成燃料学'))).toBe(true);
  });

  it('$dlc overlay 参与有效目录：新研究项进入候选；损坏 overlay 被忽略', () => {
    const overlay: DlcOverlay = {
      id: 'dlc-test',
      researches: [
        {
          name: 'DLC测试研究',
          cost: 100,
          eta: '约1日',
          line: '测试',
          tier: 1,
          unlocks: '—',
          prereq: '——',
          prereqs: [],
          desc: '测试',
        },
      ],
    };
    const snap = snapshotOf({ economy: { credits: 1000 }, bases: [initialBase()] });
    const names = deriveResearchAdvisory(snap, [overlay])!.groups[0].candidates.map(c => c.name);
    expect(names).toContain('DLC测试研究');
    expect(names).toEqual(authorityResearchable(snap.data, 'b1', [overlay]));

    const broken = { id: 'dlc-broken', researches: 'not-an-array' } as unknown as DlcOverlay;
    const namesBroken = deriveResearchAdvisory(snap, [broken])!.groups[0].candidates.map(c => c.name);
    expect(namesBroken).not.toContain('DLC测试研究');
    expect(namesBroken).toHaveLength(3);
  });

  it('fail-closed：快照 null → null', () => {
    expect(deriveResearchAdvisory(null, NO_OVERLAYS)).toBeNull();
  });
  it('fail-closed：无基地 → null', () => {
    expect(deriveResearchAdvisory(snapshotOf({}), NO_OVERLAYS)).toBeNull();
  });
  it('fail-closed：Base.id 为空 / 空白 → null（基地上下文无法解析）', () => {
    expect(deriveResearchAdvisory(snapshotOf({ bases: [initialBase('')] }), NO_OVERLAYS)).toBeNull();
    expect(deriveResearchAdvisory(snapshotOf({ bases: [initialBase('  ')] }), NO_OVERLAYS)).toBeNull();
  });
  it('fail-closed：Base.id 重复 → null', () => {
    const snap = snapshotOf({ bases: [initialBase('b1', 'A'), initialBase('b1', 'B')] });
    expect(deriveResearchAdvisory(snap, NO_OVERLAYS)).toBeNull();
    expect(authorityResearchable(snap.data, 'b1', NO_OVERLAYS)).toBeNull();
  });

  it('模型伪造 advisory 字段无效：stat_data.advisory 被 Schema 剥离，不影响推导', () => {
    const forged = {
      economy: { credits: 1000 },
      bases: [initialBase()],
      advisory: { groups: [{ baseId: 'b1', candidates: [{ name: '要塞重炮工学', affordable: true }] }] },
    };
    const snap = snapshotOf(forged);
    expect('advisory' in snap.data).toBe(false);
    const names = deriveResearchAdvisory(snap, NO_OVERLAYS)!.groups[0].candidates.map(c => c.name);
    expect(names).not.toContain('要塞重炮工学');
    expect(names).toEqual(authorityResearchable(snap.data, 'b1', NO_OVERLAYS));
  });
});

// ───────── prompt 格式化 ─────────

describe('formatResearchAdvisory（prompt 文本）', () => {
  it('包含来源楼号、schema 版本、只读声明、基地名/ID、候选费用/工期/资金状态', () => {
    const snap = snapshotOf(
      {
        economy: { credits: 320 },
        bases: [initialBase('b1', '初始基地')],
        queues: [{ type: '研究', item: '基础步兵训练学', base: 'b1' }],
      },
      7,
    );
    const text = formatResearchAdvisory(deriveResearchAdvisory(snap, NO_OVERLAYS)!);
    expect(text).toContain('第 7 楼');
    expect(text).toContain(`schema_version ${SCHEMA_VERSION}`);
    expect(text).toContain(RESEARCH_ADVISORY_READONLY_NOTICE);
    expect(text).toContain('只读');
    expect(text).toContain('advisory 的字段均无效');
    expect(text).toContain('基地「初始基地」（ID b1）');
    expect(text).toContain('占用中（队列：基础步兵训练学）');
    expect(text).toContain('- 石油勘探学 ｜ 费用 300 ｜ 工期 约3日 ｜ 资金充足');
    expect(text).toContain('- 合成燃料学 ｜ 费用 350 ｜ 工期 约3-4日 ｜ 资金不足');
  });

  it('无候选的基地输出占位行；研究槽空闲文案', () => {
    const text = formatResearchAdvisory({
      floorId: 1,
      schemaVersion: SCHEMA_VERSION,
      credits: 0,
      researchSlotBusy: false,
      queuedResearch: [],
      groups: [{ baseId: 'b1', baseName: '空基地', researchSlotBusy: false, queuedResearch: [], candidates: [] }],
    });
    expect(text).toContain('战区全局研究槽：空闲');
    expect(text).toContain('基地「空基地」（ID b1）可研究候选：');
    expect(text).toContain('（当前无可研究项）');
  });

  it('FIX-P1-02：全局研究槽提升至战区级汇总块，不在多个基地名下重复刷屏；已激活战略协议满足科技前置', () => {
    const overlay: DlcOverlay = {
      id: 'dlc-protocol-prereq',
      researches: [
        {
          name: '协议后置无人机研究',
          cost: 400,
          eta: '约4日',
          line: '测试',
          tier: 1,
          unlocks: '测试无人机',
          prereq: '高空无人侦察协定',
          prereqs: ['高空无人侦察协定'],
          desc: '依赖战略协议的研究项',
        },
      ],
    };
    const snap = snapshotOf({
      economy: { credits: 1000 },
      bases: [initialBase('b1', '一号基地'), initialBase('b2', '二号基地')],
      queues: [{ type: '研究', item: '基础步兵训练学', base: 'b1' }],
      protocols: [{ ref: 'all.protocol.ra3.high_altitude_uav_pact', status: 'active' }],
    } as Record<string, unknown>);
    const advisory = deriveResearchAdvisory(snap, [overlay])!;
    expect(advisory.researchSlotBusy).toBe(true);
    expect(advisory.queuedResearch).toEqual(['基础步兵训练学']);
    expect(advisory.groups[0].candidates.map(c => c.name)).toContain('协议后置无人机研究');
    const text = formatResearchAdvisory(advisory);
    expect(text.match(/占用中（队列：基础步兵训练学）/g)).toHaveLength(1);
    expect(text).toContain('战区全局研究槽：占用中（队列：基础步兵训练学）');
  });
});

// ───────── §3.8 注入配置 ─────────

describe('注入配置（§3.8）', () => {
  it('常量严格匹配 §3.8', () => {
    expect(RESEARCH_ADVISORY_INJECT_ID).toBe('tavernweave.research-advisory.v1');
    expect(RESEARCH_ADVISORY_INJECT_CONFIG).toEqual({
      id: 'tavernweave.research-advisory.v1',
      position: 'in_chat',
      depth: 0,
      role: 'system',
      should_scan: false,
    });
  });
  it('buildResearchAdvisoryInjection：配置字段 + content 为格式化文本', () => {
    const advisory = deriveResearchAdvisory(snapshotOf({ bases: [initialBase()] }), NO_OVERLAYS)!;
    const injection = buildResearchAdvisoryInjection(advisory);
    expect(injection).toMatchObject(RESEARCH_ADVISORY_INJECT_CONFIG);
    expect(injection.content).toBe(formatResearchAdvisory(advisory));
    expect(Object.keys(injection).sort()).toEqual(['content', 'depth', 'id', 'position', 'role', 'should_scan']);
  });
});

// ───────── 组合入口 ─────────

describe('planResearchAdvisory（组合入口，供 RAC-ENTRY-01）', () => {
  const ai = (stat_data: unknown): FloorCandidate => ({ role: 'assistant', is_hidden: false, stat_data });
  const user = (): FloorCandidate => ({ role: 'user', is_hidden: false, stat_data: undefined });
  const statA = { bases: [initialBase('b1', '楼A基地')] };
  const statB = { bases: [initialBase('b1', '楼B基地')] };
  const floors: FloorCandidate[] = [user(), ai(statA), user(), ai(statB)];
  const readFloor = (id: number) => floors[id] ?? null;

  it('normal：含末尾 assistant（3 楼）', () => {
    const plan = planResearchAdvisory({
      generation: core('normal'),
      lastMessageId: 3,
      readFloor,
      overlays: NO_OVERLAYS,
    });
    expect(plan?.entry).toBe('normal');
    expect(plan?.scanStart).toBe(3);
    expect(plan?.snapshot.floorId).toBe(3);
    expect(plan?.advisory.groups[0].baseName).toBe('楼B基地');
    expect(plan?.injection.id).toBe(RESEARCH_ADVISORY_INJECT_ID);
    expect(plan?.injection.content).toContain('第 3 楼');
  });
  it('actionbar：末尾 user 楼被扫描器跳过，取此前 assistant', () => {
    const withUser = [...floors, user()];
    const plan = planResearchAdvisory({
      generation: core('normal', { viaActionBar: true }),
      lastMessageId: 4,
      readFloor: id => withUser[id] ?? null,
      overlays: NO_OVERLAYS,
    });
    expect(plan?.entry).toBe('actionbar');
    expect(plan?.snapshot.floorId).toBe(3);
  });
  it('regenerate / swipe：排除末尾目标楼，取 1 楼', () => {
    for (const type of ['regenerate', 'swipe']) {
      const plan = planResearchAdvisory({ generation: core(type), lastMessageId: 3, readFloor, overlays: NO_OVERLAYS });
      expect(plan?.scanStart).toBe(2);
      expect(plan?.snapshot.floorId).toBe(1);
      expect(plan?.advisory.groups[0].baseName).toBe('楼A基地');
    }
  });
  it('continue：含末尾 assistant', () => {
    const plan = planResearchAdvisory({
      generation: core('continue'),
      lastMessageId: 3,
      readFloor,
      overlays: NO_OVERLAYS,
    });
    expect(plan?.snapshot.floorId).toBe(3);
  });
  it('fail-closed：生成类型被拒 / 空聊天 / 无合法楼 → null', () => {
    expect(
      planResearchAdvisory({ generation: core('quiet'), lastMessageId: 3, readFloor, overlays: NO_OVERLAYS }),
    ).toBeNull();
    expect(
      planResearchAdvisory({ generation: core('normal'), lastMessageId: -1, readFloor, overlays: NO_OVERLAYS }),
    ).toBeNull();
    expect(
      planResearchAdvisory({
        generation: core('normal'),
        lastMessageId: 1,
        readFloor: () => ai({ schema_version: 2, exposure: { value: 99 } }),
        overlays: NO_OVERLAYS,
      }),
    ).toBeNull();
  });
});

/* ═════════ R3：世界书动态目录通道（dynamicWb 注入） ═════════ */

describe('R3 世界书动态目录通道（deriveResearchAdvisory / planResearchAdvisory 的 dynamicWb）', () => {
  /** 世界书新增研究条目（WorldbookResearchData 形状；静态基线与 $dlc 均不存在此名） */
  const WB_RESEARCH: WorldbookResearchData = {
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
  };
  const WB_DYNAMIC: DynamicWorldbookCatalog = { researches: [WB_RESEARCH] };
  const snap = () => snapshotOf({ economy: { credits: 1000 }, bases: [initialBase()] });

  it('传 dynamicWb：世界书新增研究进入候选（费用/工期/资金标记齐备），追加在基线候选之后', () => {
    const group = deriveResearchAdvisory(snap(), NO_OVERLAYS, WB_DYNAMIC)!.groups[0];
    const hit = group.candidates.find(c => c.name === '世界书新增研究');
    expect(hit).toMatchObject({ cost: 200, eta: '约2日', affordable: true });
    // 与三源合并口径一致：静态基线 3 候选原序保留，世界书新名追加在后
    const names = group.candidates.map(c => c.name);
    expect(names).toEqual([...authorityResearchable(snap().data, 'b1', NO_OVERLAYS)!, '世界书新增研究']);
  });

  it('传 dynamicWb + 队列占用：世界书研究在队列中则从候选剔除（镜像既有队列口径）', () => {
    const busySnap = snapshotOf({
      economy: { credits: 1000 },
      bases: [initialBase()],
      queues: [{ type: '研究', item: '世界书新增研究', base: 'b1' }],
    });
    const group = deriveResearchAdvisory(busySnap, NO_OVERLAYS, WB_DYNAMIC)!.groups[0];
    expect(group.queuedResearch).toEqual(['世界书新增研究']);
    expect(group.candidates.map(c => c.name)).not.toContain('世界书新增研究');
  });

  it('不传 / null / 空对象：与不传时逐字节一致（向后兼容，世界书研究不出现）', () => {
    const baseline = deriveResearchAdvisory(snap(), NO_OVERLAYS);
    expect(deriveResearchAdvisory(snap(), NO_OVERLAYS, null)).toEqual(baseline);
    expect(deriveResearchAdvisory(snap(), NO_OVERLAYS, undefined)).toEqual(baseline);
    expect(deriveResearchAdvisory(snap(), NO_OVERLAYS, {})).toEqual(baseline);
    expect(baseline!.groups[0].candidates.map(c => c.name)).not.toContain('世界书新增研究');
  });

  it('planResearchAdvisory 透传 dynamicWb：注入文本出现世界书新增研究', () => {
    const ai = (stat_data: unknown): FloorCandidate => ({ role: 'assistant', is_hidden: false, stat_data });
    const plan = planResearchAdvisory({
      generation: core('normal'),
      lastMessageId: 0,
      readFloor: id => (id === 0 ? ai({ economy: { credits: 1000 }, bases: [initialBase()] }) : null),
      overlays: NO_OVERLAYS,
      dynamicWb: WB_DYNAMIC,
    });
    expect(plan).not.toBeNull();
    expect(plan!.injection.content).toContain('世界书新增研究');
    expect(plan!.injection.content).toContain('费用 200');
  });
});
