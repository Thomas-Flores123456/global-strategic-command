import { ARCHIVE_BOOK, readArchive, tav, type ArchiveRecord } from '../parse/systemCheck';
import { bookExists } from './dlcInstaller';
import { need, parseDlcRegistry, type DlcCodexSeed, type WbEntryFull } from './dlcManifestHelpers';

/* ═══════════════ 动态内容归档（变量→世界书晋升管道）═══════════════
 * codex（楼层变量，草稿态）晋升为《EVA·动态档案》绿灯条目（全局正史），$archive 记帐。
 * 只在驾驶员确认后执行（归档=编辑决策）；不自动双向同步。 */

export interface ArchiveCandidate {
  name: string;
  kind: string;
  desc?: string;
  params?: Record<string, string>;
}

function renderArchiveContent(it: ArchiveCandidate): string {
  const lines = [`[EVA·动态档案 | ${it.kind}]`, `· ${it.name}：${it.desc || '（暂无摘要）'}`];
  const params = Object.entries(it.params ?? {});
  if (params.length) lines.push(`（${params.map(([k, v]) => `${k} ${v}`).join(' · ')}）`);
  lines.push('（动态档案：楼层定格后由驾驶员确认晋升正史；完整叙述见对应剧情章节。）');
  return lines.join('\n');
}

/** 归档：写书（无书则建+绑卡）→ 记 $archive。返回写入的条目名 */
export async function archiveCodexEntries(items: ArchiveCandidate[]): Promise<string[]> {
  const updateVars =
    need<(u: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => unknown>(
      'updateVariablesWith',
    );
  const entries = items.map(it => ({
    name: `${it.kind}·${it.name}`,
    strategy: { type: 'selective' as const, keys: [it.name] },
    content: renderArchiveContent(it),
  }));
  // B4：存在性判断不走 getWorldbookNames（缓存会腐败，见双步舞注释）——直接试读书体
  if (!(await bookExists(ARCHIVE_BOOK))) {
    const create = need<(n: string, es: unknown[]) => Promise<unknown>>('createWorldbook');
    await create(ARCHIVE_BOOK, entries);
  } else {
    // B4：删旧+追新收进单个 updater（原先两步 API，删完追加前失败会丢条目）
    // B2：清旧按「·名字」后缀匹配——kind 被 AI 改过再重归档时，旧 kind 的幽灵条目一并清掉
    const updateWb = need<(n: string, u: (es: WbEntryFull[]) => unknown[]) => Promise<unknown>>('updateWorldbookWith');
    const suffixes = items.map(it => `·${it.name}`);
    await updateWb(ARCHIVE_BOOK, es => [
      ...es.filter(e => !suffixes.some(sfx => e.name.endsWith(sfx))),
      ...(entries as unknown as WbEntryFull[]),
    ]);
  }
  // 绑卡（去重）
  const getCharBooks = need<(c: string) => { primary: string | null; additional: string[] }>('getCharWorldbookNames');
  const rebindChar =
    need<(c: string, w: { primary: string | null; additional: string[] }) => Promise<void>>('rebindCharWorldbooks');
  const cur = getCharBooks('current');
  if (!cur.additional.includes(ARCHIVE_BOOK) && cur.primary !== ARCHIVE_BOOK) {
    await rebindChar('current', { primary: cur.primary, additional: [...cur.additional, ARCHIVE_BOOK] });
  }
  // $archive 记帐
  await updateVars(
    v => {
      const a = ((v as Record<string, unknown>).$archive ?? {}) as Record<string, ArchiveRecord>;
      for (const it of items)
        a[it.name] = {
          kind: it.kind,
          desc: it.desc ?? '',
          params: it.params ?? {},
          archivedAt: new Date().toISOString(),
        };
      (v as Record<string, unknown>).$archive = a;
      return v;
    },
    { type: 'chat' },
  );
  return items.map(it => `${it.kind}·${it.name}`);
}

/** 回溯孤儿处置：'restore' 返回快照供调用方 push 回 codex（承认正史，册保留）；'delete' 删书条目+除册（否认正史） */
export async function resolveOrphan(name: string, action: 'restore' | 'delete'): Promise<ArchiveRecord | null> {
  const arch = await readArchive();
  const rec = arch?.[name];
  if (!rec) throw new Error(`$archive 无「${name}」记录`);
  if (action === 'restore') return rec;
  const updateWb =
    need<(n: string, u: (es: WbEntryFull[]) => WbEntryFull[]) => Promise<unknown>>('updateWorldbookWith');
  await updateWb(ARCHIVE_BOOK, es => es.filter(e => !e.name.endsWith(`·${name}`))); // B2：后缀匹配，连改 kind 产生的幽灵条目一并删
  const updateVars =
    need<(u: (v: Record<string, unknown>) => Record<string, unknown>, o: { type: string }) => unknown>(
      'updateVariablesWith',
    );
  await updateVars(
    v => {
      _.unset(v, ['$archive', name]);
      return v;
    },
    { type: 'chat' },
  );
  return null;
}

/* ═══════════════ 世界书总开关（书单登记与批量启停）═══════════════
 * G4 语义翻新（驾驶员裁定铁律）：绑定角色卡 ≠ 启用。
 * 启用 = 加入全局启用列表（World Info Active）：判据 getGlobalWorldbookNames()，
 * 写入 rebindGlobalWorldbooks（全量替换语义，故必须“当前全局 ∪ 目标”去重保序，
 * 他卡/用户自有书原样保留）。getCharWorldbookNames 仅作资产归属记录，
 * 安装/卸载/归档的绑卡逻辑不在本辖区、保持不变。
 * 官方名单硬编码（发行内容同步维护）；DLC 书从 $dlc 注册表动态取。 */

export const OFFICIAL_BOOKS_VERSION = '1.0';
export const OFFICIAL_BOOKS = [
  '全域战略指挥系统',
  '剧情·北坡纪事',
  '北坡采药营地_基地布局',
  '机娘·能力档案',
  '特色科技·盟军',
  '武备·盟军',
  '通用·主建筑',
  '通用·防御辅助',
  '通用·人员',
  '通用·装备',
  '通用·工业基础',
  '通用·陆地载具',
  '通用·空中载具',
  '通用·水面舰艇',
];

export interface BookToggleState {
  name: string;
  group: '官方' | 'DLC' | '其他';
  imported: boolean;
  enabled: boolean;
  dlcId?: string;
}

/** 汇总书单三组状态（启用判据：全局启用列表）；预览/异常返回 null（降级） */
export async function readBookStates(): Promise<BookToggleState[] | null> {
  const getNames = tav<() => string[] | Promise<string[]>>('getWorldbookNames');
  const getGlobal = tav<() => string[]>('getGlobalWorldbookNames');
  const gv = tav<(o: { type: string }) => Record<string, unknown>>('getVariables');
  if (!getNames || !getGlobal || !gv) return null;
  try {
    const all = new Set(await getNames());
    // G4：“已启用”= 在全局启用列表（World Info Active），不再读角色卡绑定
    const enabledSet = new Set(getGlobal());
    const out: BookToggleState[] = [];
    const seen = new Set<string>();
    for (const n of OFFICIAL_BOOKS) {
      out.push({ name: n, group: '官方', imported: all.has(n), enabled: enabledSet.has(n) });
      seen.add(n);
    }
    const dlcReg = ((gv({ type: 'chat' }) ?? {}).$dlc ?? {}) as Record<string, { books?: string[] }>;
    for (const [id, rec] of Object.entries(dlcReg)) {
      for (const n of rec.books ?? []) {
        if (seen.has(n)) continue;
        out.push({ name: n, group: 'DLC', imported: all.has(n), enabled: enabledSet.has(n), dlcId: id });
        seen.add(n);
      }
    }
    // 其他：全局列表里清单外的书（他卡/用户自有）——展示但受 B1 管辖权保护
    for (const n of enabledSet) {
      if (!seen.has(n)) out.push({ name: n, group: '其他', imported: all.has(n), enabled: true });
    }
    return out;
  } catch {
    return null;
  }
}

/** R16 修复：从 $dlc.{id}.data 副本重放丢失的 codex 种子（删楼回滚至安装前楼层→种子随 message 变量丢失）。
 * 种子是安装器写的机器数据（非 AI 创作），从册重建语义安全。返回补写的名字 */
export async function replayCodexSeeds(
  id: string,
  existingNames: string[],
  pushCodex: (seeds: DlcCodexSeed[]) => void,
): Promise<string[]> {
  const gv = need<(o: { type: string }) => Record<string, unknown>>('getVariables');
  const parsed = parseDlcRegistry(gv({ type: 'chat' }).$dlc);
  const reg = parsed.registry?.records.get(id);
  if (parsed.error || !reg) {
    throw new Error(parsed.error ? `$dlc 注册表损坏：${parsed.error}` : `$dlc 注册表无 ${id}，无法重放种子`);
  }
  const have = new Set(existingNames);
  const missing = (reg.data.codex ?? []).filter(seed => !have.has(seed.name));
  if (missing.length) pushCodex(missing);
  return missing.map(s => s.name);
}

/** 应用启用名单（B1 管辖权原则平移到全局列表）：只增删 managedNames 内的书——
 * 全局启用列表里面板没见过的书（他卡/用户自有）原样保留；未导入的名字自动过滤。
 * 启用 = 写入全局启用列表：rebindGlobalWorldbooks 是全量替换语义，
 * 故写入前必须“保留书 + 目标书”去重保序；停用 = 从当前全局列表中移除目标。 */
export async function applyBookToggles(enabledNames: string[], managedNames: string[]): Promise<number> {
  const getNames = need<() => string[] | Promise<string[]>>('getWorldbookNames');
  const getGlobal = need<() => string[]>('getGlobalWorldbookNames');
  const rebindGlobal = need<(names: string[]) => Promise<void>>('rebindGlobalWorldbooks');
  const all = new Set(await getNames());
  const cur = getGlobal();
  const managed = new Set(managedNames);
  const keep = cur.filter(n => !managed.has(n)); // 管辖之外：保持原状（保序）
  const enabled = enabledNames.filter(n => all.has(n));
  const next = [...new Set([...keep, ...enabled])];
  await rebindGlobal(next);
  return enabled.length;
}
