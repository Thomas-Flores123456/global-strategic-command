/**
 * 阶段 G 回归钉：存档导入导出（importSave）+ 开局体检（worldbookManifest）+
 * HostAdapter 世界书三方法（mock）+ importedFrom 透传 $boot。
 */
import { reactive } from 'vue';
import { describe, expect, it } from 'vitest';
import { Schema } from '../../红警指挥系统/core/schema';
import { readBootFrom } from '../boot';
import { getSavePackForImportedStat, packToChoices, parseSavePack, unwrapRawObject } from '../importSave';
import {
  buildStatData,
  createLaunchSteps,
  createMockHostAdapter,
  remapBaseReferencesInStat,
  runLaunchPipeline,
  snapshotChoices,
  syncWorldbooksForWorld,
} from '../pipeline';
import { defaultChoices, type LaunchChoices } from '../presets';
import { checkWorldbookActivation, planWorldbookSync, WORLD_BOOK_MANIFESTS } from '../worldbookManifest';

const manifest = WORLD_BOOK_MANIFESTS.xiuzhen;
const cyberManifest = WORLD_BOOK_MANIFESTS.cyber2042;
const requiredNames = manifest.books.filter(b => b.required).map(b => b.name);
const OPTIONAL_BOOK = 'EVA·动态档案';

/** 合法导出包文本（G1 线格式）；overrides 可覆写顶层键制造缺陷 */
function validPackText(overrides: Record<string, unknown> = {}): string {
  const stat = Schema.parse({
    meta: { world_id: 'xiuzhen', date: '冬·腊月十五' },
    economy: { credits: 1330 },
    exposure: { value: 2.4 },
    tech: { done: ['化石燃料发电学', '风光发电学'] },
    bases: [{ id: 'yunxi', name: '云溪基地', location: '云溪谷地' }],
  });
  return JSON.stringify({
    version: 1,
    kind: 'redalert-save',
    exportedAt: '2026-09-01T12:00:00.000Z',
    source: { chat: '聊天A', message_id: 12 },
    stat_data: stat,
    ...overrides,
  });
}

// ─────────────────────────────── parseSavePack ───────────────────────────────

describe('parseSavePack · 导出包解析防御', () => {
  it('合法包通过并归一化 stat_data（Schema.parse 兑底）', () => {
    const res = parseSavePack(validPackText());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pack.kind).toBe('redalert-save');
    expect(res.pack.version).toBe(1);
    expect(res.pack.source).toEqual({ chat: '聊天A', message_id: 12 });
    expect(res.pack.exportedAt).toBe('2026-09-01T12:00:00.000Z');
    expect(res.pack.stat_data.schema_version).toBe(2);
    expect(res.pack.stat_data.economy.credits).toBe(1330);
    // 归一化补齐未导出的键
    expect(res.pack.stat_data.queues).toEqual([]);
  });

  it('缺 kind / kind 不对 → 拒收', () => {
    const noKind = parseSavePack(validPackText({ kind: undefined }));
    expect(noKind.ok).toBe(false);
    const wrongKind = parseSavePack(validPackText({ kind: 'other-save' }));
    expect(wrongKind.ok).toBe(false);
    if (!wrongKind.ok) expect(wrongKind.error).toContain('redalert-save');
  });

  it('stat_data 缺失或非法 → 拒收', () => {
    const missing = parseSavePack(validPackText({ stat_data: undefined }));
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain('stat_data');
    // 非对象形态直接拒；对象但结构非法交 Schema.parse 拒
    expect(parseSavePack(validPackText({ stat_data: '一串字符串' })).ok).toBe(false);
    expect(parseSavePack(validPackText({ stat_data: { economy: { credits: '不是数字' } } })).ok).toBe(false);
  });

  it('垃圾文本 / 非对象 JSON → 拒收且不 throw', () => {
    expect(parseSavePack('这不是JSON{{{').ok).toBe(false);
    expect(parseSavePack('[1,2,3]').ok).toBe(false);
    expect(parseSavePack('"just a string"').ok).toBe(false);
    expect(parseSavePack('null').ok).toBe(false);
  });

  it('version 缺失或非数字 → 拒收', () => {
    expect(parseSavePack(validPackText({ version: undefined })).ok).toBe(false);
    expect(parseSavePack(validPackText({ version: '1' })).ok).toBe(false);
  });
});

it('真实 raw v1 存档迁移到 v2，并通过现有 warning 通道提示', () => {
  const rawV1 = {
    schema_version: 1,
    meta: { date: '冬·腊月十五' },
    economy: { credits: 1330, wallet: { copper: 7, silver: 2, spirit_stone: { low: 1, mid: 0, high: 0 } } },
    bases: [{ id: 'yunxi', name: '云溪基地' }],
    queues: [{ type: '生产', item: '测试载具', base: 'yunxi', progress: 20 }],
  };
  const res = parseSavePack(validPackText({ stat_data: rawV1 }));
  expect(res.ok).toBe(true);
  if (!res.ok) return;
  expect(res.pack.migratedFromV1).toBe(true);
  expect(res.pack.stat_data).toMatchObject({
    schema_version: 2,
    meta: { world_id: 'xiuzhen' },
    economy: { wallet: { 铜钱: 7, 银两: 2, 下品灵石: 1, 中品灵石: 0, 上品灵石: 0 } },
    queues: [{ type: '生产', item: '测试载具', base: 'yunxi', progress: 20 }],
  });
  const { warnings } = packToChoices(res.pack, defaultChoices());
  expect(warnings.some(warning => /v1.*v2/.test(warning))).toBe(true);
});

it('未注册 world_id 拒收，不静默改写', () => {
  const invalid = Schema.parse({ schema_version: 2, meta: { world_id: 'unknown-world' } });
  const res = parseSavePack(validPackText({ stat_data: invalid }));
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toContain('未注册');
});

// ─────────────────────────────── packToChoices ───────────────────────────────

describe('packToChoices · 存档回填向导选择', () => {
  function parsedPack(overrides: Record<string, unknown> = {}) {
    const res = parseSavePack(validPackText(overrides));
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');
    return res.pack;
  }

  it('全字段回填：难度强制 custom，资金/科技/暴露/日期/地点/importedFrom 各就位，personaMode 不动', () => {
    const current: LaunchChoices = { ...defaultChoices(), personaMode: 'existing', personaName: '夜莺' };
    const { choices: next, warnings } = packToChoices(parsedPack(), current);
    expect(next.worldId).toBe('xiuzhen');
    expect(next.preset).toBe('custom');
    expect(next.customCredits).toBe(1330);
    expect(next.customTech).toEqual(['化石燃料发电学', '风光发电学']);
    expect(next.customExposure).toBe(2.4);
    expect(next.date).toBe('冬·腊月十五');
    expect(next.locationId).toBe('yunxi');
    expect(next.importedFrom).toBe('聊天A');
    expect(next.personaMode).toBe('existing');
    expect(next.personaName).toBe('夜莺');
    expect(warnings).toEqual([]);
    // 入参不被改动（纯函数契约）
    expect(current.preset).toBe('normal');
    expect(current.importedFrom).toBe('');
  });

  it('未知 base id → 保留存档原址并返回 warning，不擅自改址', () => {
    const stat = Schema.parse({
      bases: [{ id: 'atlantis', name: '亚特兰蒂斯', location: '海底既有基地' }],
      meta: { world_id: 'xiuzhen', date: '春·正月', location: '海底既有基地' },
    });
    const pack = parsedPack({ stat_data: stat });
    const { choices: next, warnings } = packToChoices(pack, defaultChoices());
    expect(next.locationId).toBe('atlantis');
    expect(warnings.some(w => w.includes('atlantis') && w.includes('存档原址'))).toBe(true);
    expect(next.preset).toBe('custom');
    expect(next.date).toBe('春·正月');
    expect(buildStatData(next).bases[0]).toMatchObject({
      id: 'atlantis',
      name: '亚特兰蒂斯',
      location: '海底既有基地',
    });
  });

  it('赛博存档回填 worldId，并保留非预设既有基地', () => {
    const stat = Schema.parse({
      meta: { world_id: 'cyber2042', date: '2042-06-01', location: '未命名工业区' },
      economy: { wallet: { 标准信用币: 12, 加密币: 3 } },
      bases: [{ id: 'save-cyber-base', name: '既有赛博基地', location: '未命名工业区' }],
    });
    const pack = parsedPack({ stat_data: stat });
    const { choices: next, warnings } = packToChoices(pack, defaultChoices());
    expect(next.worldId).toBe('cyber2042');
    expect(next.locationId).toBe('save-cyber-base');
    expect(warnings.some(warning => warning.includes('存档原址'))).toBe(true);
    const rebuilt = buildStatData(next);
    expect(rebuilt.meta.world_id).toBe('cyber2042');
    expect(rebuilt.bases[0]).toMatchObject({ id: 'save-cyber-base', location: '未命名工业区' });
    expect(rebuilt.economy.wallet).toEqual({ 标准信用币: 12, 加密币: 3 });
  });

  it('赛博存档缺日期/基地时回落赛博默认值，不继承修真默认', () => {
    const stat = Schema.parse({ meta: { world_id: 'cyber2042', date: '' }, bases: [] });
    const pack = parsedPack({ stat_data: stat });
    const { choices: next, warnings } = packToChoices(pack, defaultChoices());
    expect(next).toMatchObject({ worldId: 'cyber2042', date: '2042-03-14', locationId: 'cyber-entry' });
    expect(warnings.some(warning => warning.includes('默认日期'))).toBe(true);
    expect(warnings.some(warning => warning.includes('默认地点'))).toBe(true);
  });

  it('importedFrom 经 snapshotChoices 与 markBoot 双通道透传进 $boot', async () => {
    const choices: LaunchChoices = { ...defaultChoices(), importedFrom: '聊天A' };
    expect(snapshotChoices(choices).importedFrom).toBe('聊天A');
    const adapter = createMockHostAdapter();
    await runLaunchPipeline(createLaunchSteps(), { adapter, choices });
    const boot = readBootFrom(adapter.chatVars);
    expect(boot.confirmed).toBe(true);
    expect(boot.importedFrom).toBe('聊天A');
    expect((boot.choices as Record<string, unknown>).importedFrom).toBe('聊天A');
  });

  it('非导入开局：importedFrom 空 → $boot.importedFrom 为 null（readBootFrom 归一后不出现）', async () => {
    const adapter = createMockHostAdapter();
    await runLaunchPipeline(createLaunchSteps(), { adapter, choices: defaultChoices() });
    const boot = readBootFrom(adapter.chatVars);
    expect(boot.confirmed).toBe(true);
    expect(boot.importedFrom).toBeUndefined(); // null 不是 string，readBootFrom 略过
  });
});

// ─────────────────────────────── checkWorldbookActivation ───────────────────────────────

describe('checkWorldbookActivation · 开局体检四态', () => {
  it('P6 清单由 worlds.ts 派生：修真补航天/适配书，赛博仅挂自己的世界组', () => {
    const xiuzhenNames = manifest.books.map(book => book.name);
    const cyberNames = cyberManifest.books.map(book => book.name);
    expect(xiuzhenNames).toContain('通用·航天工业');
    expect(xiuzhenNames).toContain('修真·世界适配');
    expect(cyberNames).toContain('赛博朋克2042·世界适配');
    expect(cyberNames).not.toContain('修真·世界适配');
    expect(cyberNames).toContain('机娘·能力档案');
    expect(cyberNames).not.toContain('剧情·北坡纪事');
  });

  it('必需书全在全局启用列表 → ok（可选书同启则四数组全空）', () => {
    const r = checkWorldbookActivation(manifest, [...requiredNames, OPTIONAL_BOOK], [...requiredNames, OPTIONAL_BOOK]);
    expect(r).toEqual({ ok: true, missing: [], unavailable: [], conflicting: [], optionalMissing: [] });
  });

  it('缺一本（书文件在酒馆）→ missing 可一键修，ok=false', () => {
    const active = requiredNames.filter(n => n !== '武备·盟军');
    const r = checkWorldbookActivation(manifest, active, [...requiredNames]);
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['武备·盟军']);
    expect(r.unavailable).toEqual([]);
    expect(r.conflicting).toEqual([]);
  });

  it('书文件不在酒馆 → unavailable（不进 missing，不假装能修）', () => {
    const available = requiredNames.filter(n => n !== '通用·人员');
    const active = requiredNames.filter(n => n !== '通用·人员');
    const r = checkWorldbookActivation(manifest, active, available);
    expect(r.ok).toBe(false);
    expect(r.unavailable).toEqual(['通用·人员']);
    expect(r.missing).toEqual([]);
    expect(r.conflicting).toEqual([]);
  });

  it('可选书缺失只进 optionalMissing，不破坏 ok', () => {
    const r = checkWorldbookActivation(manifest, [...requiredNames], [...requiredNames]);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
    expect(r.unavailable).toEqual([]);
    expect(r.conflicting).toEqual([]);
    expect(r.optionalMissing).toEqual([OPTIONAL_BOOK]);
  });
});

// ─────────────────────────────── P7 排他同步（纯计划 + mock HostAdapter） ───────────────────────────────

describe('P7 · 世界书排他同步', () => {
  it('纯计划：修真→赛博时移除修真专属书，保留共享书和清单外哨兵', () => {
    const active = ['预览·他卡自有书', ...requiredNames];
    const available = [...new Set([...requiredNames, ...cyberManifest.books.map(book => book.name)])];
    const plan = planWorldbookSync(cyberManifest, active, available);
    expect(plan.unavailableRequired).toEqual([]);
    expect(plan.conflicting).toEqual(
      expect.arrayContaining(['修真·世界适配', '剧情·北坡纪事', '北坡采药营地_基地布局']),
    );
    expect(plan.next[0]).toBe('预览·他卡自有书');
    expect(plan.next).toContain('通用·人员');
    expect(plan.next).toContain('武备·盟军');
    expect(plan.next).toContain('赛博朋克2042·世界适配');
    expect(plan.next).not.toContain('修真·世界适配');
    expect(plan.next).toContain('机娘·能力档案');
    expect(new Set(plan.next).size).toBe(plan.next.length);
  });

  it('mock 往返：修真→赛博→修真只保留当前世界专属书，哨兵始终保留', async () => {
    const adapter = createMockHostAdapter();
    await syncWorldbooksForWorld(adapter, 'cyber2042');
    expect(adapter.globalBooks).toContain('预览·他卡自有书');
    expect(adapter.globalBooks).toContain('赛博朋克2042·世界适配');
    expect(adapter.globalBooks).not.toContain('修真·世界适配');
    expect(adapter.globalBooks).toContain('机娘·能力档案');

    await syncWorldbooksForWorld(adapter, 'xiuzhen');
    expect(adapter.globalBooks).toContain('预览·他卡自有书');
    expect(adapter.globalBooks).toContain('修真·世界适配');
    expect(adapter.globalBooks).toContain('机娘·能力档案');
    expect(adapter.globalBooks).not.toContain('赛博朋克2042·世界适配');
  });

  it('必需书文件缺失时 fail-closed，不调用 rebind', async () => {
    const adapter = createMockHostAdapter();
    adapter.tavernBooks = adapter.tavernBooks.filter(name => name !== '赛博朋克2042·世界适配');
    const before = [...adapter.globalBooks];
    await expect(syncWorldbooksForWorld(adapter, 'cyber2042')).rejects.toThrow('必需世界书文件缺失');
    expect(adapter.globalBooks).toEqual(before);
    expect(adapter.callLog.some(call => call.startsWith('replaceWorldbooks:'))).toBe(false);
  });

  it('写后并发新增清单外哨兵不触发误回滚，受管集合仍按目标验收', async () => {
    const adapter = createMockHostAdapter();
    const baseReplace = adapter.replaceWorldbooks.bind(adapter);
    adapter.replaceWorldbooks = async names => {
      adapter.globalBooks.push('并发·新哨兵');
      await baseReplace(names);
    };
    await expect(syncWorldbooksForWorld(adapter, 'cyber2042')).resolves.toMatchObject({ changed: true });
    expect(adapter.globalBooks).toContain('并发·新哨兵');
    expect(adapter.globalBooks).toContain('赛博朋克2042·世界适配');
    expect(adapter.globalBooks).not.toContain('修真·世界适配');
  });

  it('写后核验不一致时恢复原列表并报告；恢复失败时报告复合错误', async () => {
    const restored = createMockHostAdapter();
    const original = [...restored.globalBooks];
    const baseReplace = restored.replaceWorldbooks.bind(restored);
    let writes = 0;
    restored.replaceWorldbooks = async names => {
      writes += 1;
      if (writes === 1) {
        restored.globalBooks = ['并发·漂移书'];
        return;
      }
      await baseReplace(names);
    };
    await expect(syncWorldbooksForWorld(restored, 'cyber2042')).rejects.toThrow('已恢复原受管书集合');
    expect(restored.globalBooks).toEqual(['并发·漂移书', ...original.filter(name => name !== '预览·他卡自有书')]);

    const broken = createMockHostAdapter();
    let brokenWrites = 0;
    broken.replaceWorldbooks = async names => {
      brokenWrites += 1;
      if (brokenWrites === 1) broken.globalBooks = [...names.filter(name => name === '赛博朋克2042·世界适配')];
      throw new Error('宿主拒绝');
    };
    await expect(syncWorldbooksForWorld(broken, 'cyber2042')).rejects.toThrow('恢复原受管书集合也失败');
  });

  it('optional 不强开：未启用时保持关闭；同世界已启用时保留；跨世界往返不记忆', async () => {
    const adapter = createMockHostAdapter();
    adapter.globalBooks = adapter.globalBooks.filter(name => name !== OPTIONAL_BOOK);
    await syncWorldbooksForWorld(adapter, 'xiuzhen');
    expect(adapter.globalBooks).not.toContain(OPTIONAL_BOOK);

    adapter.globalBooks.push(OPTIONAL_BOOK);
    await syncWorldbooksForWorld(adapter, 'xiuzhen');
    expect(adapter.globalBooks).toContain(OPTIONAL_BOOK);

    await syncWorldbooksForWorld(adapter, 'cyber2042');
    expect(adapter.globalBooks).not.toContain(OPTIONAL_BOOK);
    await syncWorldbooksForWorld(adapter, 'xiuzhen');
    expect(adapter.globalBooks).not.toContain(OPTIONAL_BOOK);
  });

  it('同一 adapter 的并发同步被串行化，后发世界成为最终受管状态', async () => {
    const adapter = createMockHostAdapter(1);
    await Promise.all([syncWorldbooksForWorld(adapter, 'cyber2042'), syncWorldbooksForWorld(adapter, 'xiuzhen')]);
    expect(adapter.globalBooks).toContain('修真·世界适配');
    expect(adapter.globalBooks).not.toContain('赛博朋克2042·世界适配');
  });

  it('已处于目标列表时幂等，不重复 rebind', async () => {
    const adapter = createMockHostAdapter();
    await syncWorldbooksForWorld(adapter, 'cyber2042');
    const calls = adapter.callLog.filter(call => call.startsWith('replaceWorldbooks:')).length;
    const plan = await syncWorldbooksForWorld(adapter, 'cyber2042');
    expect(plan.changed).toBe(false);
    expect(adapter.callLog.filter(call => call.startsWith('replaceWorldbooks:')).length).toBe(calls);
  });
});

// P6 兼容接口仍保持只增不减，供旧调用方使用。
describe('HostAdapter · 一键启用世界书（mock 缺书场景）', () => {
  it('缺书 → activateWorldbooks(missing) → 重查 ok；并集去重且他卡书原样保留', async () => {
    const adapter = createMockHostAdapter();
    const before = checkWorldbookActivation(manifest, adapter.globalWorldbookNames(), adapter.allWorldbookNames());
    expect(before.ok).toBe(false);
    expect(before.missing).toEqual(['通用·人员', '武备·盟军']); // manifest 顺序下的 mock 缺书场景
    expect(adapter.globalBooks).toContain('预览·他卡自有书');

    await adapter.activateWorldbooks(before.missing);
    const after = checkWorldbookActivation(manifest, adapter.globalWorldbookNames(), adapter.allWorldbookNames());
    expect(after.ok).toBe(true);
    expect(after.missing).toEqual([]);
    // 并集去重：全量无重复
    expect(new Set(adapter.globalBooks).size).toBe(adapter.globalBooks.length);
    // 保留他卡书：清单外的书不被清掉
    expect(adapter.globalBooks).toContain('预览·他卡自有书');
    expect(adapter.callLog).toContain('activateWorldbooks:通用·人员|武备·盟军');
  });

  it('重复启用已启用的书 → 去重不产生重复项，列表长度不变', async () => {
    const adapter = createMockHostAdapter();
    await adapter.activateWorldbooks(['武备·盟军', '通用·人员']);
    const len = adapter.globalBooks.length;
    await adapter.activateWorldbooks(['武备·盟军', '全域战略指挥系统']);
    expect(adapter.globalBooks.length).toBe(len); // 全是已启用书，无新增
    expect(new Set(adapter.globalBooks).size).toBe(adapter.globalBooks.length);
  });

  it('注入定制书单：unavailable 场景可复现（书文件不在酒馆）', async () => {
    const adapter = createMockHostAdapter();
    adapter.tavernBooks = adapter.tavernBooks.filter(n => n !== '通用·装备');
    adapter.globalBooks = adapter.globalBooks.filter(n => n !== '通用·装备');
    const r = checkWorldbookActivation(manifest, adapter.globalWorldbookNames(), adapter.allWorldbookNames());
    expect(r.unavailable).toEqual(['通用·装备']);
    expect(r.missing).toEqual(['通用·人员', '武备·盟军']);
    // 一键启用只修 missing；unavailable 仍在 → ok 仍 false（不假装能修）
    await adapter.activateWorldbooks(r.missing);
    const after = checkWorldbookActivation(manifest, adapter.globalWorldbookNames(), adapter.allWorldbookNames());
    expect(after.ok).toBe(false);
    expect(after.unavailable).toEqual(['通用·装备']);
  });
});

// ─────────── G2 修正回归钉：导入开局全量继承（真机验收揭出的缺口） ───────────
// 现象：导出包含白凌（girls）/建造厂/codex，但旧版 buildStatData 永远从归零基线重建，
// 发射后楼 0 girls=0——"无缝继承所有进度"语义被阀断。修复：importedStat 作基线+表单终值覆写。

function richPackText(): string {
  const stat = Schema.parse({
    meta: { world_id: 'xiuzhen', date: '秋·九月十九', location: '青岚山北坡' },
    economy: { credits: 2000 },
    tech: { done: ['化石燃料发电学'] },
    bases: [
      { id: 'beipo', name: '北坡主基地', location: '青岚山北坡', buildings: [{ name: '建造厂核心', status: '运转' }] },
    ],
    forces: { girls: [{ name: '白凌', role: '首台机娘' }], vehicles: [] },
    codex: [{ name: '建造厂核心', kind: '建筑', desc: 'MCV 展开体' }],
    queues: [{ type: '建造', item: '发电厂', progress: 40 }],
  });
  return JSON.stringify({
    version: 1,
    kind: 'redalert-save',
    exportedAt: '2026-09-01T16:00:00.000Z',
    source: { chat: '聊天A', message_id: 2 },
    stat_data: stat,
  });
}

describe('G2 修正 · 导入开局全量继承', () => {
  it('导入后发射：girls/建筑/codex/queues 全量保留，MCV 不被重塞', () => {
    const res = parseSavePack(richPackText());
    if (!res.ok) throw new Error(res.error);
    const { choices } = packToChoices(res.pack, defaultChoices());
    const sd = buildStatData(choices);
    expect(sd.forces.girls.map(g => g.name)).toEqual(['白凌']);
    expect(sd.bases[0].buildings.map(b => b.name)).toEqual(['建造厂核心']);
    expect(sd.codex.map(c => c.name)).toEqual(['建造厂核心']);
    expect(sd.queues).toHaveLength(1);
    expect(sd.forces.vehicles).toEqual([]); // 不重塞 STARTING_VEHICLES（MCV 已展开）
    expect(sd.economy.credits).toBe(2000);
    expect(sd.tech.done).toEqual(['化石燃料发电学']);
  });

  it('导入后表单微调生效：改资金/加科技以终值覆写，进度仍保留', () => {
    const res = parseSavePack(richPackText());
    if (!res.ok) throw new Error(res.error);
    const { choices } = packToChoices(res.pack, defaultChoices());
    choices.customCredits = 500;
    choices.customTech = [...choices.customTech, '风光发电学'];
    const sd = buildStatData(choices);
    expect(sd.economy.credits).toBe(500);
    expect(sd.tech.done).toContain('风光发电学');
    expect(sd.forces.girls).toHaveLength(1);
  });

  it('导入后改址：bases[0] 换标识但建筑/状态保留', () => {
    const res = parseSavePack(richPackText());
    if (!res.ok) throw new Error(res.error);
    const { choices } = packToChoices(res.pack, defaultChoices());
    choices.locationId = 'yunxi';
    const sd = buildStatData(choices);
    expect(sd.bases[0].id).toBe('yunxi');
    expect(sd.bases[0].buildings.map(b => b.name)).toEqual(['建造厂核心']);
  });

  it('非导入开局回归：importedStat=null 时仍从归零基线构建（含 STARTING_VEHICLES 与首发 MCV 机娘）', () => {
    const sd = buildStatData(defaultChoices());
    expect(sd.forces.girls).toMatchObject([{ name: '白凌', duty: '盟军MCV移动基地车核心', hp: '完好', base: '' }]);
    expect(sd.forces.vehicles.length).toBeGreaterThan(0);
    expect(sd.economy.credits).toBe(2000);
  });

  it('$boot 快照不含 importedStat 全量树，只留 imported 标记', () => {
    const res = parseSavePack(richPackText());
    if (!res.ok) throw new Error(res.error);
    const { choices } = packToChoices(res.pack, defaultChoices());
    const snap = snapshotChoices(choices);
    expect(snap.importedStat).toBeUndefined();
    expect(snap.imported).toBe(true);
    expect(snapshotChoices(defaultChoices()).imported).toBe(false);
  });

  it('FD-37 · BUG-SAVE-01：Vue reactive(choices) 包装后 getSavePackForImportedStat 仍 100% 命中 SavePack 且流水线恢复 V2 载荷', async () => {
    const res = parseSavePack(
      validPackText({
        version: 2,
        parse_state: { aliases: { 电厂: '磁能反应堆' } },
        dlc_registry: [{ id: 'dlc_test' }],
        timeline_ledger: {
          version: 1,
          originChatId: '源聊天',
          boundBookName: '红警档案·原书',
          maxFloorWatermark: 6,
          floors: {},
        },
      }),
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const reactiveChoices = reactive<LaunchChoices>(defaultChoices());
    const { choices: next } = packToChoices(res.pack, { ...reactiveChoices });
    Object.assign(reactiveChoices, next);

    expect(unwrapRawObject(reactiveChoices.importedStat)).toBe(res.pack.stat_data);
    expect(getSavePackForImportedStat(reactiveChoices.importedStat)).toBe(res.pack);

    const adapter = createMockHostAdapter();
    await adapter.activateWorldbooks(requiredNames);
    await runLaunchPipeline(createLaunchSteps(), { adapter, choices: reactiveChoices });
    expect(adapter.chatVars['$parse']).toEqual({ aliases: { 电厂: '磁能反应堆' } });
    expect(adapter.chatVars['$dlc']).toEqual([{ id: 'dlc_test' }]);
    expect((adapter.chatVars['$timeline'] as { maxFloorWatermark?: number })?.maxFloorWatermark).toBe(6);
  });

  it('FD-37 · BUG-SAVE-04：导入改址后 girls / queues / pending_mode_switches / pending_deployments / projects / space / economy.chains 引用同步级联迁移', () => {
    const stat = Schema.parse({
      meta: { world_id: 'xiuzhen', date: '秋·九月十九', location: '青岚山北坡' },
      economy: {
        credits: 2000,
        chains: [
          {
            id: 'chain_01',
            name: '北坡矿脉直销',
            rate_daily: 300,
            deps: { base_id: 'beipo', base: '北坡主基地', buildings: ['矿石精炼厂'] },
          },
        ],
      },
      bases: [
        { id: 'beipo', name: '北坡主基地', location: '青岚山北坡', buildings: [{ name: '建造厂核心', state: '运转' }] },
        { id: 'outpost_2', name: '二号前哨站', location: '落霞山谷', buildings: [] },
      ],
      forces: {
        girls: [
          { name: '白凌', duty: '主基地统御', base: 'beipo' },
          { name: '苏离', duty: '防空执勤', base: '北坡主基地' },
          { name: '赤星', duty: '前哨驻守', base: 'outpost_2' },
        ],
        vehicles: [],
      },
      queues: [
        { type: '建造', item: '发电厂', base: 'beipo', progress: 40 },
        { type: '生产', item: '多功能步兵车', base: '北坡主基地', progress: 20 },
        { type: '建造', item: '哨戒炮', base: 'outpost_2', progress: 10 },
      ],
      pending_mode_switches: [{ base: 'beipo', building: '战车工厂', target_mode: '加速', remaining_minutes: 360 }],
      pending_deployments: [{ vehicle: 'MCV（苏联）', action: '展开', base: 'beipo', into: '建造厂', remaining_minutes: 120 }],
      projects: [
        {
          id: 'proj:test_01',
          ref: 'retrofit_power',
          scope: 'theater',
          lead_base: 'beipo',
          bases: ['beipo', 'outpost_2'],
          grade: '中改',
          phases: [{ idx: 0, name: '一阶段', status: '进行中', queue_index: null }],
        },
      ],
      space: {
        launch_centers: [{ id: 'lc_1', base: 'beipo', name: '一号航天港' }],
        contracts: [{ id: 'sc_1', title: '卫星发射', base: 'beipo', target_base: '北坡主基地' }],
        orbital_assets: [{ id: 'oa_1', name: '侦察星', scope: 'base', target_base: 'beipo' }],
      },
    });

    const res = parseSavePack(validPackText({ stat_data: stat }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const { choices } = packToChoices(res.pack, defaultChoices());
    choices.locationId = 'yunxi';
    const sd = buildStatData(choices);

    const newId = sd.bases[0].id;
    const newName = sd.bases[0].name;
    expect(newId).toBe('yunxi');
    expect(sd.forces.girls.map(g => g.base)).toEqual([newId, newName, 'outpost_2']);
    expect(sd.queues.map(q => q.base)).toEqual([newId, newName, 'outpost_2']);
    expect(sd.pending_mode_switches?.[0]?.base).toBe(newId);
    expect(sd.pending_deployments?.[0]?.base).toBe(newId);
    expect(sd.projects?.[0]?.lead_base).toBe(newId);
    expect(sd.projects?.[0]?.bases).toEqual([newId, 'outpost_2']);
    expect(sd.space.launch_centers?.[0]?.base).toBe(newId);
    expect(sd.space.contracts[0].base).toBe(newId);
    expect(sd.space.contracts[0].target_base).toBe(newName);
    expect(sd.space.orbital_assets[0].target_base).toBe(newId);
    expect(sd.economy.chains[0].deps.base_id).toBe(newId);
    expect(sd.economy.chains[0].deps.base).toBe(newName);

    // 独立验证 remapBaseReferencesInStat 支持链顶层 base 属性
    const chainWithDirectBase = { base: 'beipo' } as unknown as Schema['economy']['chains'][number];
    sd.economy.chains.push(chainWithDirectBase);
    remapBaseReferencesInStat(sd, 'beipo', '北坡主基地', newId, newName);
    expect((sd.economy.chains[1] as unknown as { base?: string }).base).toBe(newId);
  });
});
