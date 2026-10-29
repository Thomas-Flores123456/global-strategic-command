/**
 * archiveIndex 纯函数测试（RAC-FLOAT-02）：楼间 diff（new/kept）、previous null、分组顺序、
 * pending_lore 映射、世界书条目命名规则匹配（精确 / 中缀 / 后缀）、toDetail 正史 / 草稿分支。
 */
import { describe, expect, it } from 'vitest';
import {
  DOSSIER_BOOK as GIRL_FILER_DOSSIER_BOOK,
  findByGirl,
  upsertDossierEntry,
  upsertStoryEntry,
  type ThEntry,
} from '../../红警指挥系统/worldbook/girlFiler';
import { GirlDossier, Schema } from '../../红警指挥系统/core/schema';
import { ARCHIVE_BOOK as SYSTEM_CHECK_ARCHIVE_BOOK } from '../../红警指挥系统/parse/systemCheck';
import { BUILTIN_ROSTER_PERSONNEL_NAMES as EXPANSION_FILER_ROSTER_NAMES } from '../../红警指挥系统/worldbook/expansionFiler';
import {
  ARCHIVE_BOOK,
  booksFor,
  buildArchiveIndex,
  BUILTIN_ROSTER_PERSONNEL_NAMES,
  DOSSIER_BOOK,
  countArchiveIndex,
  emptyCounts,
  EXPANSION_KIND_SET,
  findMechaSupportFallback,
  KIND_ORDER,
  loadGirlDossierDetail,
  matchArchiveEntry,
  PENDING_KIND,
  STORY_BOOK,
  toDetail,
  type ArchiveEntryLike,
  type ArchiveItem,
} from '../models/archiveIndex';

function floor(
  codex: Array<Partial<Schema['codex'][number]> & { name: string }>,
  pending: Array<Partial<Schema['pending_lore'][number]> & { name: string }> = [],
) {
  return Schema.parse({ codex, pending_lore: pending });
}

const item = (over: Partial<ArchiveItem> & { name: string }): ArchiveItem => ({
  kind: '科技',
  desc: '',
  params: {},
  status: 'new',
  source: 'codex',
  ...over,
});

describe('buildArchiveIndex', () => {
  it('previous 为 null → 全部 new；current 为 null → 空索引', () => {
    const idx = buildArchiveIndex(floor([{ name: '量子雷达', kind: '科技' }]), null);
    expect(idx.groups).toEqual([
      { kind: '科技', items: [expect.objectContaining({ name: '量子雷达', status: 'new', source: 'codex' })] },
    ]);
    expect(buildArchiveIndex(null, floor([{ name: 'x' }]))).toEqual({ groups: [], pending: [] });
  });

  it('与上一楼按 name 比对：含 → kept，不含 → new（kind 改变不影响判定）', () => {
    const prev = floor([
      { name: '量子雷达', kind: '科技' },
      { name: '旧堡', kind: '建筑' },
    ]);
    const cur = floor([
      { name: '量子雷达', kind: '装备' },
      { name: '新堡', kind: '建筑' },
    ]);
    const idx = buildArchiveIndex(cur, prev);
    const flat = idx.groups.flatMap(g => g.items);
    expect(flat.map(i => [i.name, i.status])).toEqual([
      ['新堡', 'new'],
      ['量子雷达', 'kept'],
    ]);
  });

  it('分组顺序固定为 科技/建筑/载具/人员/装备/阵营/其他，只输出非空组；非法 kind 归入其他；同名去重', () => {
    const cur = floor([
      { name: 'z1', kind: '其他' },
      { name: 'f1', kind: '阵营' },
      { name: 'b1', kind: '建筑' },
      { name: 'b1', kind: '建筑' },
      { name: 'p1', kind: '人员' },
      { name: 'v1', kind: '载具' },
      { name: 'weird', kind: '不存在' as never },
    ]);
    const idx = buildArchiveIndex(cur, null);
    expect(idx.groups.map(g => g.kind)).toEqual(['建筑', '载具', '人员', '阵营', '其他']);
    expect(KIND_ORDER).toEqual(['人物', '科技', '建筑', '载具', '人员', '装备', '阵营', '其他']);
    expect(EXPANSION_KIND_SET.has('人物')).toBe(true);
    expect(emptyCounts().人物).toBe(0);
    expect(idx.groups.find(g => g.kind === '建筑')!.items).toHaveLength(1);
    expect(idx.groups.find(g => g.kind === '其他')!.items.map(i => i.name)).toEqual(['z1', 'weird']);
  });

  it('pending_lore → source=pending_lore、kind=机娘、desc 取 model/shell 摘要并截断、params 含型号/化名', () => {
    const cur = floor(
      [],
      [
        {
          name: '白凌',
          model: '盟军基地车（MCV）首台',
          shell: '北坡镇修车铺老板娘。'.repeat(10),
          alias: '凌姐',
          exposure: '🟢',
        },
      ],
    );
    const prev = floor([], [{ name: '白凌' }]);
    const fresh = buildArchiveIndex(cur, null).pending[0];
    expect(fresh).toMatchObject({ name: '白凌', kind: PENDING_KIND, source: 'pending_lore', status: 'new' });
    expect(fresh.desc.startsWith('盟军基地车（MCV）首台 · 北坡镇')).toBe(true);
    expect(fresh.desc.endsWith('…')).toBe(true);
    expect(fresh.desc.length).toBeLessThanOrEqual(61);
    expect(fresh.params).toEqual({ 型号: '盟军基地车（MCV）首台', 化名: '凌姐', 暴露分档: '🟢' });
    expect(buildArchiveIndex(cur, prev).pending[0].status).toBe('kept');
  });
});

describe('matchArchiveEntry / booksFor', () => {
  it('书名常量与来源模块一致（systemCheck.ARCHIVE_BOOK / girlFiler.DOSSIER_BOOK / expansionFiler.BUILTIN_ROSTER_PERSONNEL_NAMES）', () => {
    expect(ARCHIVE_BOOK).toBe(SYSTEM_CHECK_ARCHIVE_BOOK);
    expect(DOSSIER_BOOK).toBe(GIRL_FILER_DOSSIER_BOOK);
    expect([...BUILTIN_ROSTER_PERSONNEL_NAMES]).toEqual([...EXPANSION_FILER_ROSTER_NAMES]);
    expect(booksFor({ kind: '科技', source: 'codex' })).toEqual([ARCHIVE_BOOK]);
    expect(booksFor({ kind: '人员', source: 'codex' })).toEqual([ARCHIVE_BOOK, DOSSIER_BOOK]);
    expect(booksFor({ kind: '机娘', source: 'pending_lore' })).toEqual([DOSSIER_BOOK]);
  });

  it('codex：精确 `${kind}·${name}`（archiveCodexEntries 命名）优先，后缀 `·${name}` 兜底旧 kind 幽灵条目', () => {
    const entries = [
      { name: '建筑·量子雷达', enabled: true, content: 'old-kind' },
      { name: '科技·量子雷达', enabled: true, content: 'exact' },
      { name: '科技·量子雷达阵列', enabled: true, content: 'other' },
    ];
    expect(matchArchiveEntry(entries, item({ name: '量子雷达', kind: '科技' }))?.content).toBe('exact');
    // kind 已被 AI 改成装备，书里只有旧 kind 条目 → 后缀命中
    expect(matchArchiveEntry(entries, item({ name: '量子雷达', kind: '装备' }))?.content).toBe('old-kind');
    expect(matchArchiveEntry(entries, item({ name: '雷达', kind: '科技' }))).toBeNull();
    expect(matchArchiveEntry([], item({ name: '量子雷达' }))).toBeNull();
    expect(matchArchiveEntry(entries, item({ name: '' }))).toBeNull();
  });

  it('pending_lore / 人员：`NN·名·型号`（upsertDossierEntry 命名）按中缀命中，与 girlFiler.findByGirl 判定一致', () => {
    const entries = [
      { name: '01·机娘阵容与社会外壳总览', enabled: true, content: 'roster' },
      { name: '02·白凌·盟军基地车（MCV）首台', enabled: true, content: 'dossier' },
      { name: '03·白凌雪·能力档案', enabled: true, content: 'another' },
    ];
    const it1 = item({ name: '白凌', kind: PENDING_KIND, source: 'pending_lore' });
    expect(matchArchiveEntry(entries, it1)?.content).toBe('dossier');
    expect(matchArchiveEntry(entries, it1)?.name).toBe(findByGirl(entries, '白凌')?.name);
    // 后缀形式（无型号段）也能命中
    const suffixOnly = [{ name: '05·白凌', enabled: true, content: 'suffix' }];
    expect(matchArchiveEntry(suffixOnly, it1)?.content).toBe('suffix');
    expect(findByGirl(suffixOnly, '白凌')?.name).toBe('05·白凌');
  });

  it('同优先级下 enabled 条目优先；全部禁用则退回首个', () => {
    const entries = [
      { name: '科技·X', enabled: false, content: 'disabled' },
      { name: '科技·X', enabled: true, content: 'enabled' },
    ];
    expect(matchArchiveEntry(entries, item({ name: 'X' }))?.content).toBe('enabled');
    expect(matchArchiveEntry([entries[0]], item({ name: 'X' }))?.content).toBe('disabled');
  });
});

describe('toDetail', () => {
  it('正史：desc = 世界书正文（统一换行、去首尾空白），params 空，note 标书名', () => {
    const it1 = item({ name: '量子雷达', kind: '科技', desc: '草稿摘要', params: { 造价: '900' } });
    const d = toDetail(
      it1,
      { name: '科技·量子雷达', enabled: true, content: '  [EVA·动态档案 | 科技]\r\n· 量子雷达：正文\r\n' },
      ARCHIVE_BOOK,
    );
    expect(d).toEqual({
      title: '量子雷达',
      kind: '科技',
      params: [],
      desc: '[EVA·动态档案 | 科技]\n· 量子雷达：正文',
      note: `正史 · 《${ARCHIVE_BOOK}》`,
    });
    // 未传书名时按 booksFor 首选书标注
    expect(
      toDetail(item({ name: 'p', kind: '机娘', source: 'pending_lore' }), { name: 'x', enabled: true, content: 'c' })
        .note,
    ).toBe(`正史 · 《${DOSSIER_BOOK}》`);
  });

  it('草稿：entry 为 null 或正文空白 → 回退 codex / pending_lore 摘要，params 展开，note 标草稿', () => {
    const it1 = item({ name: '量子雷达', kind: '科技', desc: '草稿摘要', params: { 造价: '900', 工期: '3日' } });
    expect(toDetail(it1, null)).toEqual({
      title: '量子雷达',
      kind: '科技',
      params: [
        ['造价', '900'],
        ['工期', '3日'],
      ],
      desc: '草稿摘要',
      note: '草稿 · 本楼层 codex，尚未归档',
    });
    expect(toDetail(item({ name: 'e' }), { name: 'x', enabled: true, content: '   ' }).desc).toBe('——');
    expect(toDetail(item({ name: 'p', kind: '机娘', source: 'pending_lore' }), null).note).toBe(
      '草稿 · 本楼层 pending_lore，尚未入档',
    );
  });
});

describe('ARM-01 · 机娘跨世界书（含聊天绑定书 档案·{name} / 剧情·{name}）详情回读闭环', () => {
  it('booksFor 动态并入当前聊天绑定书（去重、忽略空值）', () => {
    expect(booksFor('girl', 'RA_ChatBook_Test')).toEqual([
      'RA_ChatBook_Test',
      DOSSIER_BOOK,
      STORY_BOOK,
      ARCHIVE_BOOK,
    ]);
    expect(booksFor({ kind: '机娘', source: 'pending_lore' }, 'RA_ChatBook_Test')).toEqual([
      'RA_ChatBook_Test',
      DOSSIER_BOOK,
    ]);
    expect(booksFor({ kind: '人员', source: 'codex' }, '   ')).toEqual([ARCHIVE_BOOK, DOSSIER_BOOK]);
  });

  it('模拟 girlFiler 将新机娘写入聊天绑定书 RA_ChatBook_Test 后，loadGirlDossierDetail(name) 成功同时读出 档案·{name}·{model} 的 <数据>/八段属性与 剧情·{name}·人格与现状 的正文', async () => {
    const girl = GirlDossier.parse({
      name: '苏离',
      model: 'F-47首台',
      keys: ['静默电行', '群鸦'],
      form_mech: '常态人形收拢，作战态展开变后掠翼面。',
      skills: '· 静默电行（核心）：全电推进静音巡航。\n· 群鸦：六具协同无人机。',
      flaws: '翼面展开时雷达反射面积骤增。',
      weapons: '主武器机载激光；副武器格斗导弹。',
      exposure: '🟢 静音巡航 ／ 🟡 无人机群展开',
      balance: '空军线穿透侦察位。',
      alias: '苏家表妹·苏离',
      shell: '投亲落脚的绣坊帮工。',
      appearance: '银灰短发，作战态背部展开翼面。',
      personality: '寡言，观察先于行动。',
      status: '完好，初诞适应期。',
    });

    const chatBookEntries: ThEntry[] = [];
    upsertDossierEntry(chatBookEntries, girl);
    upsertStoryEntry(chatBookEntries, girl);

    // 模拟在档案条目中附带 <数据> 块
    const dossierHit = chatBookEntries.find(e => e.name.startsWith('档案·苏离'))!;
    dossierHit.content = `${dossierHit.content}\n\n<数据>\n专属挂载: 六具群鸦协同无人机\n动力核心: 全电静音涡扇\n</数据>`;

    const books: Record<string, ArchiveEntryLike[]> = {
      RA_ChatBook_Test: chatBookEntries.map(e => ({
        name: e.name,
        enabled: e.enabled ?? true,
        content: e.content ?? '',
      })),
    };

    const res = await loadGirlDossierDetail('苏离', {
      chatBook: 'RA_ChatBook_Test',
      reader: {
        read: async (bookName: string) => books[bookName] ?? [],
      },
    });

    expect(res.book).toBe('RA_ChatBook_Test');
    expect(res.dossierEntry?.name).toBe('档案·苏离·F-47首台');
    expect(res.storyEntry?.name).toBe('剧情·苏离·人格与现状');
    expect(res.model).toBe('F-47首台');
    expect(res.weapons).toContain('主武器机载激光');
    expect(res.skills).toContain('静默电行');
    expect(res.data['专属挂载']).toBe('六具群鸦协同无人机');
    expect(res.data['动力核心']).toBe('全电静音涡扇');
    expect(res.storyContent).toContain('社会外壳：苏家表妹·苏离。投亲落脚的绣坊帮工。');
    expect(res.storyContent).toContain('当前状态：完好，初诞适应期。');
    expect(res.detail.note).toBe('正史 · 《RA_ChatBook_Test》');
    expect(res.detail.desc).toContain('[机娘·能力档案 | 苏离——F-47首台]');
    expect(res.detail.desc).toContain('[剧情·北坡纪事 | 苏离——F-47首台]');
  });

  it('buildArchiveIndex 自动剔除混在 pending_lore 中的新势力条目，且机娘保障工程条目支持只读基线回退', () => {
    const rawCurrent = {
      codex: [],
      pending_lore: [
        { name: '白凌', model: 'MCV首台', keys: [], shell: '修车铺老板娘' },
        { id: 'lore_铁幕重工', kind: '势力', name: '铁幕重工', summary: '北境军工' },
      ],
    } as unknown as Parameters<typeof buildArchiveIndex>[0];

    const idx = buildArchiveIndex(rawCurrent, null);
    expect(idx.pending.map(p => p.name)).toEqual(['白凌']);

    const supportDetail = findMechaSupportFallback('02·相变微流道散热工学');
    expect(supportDetail).not.toBeNull();
    expect(supportDetail?.title).toBe('相变微流道散热工学');
    expect(supportDetail?.note).toContain('通用·机娘保障工程');
  });

  it('FD-32 · 支持 人物 分支分组、countArchiveIndex 统计、booksFor 与 人物·{name}·设定 精确匹配', () => {
    const cur = floor([
      { name: '阿列克谢', kind: '人物', desc: '北坡军需联络官', params: { 所属势力: '铁道同盟', 信任度: '75' } },
      { name: '磁暴步兵', kind: '人员', desc: '重装磁暴兵种' },
    ]);
    const idx = buildArchiveIndex(cur, null);
    expect(idx.groups.map(g => g.kind)).toEqual(['人物', '人员']);
    const counts = countArchiveIndex(idx);
    expect(counts.人物).toBe(1);
    expect(counts.人员).toBe(1);
    expect(counts.total).toBe(2);

    expect(booksFor({ kind: '人物', source: 'codex' }, 'RA_ChatBook_NPC')).toEqual([
      'RA_ChatBook_NPC',
      ARCHIVE_BOOK,
      DOSSIER_BOOK,
    ]);

    const entries = [
      { name: '人物·阿列克谢·设定', enabled: true, content: '[人物档案 | 阿列克谢]' },
    ];
    expect(matchArchiveEntry(entries, item({ name: '阿列克谢', kind: '人物' }))?.content).toBe('[人物档案 | 阿列克谢]');
  });
});
