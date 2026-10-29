import { computed, onMounted, ref } from 'vue';
import { RESEARCHES } from '../../core/catalog'; // base 层对照（体检需对比 base vs overlay，属合法特例）
import {
  applyBookToggles,
  archiveCodexEntries,
  bookNameFromFile,
  installDlc,
  installRawBooks,
  OFFICIAL_BOOKS,
  OFFICIAL_BOOKS_VERSION,
  parseManifest,
  precheckManifest,
  readBookStates,
  readUninstallPlan,
  renderDataCardEntry,
  replayCodexSeeds,
  resolveOrphan,
  sniffRawWorldbook,
  uninstallDlc,
  type BookToggleState,
  type DlcCodexTransaction,
  type DlcManifest,
  type InstallReceipt,
  type UninstallPlan,
} from '../../worldbook/dlcInstaller';
import type { QuarantineItem } from '../../parse/parsePipeline';
import { in_tavern, useDataStore } from '../../composables/store';
import {
  checkArchiveSync,
  checkEnv,
  checkLedger,
  checkVariables,
  checkWorldbooks,
  lintBookContent,
  readArchive,
  tav,
  type ArchiveRecord,
  type CheckIssue,
} from '../../parse/systemCheck';
import {
  addAlias,
  buildAuthority,
  checkParseQuarantine,
  clearQuarantine,
  loadAliases,
  loadQuarantine,
  parseState,
  refreshAuthorityBooks,
  removeAlias,
  retryFloor,
  runParseFor,
  submitFix,
  undoFloor,
  type ParseReport,
} from '../../composables/useParse';
import { dynamicCatalogSnapshot, useCatalogStore } from '../../composables/useCatalog';
import { fileAllPending, filerState, setAutoFile } from '../../composables/useGirlFiler';

export function usePanelSystem() {
  const store = useDataStore();
  const catalog = useCatalogStore();
  const overlays = computed(() => catalog.overlays);
  const env = checkEnv(in_tavern);

  const running = ref(false);
  const dlcCodexTransaction: DlcCodexTransaction = {
    read: () => JSON.parse(JSON.stringify(store.data.codex ?? [])),
    write: items => {
      store.data.codex = JSON.parse(JSON.stringify(items ?? [])) as typeof store.data.codex;
    },
  };
  const ran = ref(false);
  const varIssues = ref<CheckIssue[]>([]);
  const wbIssues = ref<CheckIssue[]>([]);
  const wbScanned = ref<string[]>([]);
  const ledgerIssues = ref<CheckIssue[]>([]);

  async function runCheck() {
    running.value = true;
    try {
      const baseResearches =
        RESEARCHES.length > 0
          ? RESEARCHES
          : (catalog.dynamicCatalog?.researches ?? dynamicCatalogSnapshot()?.researches ?? catalog.researches);
      varIssues.value = checkVariables({
        codex: store.data.codex,
        techDone: store.data.tech.done,
        overlays: catalog.overlays,
        baseResearches,
        mergedResearchNames: catalog.researches.map(r => r.name),
        bases: store.data.bases,
      });
      const wb = await checkWorldbooks();
      wbIssues.value = wb.issues;
      wbScanned.value = wb.scanned;
      ledgerIssues.value = [
        ...(await checkLedger(
          catalog.overlays,
          catalog.factionDefs.map(d => d.faction),
        )),
        ...(await checkArchiveSync(store.data.codex)), // R14 未归档 / R15 回溯孤儿
      ];
      ran.value = true;
    } finally {
      running.value = false;
    }
  }

  const counts = computed(() => {
    const all = [...varIssues.value, ...wbIssues.value, ...ledgerIssues.value];
    return {
      error: all.filter(i => i.level === 'error').length,
      warn: all.filter(i => i.level === 'warn').length,
      info: all.filter(i => i.level === 'info').length,
    };
  });
  const dims = computed(() => [
    {
      label: '变量',
      sub: `codex ${store.data.codex.length} 条 · 已研 ${store.data.tech.done.length} · 包 ${catalog.overlays.length}`,
      issues: varIssues.value,
    },
    {
      label: '世界书',
      sub: wbScanned.value.length ? `扫描 ${wbScanned.value.length} 本` : '不可用/未扫描',
      issues: wbIssues.value,
    },
    { label: '对账', sub: `注册表 ${catalog.overlays.length} 包`, issues: ledgerIssues.value },
  ]);

  function lvColor(level: string) {
    return level === 'error' ? 'var(--danger)' : level === 'warn' ? 'var(--warn)' : 'var(--t-faint)';
  }

  /* ── 导入流水线 ── */
  const importOpen = ref(false);
  const manifestText = ref('');
  const pickedFileName = ref('');

  /* 裸世界书队列（第二通道） */
  const rawBooks = ref<{ name: string; entryCount: number; json: string; issues: CheckIssue[] }[]>([]);
  const rawBind = ref(true);
  const rawBusy = ref(false);
  const rawError = ref('');
  const rawReceipt = ref<string[]>([]);
  const rawBindDone = ref(false);

  /** 多文件读取 → 逐个嗅探分流（万能口主路径，粘贴为备） */
  function loadFiles(files: FileList | undefined | null) {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = () => routeFile(f.name, String(reader.result ?? ''));
      reader.readAsText(f);
    }
  }

  /** 嗅探分流：裸 ST 世界书 → 直接导书队列（附 lint）；否则作 DLC manifest 走预检通道 */
  function routeFile(fileName: string, text: string) {
    const raw = sniffRawWorldbook(text);
    if (raw) {
      const name = bookNameFromFile(fileName);
      const entries = Object.values(raw.entries);
      const issues = entries.flatMap(e =>
        lintBookContent(name, String(e.comment ?? e.uid ?? '?'), String(e.content ?? '')),
      );
      const item = { name, entryCount: entries.length, json: text, issues };
      const i = rawBooks.value.findIndex(b => b.name === name);
      if (i >= 0) rawBooks.value[i] = item;
      else rawBooks.value.push(item);
      rawReceipt.value = [];
      rawError.value = '';
    } else {
      pickedFileName.value = fileName;
      manifestText.value = text;
      doPrecheck();
    }
  }
  function onFileChange(e: Event) {
    loadFiles((e.target as HTMLInputElement).files);
    (e.target as HTMLInputElement).value = ''; // 允许重选同一批文件
  }
  function onDrop(e: DragEvent) {
    loadFiles(e.dataTransfer?.files);
  }

  async function doInstallRaw() {
    if (!rawBooks.value.length) return;
    rawBusy.value = true;
    rawError.value = '';
    try {
      rawReceipt.value = await installRawBooks(
        rawBooks.value.map(b => ({ name: b.name, json: b.json, entryCount: b.entryCount })),
        rawBind.value,
      );
      rawBindDone.value = rawBind.value;
      rawBooks.value = [];
      ran.value = false; // 旧体检报告作废
      void refreshBooks(); // B7：导入改变书单/绑定，总开关区须刷新
    } catch (e) {
      rawError.value = e instanceof Error ? e.message : String(e);
    } finally {
      rawBusy.value = false;
    }
  }

  const parseError = ref('');
  const parsed = ref<DlcManifest | null>(null);
  const precheckIssues = ref<CheckIssue[]>([]);
  const precheckRan = ref(false);
  const installing = ref(false);
  const installError = ref('');
  const receipt = ref<InstallReceipt | null>(null);

  function doPrecheck() {
    parseError.value = '';
    parsed.value = null;
    precheckRan.value = false;
    receipt.value = null;
    installError.value = '';
    // 粘贴的是裸世界书（无文件名可取书名）→ 引导走文件通道
    if (sniffRawWorldbook(manifestText.value)) {
      parseError.value = '检测到 ST 原生世界书导出件（非 DLC 包）——请用「选择文件」或拖拽导入，书名将取自文件名';
      return;
    }
    const { manifest, error } = parseManifest(manifestText.value);
    if (error || !manifest) {
      parseError.value = error ?? '未知解析错误';
      return;
    }
    parsed.value = manifest;
    precheckIssues.value = precheckManifest(manifest, catalog.overlays);
    precheckRan.value = true;
  }

  const preCounts = computed(() => ({
    error: precheckIssues.value.filter(i => i.level === 'error').length,
    warn: precheckIssues.value.filter(i => i.level === 'warn').length,
    info: precheckIssues.value.filter(i => i.level === 'info').length,
  }));
  const takeoverEntryCount = computed(() =>
    (parsed.value?.patch?.takeover ?? []).reduce((n, t) => n + t.entries.length, 0),
  );
  /** 数据卡预览（与安装时同一渲染函数，确认门展示） */
  const dataCardPreview = computed(() => {
    if (!parsed.value) return null;
    const card = renderDataCardEntry(parsed.value);
    if (!card) return null;
    const book =
      ((parsed.value.worldbooks ?? []).find(wb => wb.name.startsWith('特色科技·')) ?? (parsed.value.worldbooks ?? [])[0])
        ?.name ?? '(无书)';
    return { book, keys: card.keys.length };
  });

  async function doInstall() {
    if (!parsed.value) return;
    installing.value = true;
    installError.value = '';
    try {
      receipt.value = await installDlc(parsed.value, dlcCodexTransaction, catalog.overlays);
      catalog.init(); // 重读 $dlc → overlay 即刻生效
      ran.value = false; // 旧体检报告作废
      void refreshBooks(); // B7：安装建了新书并绑卡
    } catch (e) {
      installError.value = e instanceof Error ? e.message : String(e);
    } finally {
      installing.value = false;
    }
  }

  /* ── 世界书总开关 ── */
  const bookStates = ref<BookToggleState[] | null>(null);
  const bookSel = ref(new Set<string>());
  const bookAdv = ref(false);
  const bookBusy = ref(false);
  const bookMsg = ref('');
  const bookErr = ref('');

  const bookGroups = computed(() => {
    const states = bookStates.value ?? [];
    const mk = (key: BookToggleState['group'], label: string) => {
      const list = states.filter(b => b.group === key);
      return {
        key,
        label,
        total: list.length,
        enabled: list.filter(b => b.enabled).length,
        missing: list.filter(b => !b.imported).length,
      };
    };
    const out = [mk('官方', `官方世界书 v${OFFICIAL_BOOKS_VERSION}`), mk('DLC', 'DLC 世界书')];
    if (states.some(b => b.group === '其他')) out.push(mk('其他', '其他已绑'));
    return out.filter(g => g.total > 0 || g.key === '官方');
  });

  async function refreshBooks() {
    bookMsg.value = '';
    bookErr.value = '';
    bookStates.value = await readBookStates(); // 预览 null → v-else 降级文案
    if (bookStates.value) bookSel.value = new Set(bookStates.value.filter(b => b.enabled).map(b => b.name));
  }

  async function applyNames(names: string[]) {
    bookBusy.value = true;
    bookMsg.value = '';
    bookErr.value = '';
    try {
      const n = await applyBookToggles(
        names,
        (bookStates.value ?? []).map(b => b.name),
      ); // B1：只调整面板见过的书，手工绑的原样保留
      await refreshBooks();
      bookMsg.value = `✓ 已应用：启用 ${n} 本`; // refresh 会清消息，须后设
    } catch (e) {
      bookErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      bookBusy.value = false;
    }
  }
  /** 普通勾选：对本组并集/差集，不动其他组 */
  function toggleGroup(key: BookToggleState['group'], on: boolean) {
    const states = bookStates.value ?? [];
    const cur = new Set(states.filter(b => b.enabled).map(b => b.name));
    for (const b of states.filter(b => b.group === key)) {
      if (on) cur.add(b.name);
      else cur.delete(b.name);
    }
    void applyNames([...cur]);
  }
  function selAll(on: boolean) {
    bookSel.value = on ? new Set((bookStates.value ?? []).filter(b => b.imported).map(b => b.name)) : new Set();
  }
  function selOnly(group: BookToggleState['group']) {
    bookSel.value = new Set((bookStates.value ?? []).filter(b => b.group === group && b.imported).map(b => b.name));
  }
  function toggleSel(name: string) {
    const s = new Set(bookSel.value);
    if (s.has(name)) s.delete(name);
    else s.add(name);
    bookSel.value = s;
  }
  function applySel() {
    void applyNames([...bookSel.value]);
  }

  /* ── 动态归档 ── */
  const archReady = ref(false);
  const archRegistry = ref<Record<string, ArchiveRecord>>({});
  const archOrphans = ref<string[]>([]);
  const archSel = ref(new Set<string>());
  const archBusy = ref(false);
  const archMsg = ref('');
  const archErr = ref('');
  /** 待归档候选：codex 非阵营注册且未入 $archive */
  const archCandidates = computed(() =>
    store.data.codex.filter(c => c.kind !== '阵营' && !(c.name in archRegistry.value)),
  );

  async function refreshArchive() {
    archMsg.value = '';
    archErr.value = '';
    const arch = await readArchive();
    if (arch === null) {
      archReady.value = false;
      return;
    }
    archRegistry.value = arch;
    const codexNames = new Set(store.data.codex.map(c => c.name));
    archOrphans.value = Object.keys(arch).filter(n => !codexNames.has(n));
    archReady.value = true;
  }
  function toggleArchSel(name: string) {
    const s = new Set(archSel.value);
    if (s.has(name)) s.delete(name);
    else s.add(name);
    archSel.value = s;
  }
  async function doArchive() {
    archBusy.value = true;
    archMsg.value = '';
    archErr.value = '';
    try {
      const items = store.data.codex.filter(c => archSel.value.has(c.name));
      const written = await archiveCodexEntries(items);
      archSel.value = new Set();
      await refreshArchive();
      void refreshBooks(); // B7：首次归档会建《EVA·动态档案》并绑卡
      archMsg.value = `✓ 已归档 ${written.length} 条：${written.join('、')}`; // refresh 会清消息，须后设
      ran.value = false; // 旧体检报告作废
    } catch (e) {
      archErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      archBusy.value = false;
    }
  }
  async function doOrphan(name: string, action: 'restore' | 'delete') {
    archBusy.value = true;
    archMsg.value = '';
    archErr.value = '';
    try {
      const rec = await resolveOrphan(name, action);
      if (action === 'restore' && rec) {
        if (!store.data.codex.some(c => c.name === name)) {
          store.data.codex.push({
            name,
            kind: rec.kind,
            desc: rec.desc,
            params: rec.params,
          } as (typeof store.data.codex)[number]);
        }
      }
      await refreshArchive();
      archMsg.value =
        action === 'restore' ? `✓ 已补录「${name}」回变量（正史条目保留）` : `✓ 已删除「${name}」正史条目并除册`; // refresh 会清消息，须后设
      ran.value = false; // 孤儿处置改变了对账状态，旧体检报告作废
    } catch (e) {
      archErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      archBusy.value = false;
    }
  }

  /* ── G1 · 导出存档到剪贴板（当前楼 stat_data → 导出包 JSON） ── */
  const expBusy = ref(false);
  const expMsg = ref('');
  const expErr = ref('');
  /** clipboard 失败降级：内联 textarea 供手动复制 */
  const expJson = ref('');

  function selectAllText(e: FocusEvent) {
    (e.target as HTMLTextAreaElement).select();
  }

  async function doExportSave() {
    expBusy.value = true;
    expMsg.value = '';
    expErr.value = '';
    expJson.value = '';
    try {
      const gv = tav<(o: { type: string; message_id?: number }) => Record<string, unknown> | undefined>('getVariables');
      const gcmi = tav<() => number>('getCurrentMessageId');
      if (!gv || !gcmi) {
        expErr.value = '仅酒馆内可导出（变量 API 不可用）';
        return;
      }
      const mid = gcmi();
      const statData = (gv({ type: 'message', message_id: mid }) ?? {})['stat_data'];
      if (statData === undefined) {
        expErr.value = '本楼无变量数据（stat_data 缺失）';
        return;
      }
      // 导出包线格式契约与启动器 importSave.parseSavePack 对齐
      const getChatName = tav<() => string>('getCurrentChatName');
      const pack = {
        version: 1,
        kind: 'redalert-save',
        exportedAt: new Date().toISOString(),
        source: { chat: getChatName ? getChatName() : '', message_id: mid },
        stat_data: statData,
      };
      const json = JSON.stringify(pack);
      try {
        await navigator.clipboard.writeText(json);
        expMsg.value = `✓ 已复制存档（${json.length} 字符，楼 #${mid}）`;
      } catch {
        // 降级：iframe 剪贴板权限受限时内联展示 JSON 供手动全选复制
        expJson.value = json;
        expErr.value = '剪贴板不可用——请点击下方文本框全选后手动复制';
      }
    } catch (e) {
      expErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      expBusy.value = false;
    }
  }

  onMounted(() => {
    void refreshBooks();
    void refreshArchive();
    void loadQuarantine().then(refreshParseR20); // 隔离区跨会话持久（$parse.quarantine），切 tab 重建组件时重读
    void refreshAliases(); // 别名词典条数展示（预览环境降级空）
  });

  /* ── 解析与修复（状态在 useParse 模块级 reactive，切 tab 不丢；这里只持 UI 局部态）── */
  const parse = parseState;
  const parseR20 = ref<CheckIssue[]>([]);
  const repOpen = ref<number | null>(null);
  const undoTarget = ref<number | null>(null);
  const fixKey = ref<string | null>(null);
  const fixText = ref('');
  const parseMsg = ref('');
  const parseErr = ref('');

  const quarantineFloors = computed(() =>
    Object.entries(parse.quarantine)
      .map(([mid, items]) => ({ mid: Number(mid), items }))
      .filter(f => Array.isArray(f.items) && f.items.length) // 防御：存量稀疏数组形态的 null 空洞
      .sort((a, b) => a.mid - b.mid),
  );
  const quarantineTotal = computed(() => quarantineFloors.value.reduce((n, f) => n + f.items.length, 0));

  function greens(r: ParseReport): number {
    return r.events.filter(e => e.light === '🟢').length;
  }
  function yellows(r: ParseReport): number {
    return r.events.filter(e => e.light === '🟡').length;
  }
  function fmtVal(v: unknown): string {
    if (v === undefined) return '—';
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  function wrapTag(q: QuarantineItem): string {
    return q.tag && ['战况', '图鉴', '初始状态'].includes(q.tag) ? q.tag : '战况';
  }

  async function refreshParseR20() {
    parseR20.value = await checkParseQuarantine();
  }

  /** 手动重解析当前楼（force 跳过幂等） */
  async function doReparse() {
    parseMsg.value = '';
    parseErr.value = '';
    try {
      const gcmi = tav<() => number>('getCurrentMessageId');
      if (!gcmi) {
        parseErr.value = '仅真机可用';
        return;
      }
      const outcome = await runParseFor(gcmi(), { force: true });
      parseMsg.value =
        outcome === 'parsed'
          ? '✓ 已重解析本楼'
          : `未解析（${outcome === 'not-ai' ? '本楼非 AI 楼/已隐藏，不产生快照' : outcome}）`;
      ran.value = false; // 入库改变变量状态，旧体检报告作废
      await refreshParseR20();
    } catch (e) {
      parseErr.value = e instanceof Error ? e.message : String(e);
    }
  }

  /** 隔离区出路①：重跑本楼（玩家先改消息原文，重跑天然吃到新内容） */
  async function doRetry(mid: number) {
    parseMsg.value = '';
    parseErr.value = '';
    try {
      const outcome = await retryFloor(mid);
      parseMsg.value = outcome === 'parsed' ? `✓ #${mid} 已重跑解析` : `重试结果：${outcome}`;
      ran.value = false;
      await refreshParseR20();
    } catch (e) {
      parseErr.value = e instanceof Error ? e.message : String(e);
    }
  }

  function openFix(mid: number, qi: number, q: QuarantineItem) {
    const key = `${mid}:${qi}`;
    if (fixKey.value === key) {
      fixKey.value = null;
      return;
    }
    fixKey.value = key;
    fixText.value = q.raw;
  }

  /** 隔离区出路②：编辑好的 YAML 走同管道重解析入库（不绕过校验） */
  async function doSubmitFix(mid: number, q: QuarantineItem) {
    parseMsg.value = '';
    parseErr.value = '';
    try {
      const res = await submitFix(mid, q, fixText.value);
      if (!res.ok) {
        parseErr.value = res.error;
        return;
      }
      fixKey.value = null;
      const nq = res.result.quarantine.length;
      parseMsg.value = nq ? `已提交，但仍有 ${nq} 项新隔离（见隔离区）` : `✓ #${mid} 修复已入库`;
      ran.value = false;
      await refreshParseR20();
    } catch (e) {
      parseErr.value = e instanceof Error ? e.message : String(e);
    }
  }

  /** 🟡入库撤销（二段确认后） */
  async function doUndo(r: ParseReport) {
    parseMsg.value = '';
    parseErr.value = '';
    try {
      const ok = await undoFloor(r);
      undoTarget.value = null;
      parseMsg.value = ok ? `✓ 已撤销 #${r.message_id} 的🟡入库` : '撤销不可用（仅真机且未撤销过）';
      ran.value = false;
      await refreshParseR20();
    } catch (e) {
      parseErr.value = e instanceof Error ? e.message : String(e);
    }
  }

  /** 清理指向已删楼层的隔离残留 */
  async function doClearQuarantine(mid: number) {
    parseMsg.value = '';
    parseErr.value = '';
    try {
      await clearQuarantine(mid);
      parseMsg.value = `✓ 已清理 #${mid} 隔离残留`;
      ran.value = false;
      await refreshParseR20();
    } catch (e) {
      parseErr.value = e instanceof Error ? e.message : String(e);
    }
  }

  /* ── 别名词典（批 C：实体对齐记忆，只从显式 UI 操作学）── */
  const aliasOpen = ref(false);
  const aliasMap = ref<Record<string, string>>({});
  const aliasVar = ref('');
  const aliasCanon = ref('');
  const aliasForce = ref(false);
  const aliasBusy = ref(false);
  const aliasMsg = ref('');
  const aliasErr = ref('');
  const aliasList = computed(() =>
    Object.entries(aliasMap.value).map(([variant, canonical]) => ({ variant, canonical })),
  );

  async function refreshAliases() {
    aliasMap.value = await loadAliases();
  }
  function toggleAliasOpen() {
    aliasOpen.value = !aliasOpen.value;
    if (aliasOpen.value) void refreshAliases();
  }

  /** 手动添加：权威名不存在时首次点击只 warn，二次点击强加 */
  async function doAddAlias() {
    aliasMsg.value = '';
    aliasErr.value = '';
    const v = aliasVar.value.trim();
    const c = aliasCanon.value.trim();
    if (!v || !c) return;
    aliasBusy.value = true;
    try {
      if (!aliasForce.value) {
        const auth = await buildAuthority();
        if (!auth.names.includes(c)) {
          aliasForce.value = true;
          aliasErr.value = `权威名单中未找到「${c}」——确认无误可再次点击强制添加`;
          return;
        }
      }
      const ok = await addAlias(v, c);
      if (!ok) {
        aliasErr.value = '仅真机可用';
        return;
      }
      await refreshAliases();
      aliasMsg.value = `✓ 已添加别名「${v}」→「${c}」`;
      aliasVar.value = '';
      aliasCanon.value = '';
      aliasForce.value = false;
    } catch (e) {
      aliasErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      aliasBusy.value = false;
    }
  }

  async function doRemoveAlias(variant: string) {
    aliasMsg.value = '';
    aliasErr.value = '';
    aliasBusy.value = true;
    try {
      await removeAlias(variant);
      await refreshAliases();
      aliasMsg.value = `✓ 已删除别名「${variant}」`;
    } catch (e) {
      aliasErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      aliasBusy.value = false;
    }
  }

  /** R19 低置信对齐 → 一键固化进词典 */
  async function doLearnAlias(a: { from: string; to: string }) {
    aliasMsg.value = '';
    aliasErr.value = '';
    aliasBusy.value = true;
    try {
      const ok = await addAlias(a.from, a.to);
      if (!ok) {
        aliasErr.value = '仅真机可用';
        return;
      }
      await refreshAliases();
      aliasOpen.value = true;
      aliasMsg.value = `✓ 已记为别名「${a.from}」→「${a.to}」，下次解析🟢直达`;
    } catch (e) {
      aliasErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      aliasBusy.value = false;
    }
  }

  async function doRefreshBooks() {
    aliasMsg.value = '';
    aliasErr.value = '';
    aliasBusy.value = true;
    try {
      const names = await refreshAuthorityBooks();
      aliasMsg.value = `✓ 世界书条目名缓存已刷新（${names.length} 条）`;
    } catch (e) {
      aliasErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      aliasBusy.value = false;
    }
  }

  /* ── R16 种子重放（删楼回滚后 DLC codex 种子丢失的一键修复）── */
  const seedBusy = ref(false);
  const seedErr = ref('');
  function seedMissingOf(o: (typeof catalog.overlays)[number]): string[] {
    const seeds = (o as { codexSeeds?: string[] }).codexSeeds ?? [];
    return seeds.filter(s => !store.data.codex.some(c => c.name === s));
  }
  async function doReplaySeeds(id: string) {
    seedBusy.value = true;
    seedErr.value = '';
    try {
      const replayed = await replayCodexSeeds(
        id,
        store.data.codex.map(c => c.name),
        seeds => {
          for (const s of seeds) {
            if (!store.data.codex.some(c => c.name === s.name))
              store.data.codex.push(s as (typeof store.data.codex)[number]);
          }
        },
      );
      if (!replayed.length) seedErr.value = '注册表无可重建的种子数据（早期安装包且非阵营种子）——可卸载重装修复';
      ran.value = false; // 旧体检报告作废
    } catch (e) {
      seedErr.value = e instanceof Error ? e.message : String(e);
    } finally {
      seedBusy.value = false;
    }
  }

  /* ── 卸载确认门 ── */
  const uninstallTarget = ref<string | null>(null);
  const uninstallPlan = ref<UninstallPlan | null>(null);
  const uninstalling = ref(false);
  const uninstallError = ref('');

  function askUninstall(id: string) {
    uninstallTarget.value = uninstallTarget.value === id ? null : id;
    uninstallPlan.value = uninstallTarget.value ? readUninstallPlan(id) : null;
    uninstallError.value = '';
  }

  async function doUninstall(id: string) {
    uninstalling.value = true;
    uninstallError.value = '';
    try {
      await uninstallDlc(id, dlcCodexTransaction);
      uninstallTarget.value = null;
      catalog.init();
      ran.value = false;
      void refreshBooks(); // B7：卸载删书解绑
    } catch (e) {
      uninstallError.value = e instanceof Error ? e.message : String(e);
    } finally {
      uninstalling.value = false;
    }
  }

  return {
    OFFICIAL_BOOKS,
    OFFICIAL_BOOKS_VERSION,
    aliasBusy,
    aliasCanon,
    aliasErr,
    aliasForce,
    aliasList,
    aliasMap,
    aliasMsg,
    aliasOpen,
    aliasVar,
    applySel,
    archBusy,
    archCandidates,
    archErr,
    archMsg,
    archOrphans,
    archReady,
    archSel,
    askUninstall,
    bookAdv,
    bookBusy,
    bookErr,
    bookGroups,
    bookMsg,
    bookSel,
    bookStates,
    counts,
    dataCardPreview,
    dims,
    doAddAlias,
    doArchive,
    doClearQuarantine,
    doExportSave,
    doInstall,
    doInstallRaw,
    doLearnAlias,
    doOrphan,
    doPrecheck,
    doRefreshBooks,
    doRemoveAlias,
    doReparse,
    doReplaySeeds,
    doRetry,
    doSubmitFix,
    doUndo,
    doUninstall,
    env,
    expBusy,
    expErr,
    expJson,
    expMsg,
    fileAllPending,
    filerState,
    fixKey,
    fixText,
    fmtVal,
    greens,
    importOpen,
    installError,
    installing,
    lvColor,
    manifestText,
    onDrop,
    onFileChange,
    openFix,
    overlays,
    parse,
    parseErr,
    parseError,
    parseMsg,
    parseR20,
    parsed,
    pickedFileName,
    preCounts,
    precheckIssues,
    precheckRan,
    quarantineFloors,
    quarantineTotal,
    ran,
    rawBind,
    rawBindDone,
    rawBooks,
    rawBusy,
    rawError,
    rawReceipt,
    receipt,
    refreshArchive,
    refreshBooks,
    repOpen,
    runCheck,
    running,
    seedBusy,
    seedErr,
    seedMissingOf,
    selAll,
    selOnly,
    selectAllText,
    setAutoFile,
    store,
    takeoverEntryCount,
    toggleAliasOpen,
    toggleArchSel,
    toggleGroup,
    toggleSel,
    undoTarget,
    uninstallError,
    uninstallPlan,
    uninstallTarget,
    uninstalling,
    wrapTag,
    yellows,
  };
}
