import { describe, expect, it } from 'vitest';
import type { Dossier, ThEntry } from '../worldbook/girlFiler';
import {
  ROSTER_MARK,
  dossierKeys,
  isGirlDossierEntry,
  nextOrder,
  nextSeq,
  renderDossierContent,
  renderRosterLine,
  renderStoryContent,
  resolveGirlWorldbookEntryNames,
  storyKeys,
  upsertDossierEntry,
  upsertStoryEntry,
} from '../worldbook/girlFiler';
import { GirlDossier } from '../core/schema';

const full = (): Dossier =>
  GirlDossier.parse({
    name: '苏离',
    model: 'F-47首台',
    keys: ['静默电行', '群鸦'],
    form_mech: '常态人形收拢，作战态展开变后掠翼面。',
    skills: '· 静默电行（核心）：全电推进静音巡航。\n· 群鸦：六具协同无人机。',
    flaws: '翼面展开时雷达反射面积骤增。',
    weapons: '主武器机载激光；副武器格斗导弹；底牌电磁脉冲弹。',
    exposure: '🟢 静音巡航 ／ 🟡 无人机群展开 ／ 🔴 电磁脉冲释放。',
    balance: '空军线穿透侦察位。',
    alias: '苏家远房表妹·苏离',
    shell: '投亲落脚的绣坊帮工。',
    appearance: '银灰短发，作战态背部展开翼面。',
    personality: '寡言，观察先于行动。',
    status: '完好，初诞适应期。',
  });

const minimal = (): Dossier => GirlDossier.parse({ name: '岚翎' });

describe('girlFiler · 渲染纯函数', () => {
  it('档案书八段全出（对齐既有体例）', () => {
    const c = renderDossierContent(full());
    expect(c).toContain('[机娘·能力档案 | 苏离——F-47首台]');
    expect(c).toContain('形态机制：');
    expect(c).toContain('能力：\n· 静默电行');
    expect(c).toContain('结构性短板：');
    expect(c).toContain('【⚔ 武器与暴露分档】');
    expect(c).toContain('· 平衡总纲位置：空军线穿透侦察位。');
  });
  it('空字段整段不出（优雅降级），无 model 时头部只留名', () => {
    const c = renderDossierContent(minimal());
    expect(c).toBe('[机娘·能力档案 | 岚翎]');
  });
  it('剧情书条目体例：社会外壳=化名+外壳拼合', () => {
    const c = renderStoryContent(full());
    expect(c).toContain('[剧情·北坡纪事 | 苏离——F-47首台]');
    expect(c).toContain('社会外壳：苏家远房表妹·苏离。投亲落脚的绣坊帮工。');
    expect(c).toContain('外观：\n银灰短发');
    expect(c).toContain('当前状态：完好');
  });
  it('总览行体例', () => {
    expect(renderRosterLine(full())).toBe('· 苏离——F-47首台。对外：苏家远房表妹·苏离。');
  });
  it('key 计算：档案书=本名+触发词去重；剧情书=本名+化名', () => {
    expect(dossierKeys(full())).toEqual(['苏离', '静默电行', '群鸦']);
    expect(storyKeys(full())).toEqual(['苏离', '苏家远房表妹·苏离']);
    expect(storyKeys(minimal())).toEqual(['岚翎']);
  });
});

describe('girlFiler · 续号纯函数', () => {
  it('nextOrder 只看 70000 带并 +1；带内无条目回 70001', () => {
    const entries: ThEntry[] = [
      { name: '01·通则', position: { order: 90000 } },
      { name: '02·白凌·盟军MCV', position: { order: 70001 } },
      { name: '21·总览', position: { order: 70020 } },
    ];
    expect(nextOrder(entries)).toBe(70021);
    expect(nextOrder([{ name: 'x', position: { order: 90000 } }])).toBe(70001);
  });
  it('nextSeq 按 comment 数字前缀补零续号', () => {
    expect(nextSeq([{ name: '01·a' }, { name: '09·b' }])).toBe('10');
    expect(nextSeq([])).toBe('01');
  });
});

describe('girlFiler · upsert 幂等（聊天书单本分段：comment 前缀 档案·/剧情·）', () => {
  it('档案段新建：E7e 纪律字段齐全，comment=档案·名·型号', () => {
    const entries: ThEntry[] = [{ name: '01·机娘通则', position: { order: 90000 }, content: '' }];
    const r = upsertDossierEntry(entries, full());
    expect(r.action).toBe('created');
    expect(r.entryName).toBe('档案·苏离·F-47首台');
    const e = r.entries.find(x => x.name === r.entryName)!;
    expect(e.strategy).toMatchObject({ type: 'selective', keys: ['苏离', '静默电行', '群鸦'] });
    expect(e.position).toMatchObject({ order: 70001 });
    expect(e.recursion).toMatchObject({ prevent_incoming: true, prevent_outgoing: true, delay_until: null });
    expect(e.enabled).toBe(true);
    expect(e.probability).toBe(100);
  });
  it('档案段二次提交：更新原条目而非重复新建', () => {
    const entries: ThEntry[] = [{ name: '01·机娘通则', position: { order: 90000 }, content: '' }];
    upsertDossierEntry(entries, full());
    const d2 = { ...full(), flaws: '改版短板。' };
    const r2 = upsertDossierEntry(entries, d2);
    expect(r2.action).toBe('updated');
    expect(entries).toHaveLength(2);
    expect(entries[1].content).toContain('改版短板');
  });
  it('档案/剧情同书不串段：剧情段既有条目不被档案段 upsert 命中', () => {
    const entries: ThEntry[] = [{ name: '剧情·苏离·人格与现状', position: { order: 70001 }, content: '旧剧情' }];
    const r = upsertDossierEntry(entries, full());
    expect(r.action).toBe('created');
    expect(entries).toHaveLength(2);
    expect(entries[0].content).toBe('旧剧情');
  });
  it('剧情段新建 + 总览行追加；再次提交幂等', () => {
    const entries: ThEntry[] = [
      {
        name: `总览·${ROSTER_MARK}`,
        position: { order: 70000 },
        content: '[本聊天机娘阵容总览]\n· 白凌——盟军MCV首台。对外：白家长女。',
      },
      { name: '剧情·白凌·人格与现状', position: { order: 70001 }, content: '' },
    ];
    const r = upsertStoryEntry(entries, full());
    expect(r.action).toBe('created');
    expect(r.entryName).toBe('剧情·苏离·人格与现状');
    expect(r.rosterAction).toBe('appended');
    const storyEntry = entries.find(x => x.name === r.entryName)!;
    expect(storyEntry.recursion).toEqual({ prevent_incoming: true, prevent_outgoing: true, delay_until: null });
    expect(entries[0].content).toContain('· 苏离——F-47首台。对外：苏家远房表妹·苏离。');
    const r2 = upsertStoryEntry(entries, full());
    expect(r2.action).toBe('updated');
    expect(r2.rosterAction).toBe('already-present');
    expect(entries).toHaveLength(3);
    expect((entries[0].content!.match(/· 苏离——/g) ?? []).length).toBe(1);
  });
  it('总览条目缺失 → 首写空阵容起步自建（roster-entry-created，不带全局书种子内容）', () => {
    const entries: ThEntry[] = [];
    const r = upsertStoryEntry(entries, minimal());
    expect(r.action).toBe('created');
    expect(r.rosterAction).toBe('roster-entry-created');
    const roster = entries.find(e => e.name.includes(ROSTER_MARK))!;
    expect(roster.name).toBe(`总览·${ROSTER_MARK}`);
    expect(roster.content).toBe('[本聊天机娘阵容总览]\n· 岚翎——新入列机娘。对外：（待定）。');
    expect(roster.content).not.toContain('白凌'); // 空阵容起步：零全局书种子
    const r2 = upsertStoryEntry(entries, minimal());
    expect(r2.rosterAction).toBe('already-present');
  });
  it('isGirlDossierEntry 类型守卫：精准识别机娘档案并拒绝新势力与带 id 暂存实体（FIX-P0-02）', () => {
    expect(isGirlDossierEntry(full())).toBe(true);
    expect(isGirlDossierEntry(minimal())).toBe(true);
    expect(isGirlDossierEntry({ kind: '势力', name: '铁幕重工', attitude: '中立', intel: '重工', risk: '高' })).toBe(
      false,
    );
    expect(isGirlDossierEntry({ id: 'lore_铁幕重工', kind: '势力', name: '铁幕重工' })).toBe(false);
    expect(isGirlDossierEntry({ id: 'lore_量子核心', kind: '科技', name: '量子核心' })).toBe(false);
    expect(isGirlDossierEntry(null)).toBe(false);
    expect(isGirlDossierEntry(['数组'])).toBe(false);
  });
  it('resolveGirlWorldbookEntryNames：返回与 upsertDossierEntry/upsertStoryEntry 100% 一致的完整条目名', () => {
    const namesFull = resolveGirlWorldbookEntryNames(full());
    expect(namesFull).toEqual({
      dossierEntryName: '档案·苏离·F-47首台',
      storyEntryName: '剧情·苏离·人格与现状',
    });

    const namesMinimal = resolveGirlWorldbookEntryNames(minimal());
    expect(namesMinimal).toEqual({
      dossierEntryName: '档案·岚翎·能力档案',
      storyEntryName: '剧情·岚翎·人格与现状',
    });

    const entries: ThEntry[] = [
      { name: '档案·苏离·F-47首台', position: { order: 70001 }, content: '' },
      { name: '剧情·苏离·人格与现状', position: { order: 70002 }, content: '' },
    ];
    const namesWithEntries = resolveGirlWorldbookEntryNames(full(), entries);
    const dRes = upsertDossierEntry(entries, full());
    const sRes = upsertStoryEntry(entries, full());
    expect(namesWithEntries.dossierEntryName).toBe(dRes.entryName);
    expect(namesWithEntries.storyEntryName).toBe(sRes.entryName);
  });
});
