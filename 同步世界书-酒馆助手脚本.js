/**
 * 同步世界书-酒馆助手脚本.js —— 把仓库 worldbooks/ 同步进酒馆，支持实时推送（配套 世界书同步服务.mjs）
 *
 * 安装（一次性）：
 *   1. 本机先起同步服务：在仓库目录运行  node 世界书同步服务.mjs  （默认端口 5510，支持 env.yaml 配置）
 *      启动日志会打印书目录自检与内网访问地址；浏览器访问 http://localhost:5510/ 可看状态页。
 *   2. 酒馆 → 扩展「酒馆助手」→ 脚本库 → 全局 → 新建脚本，
 *      把本文件【全部内容】粘进脚本内容框，保存。
 *   3. 启用脚本：加载时自动做一次全量同步，然后保持实时事件流（SSE）在线——
 *      你在仓库里改/增世界书文件，保存后约 0.5~1 秒自动推送到酒馆，无需任何操作。
 *   4. （可选）在脚本编辑界面给脚本添加一个名为「同步世界书」的按钮，可手动全量重同步。
 *
 * 内网与目标网址配置（可选）：
 *   - 自动推断：内网通过 http://192.168.x.x:8000 访问酒馆时，脚本会自动跟随当前页面 Host 连接同机 5510 端口；
 *   - 静态配置：在仓库根目录 env.yaml 中填写 sync.url 或在下方修改 PRESET_SYNC_BASE；
 *   - 运行时切换：在浏览器控制台（F12）运行 setWorldbookSyncBase('http://你的内网IP:端口') 立即生效并持久化；
 *   - 恢复默认：在控制台运行 resetWorldbookSyncBase()。
 *
 * 覆盖语义（重要红线）：
 *   - 酒馆内与仓库【同名】的世界书会被仓库版本【整本覆盖】——仓库是唯一事实源；
 *   - 不删除酒馆里的任何世界书；仓库删掉的书在酒馆里会残留（控制台会提醒，可手动删）；
 *   - 在酒馆世界书编辑器里对同名书的手动改动，下次同步（含实时推送）会被冲掉，请改仓库源文件。
 *
 * 实时机制：
 *   - EventSource 连接服务的 /events（断线浏览器自动重连）；
 *   - 服务端检测到文件变更（500ms 防抖）推送 {added, changed, removed}，此处只增量拉取变更的书；
 *   - 重连/服务重启导致错过事件时（revision 对不上），自动做一次全量同步兜底，保证不漏。
 *
 * 日志：浏览器控制台（F12）过滤「世界书同步」。
 */

// ---------- 目标网址解析与配置 ----------

const PRESET_SYNC_BASE = ''; // 可预置目标网址（若为空则自动推断；启动服务时会自动与 env.yaml 对齐）
const PRESET_PORT = 5510;    // 默认同步服务端口（与 env.yaml 对齐）

function resolveSyncBase() {
  // 1. 优先读取 localStorage 自定义覆盖
  try {
    const custom = (globalThis.localStorage?.getItem('ST_WORLDBOOK_SYNC_URL') || globalThis.__ST_WORLDBOOK_SYNC_URL__ || '').trim();
    if (custom) return custom.replace(/\/+$/, '');
  } catch {
    /* 忽略存储访问限制 */
  }

  // 2. 预置目标网址
  if (PRESET_SYNC_BASE && typeof PRESET_SYNC_BASE === 'string' && PRESET_SYNC_BASE.trim()) {
    return PRESET_SYNC_BASE.trim().replace(/\/+$/, '');
  }

  // 3. 智能推断：浏览器环境中根据当前页面的 host 动态组装（内网访问酒馆时自动使用同机内网端口）
  if (typeof location !== 'undefined' && location.hostname) {
    const protocol = location.protocol === 'https:' ? 'https:' : 'http:';
    const host = location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return `http://127.0.0.1:${PRESET_PORT}`;
    }
    return `${protocol}//${host}:${PRESET_PORT}`;
  }

  // 4. 兜底
  return `http://127.0.0.1:${PRESET_PORT}`;
}

let SYNC_BASE = resolveSyncBase();

// 挂载全局控制台调试方法
if (typeof window !== 'undefined') {
  window.setWorldbookSyncBase = function (url) {
    if (!url || typeof url !== 'string') {
      console.warn('[世界书同步] 请传入有效的目标网址，例如: setWorldbookSyncBase("http://192.168.0.2:5510")');
      return;
    }
    const cleanUrl = url.trim().replace(/\/+$/, '');
    try {
      localStorage.setItem('ST_WORLDBOOK_SYNC_URL', cleanUrl);
    } catch { /* 忽略 */ }
    SYNC_BASE = cleanUrl;
    console.log(`[世界书同步] 目标网址已切换为: ${SYNC_BASE}（已存入 localStorage，刷新保持有效）`);
    if (globalThis.toastr?.info) globalThis.toastr.info(`同步目标已切换为: ${SYNC_BASE}`);
    try { esClient?.close(); } catch { /* 忽略 */ }
    enqueue('切换目标后全量对齐', syncWorldbooks);
    watchEvents();
  };

  window.resetWorldbookSyncBase = function () {
    try {
      localStorage.removeItem('ST_WORLDBOOK_SYNC_URL');
    } catch { /* 忽略 */ }
    delete globalThis.__ST_WORLDBOOK_SYNC_URL__;
    SYNC_BASE = resolveSyncBase();
    console.log(`[世界书同步] 已恢复默认目标网址: ${SYNC_BASE}`);
    if (globalThis.toastr?.info) globalThis.toastr.info(`已恢复默认目标网址: ${SYNC_BASE}`);
    try { esClient?.close(); } catch { /* 忽略 */ }
    enqueue('恢复默认后全量对齐', syncWorldbooks);
    watchEvents();
  };

  window.getWorldbookSyncBase = function () {
    console.log(`[世界书同步] 当前目标网址: ${SYNC_BASE}`);
    return SYNC_BASE;
  };
}

// ---------- 串行队列：全量/增量同步不并发执行（对同一本书并发写没有意义） ----------

let chain = Promise.resolve();

function enqueue(label, fn) {
  chain = chain
    .then(fn)
    .catch((e) => console.error(`[世界书同步] ${label}失败：`, e?.message ?? e));
  return chain;
}

// ---------- 同步逻辑 ----------

async function syncWorldbooks() {
  const t0 = Date.now();
  console.log(`[世界书同步] 拉取 ${SYNC_BASE}/all ...`);

  if (typeof createOrReplaceWorldbook !== 'function') {
    throw new Error('当前环境没有 createOrReplaceWorldbook（请确认脚本运行在酒馆助手脚本库中）');
  }

  let res;
  try {
    res = await fetch(`${SYNC_BASE}/all`, { cache: 'no-store' });
  } catch (netErr) {
    const diagMsg =
      `无法连接同步服务 [${SYNC_BASE}]（${netErr?.message || netErr}）。\n` +
      `排查建议：\n` +
      `  1. 确认服务已启动：在仓库根目录执行 node 世界书同步服务.mjs\n` +
      `  2. 若服务在其他内网端口/IP，可在控制台运行: setWorldbookSyncBase("http://你的内网IP:端口")\n` +
      `  3. 或检查仓库根目录 env.yaml 中的配置`;
    console.error(`[世界书同步] ${diagMsg}`);
    throw new Error(`连接失败 [${SYNC_BASE}]（网络不可达或服务未起）`);
  }

  if (!res.ok) {
    throw new Error(`拉取失败 HTTP ${res.status}（当前连接: ${SYNC_BASE}，请确认服务已启动）`);
  }

  const payload = await res.json();
  const books = payload.books ?? [];
  if (books.length === 0) throw new Error('服务返回 0 本书（worldbooks/ 目录为空或全部未通过自检）');

  console.log(`[世界书同步] 服务端 ${payload.bookCount} 本 / ${payload.totalEntries} 条，开始写入...`);
  for (const w of payload.warnings ?? []) console.warn(`[世界书同步] 服务端警告：${w}`);

  let created = 0;
  let replaced = 0;
  let failed = 0;
  for (const book of books) {
    try {
      // true=新建，false=覆盖同名（依据酒馆助手 createOrReplaceWorldbook 返回值语义）
      const isNew = await createOrReplaceWorldbook(book.name, book.entries);
      if (isNew) created++;
      else replaced++;
      console.log(`[世界书同步] ${isNew ? '新建' : '覆盖'} ${book.name}（${book.count} 条）`);
    } catch (e) {
      failed++;
      console.error(`[世界书同步] 失败 ${book.name}：`, e?.message ?? e);
    }
  }

  const ms = Date.now() - t0;
  const summary = `世界书同步完成：新建 ${created}，覆盖 ${replaced}，失败 ${failed}（${books.length} 本 / ${payload.totalEntries} 条 / ${ms}ms）`;
  console.log(`[世界书同步] ${summary}`);
  if (failed > 0) globalThis.toastr?.warning?.(summary);
  else globalThis.toastr?.success?.(summary);
  return { created, replaced, failed };
}

// ---------- 实时增量：只拉取变更的书 ----------

async function fetchBooks(names) {
  const params = new URLSearchParams();
  for (const n of names) params.append('name', n);
  const res = await fetch(`${SYNC_BASE}/books?${params.toString()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`拉取变更书失败 HTTP ${res.status}（来源: ${SYNC_BASE}）`);
  return (await res.json()).books ?? [];
}

async function applyChanges(names, removed) {
  const t0 = Date.now();
  let wrote = 0;
  let failed = 0;
  for (const book of await fetchBooks(names)) {
    try {
      await createOrReplaceWorldbook(book.name, book.entries);
      wrote++;
      console.log(`[世界书同步] 实时更新 ${book.name}（${book.count} 条）`);
    } catch (e) {
      failed++;
      console.error(`[世界书同步] 实时更新失败 ${book.name}：`, e?.message ?? e);
    }
  }
  for (const n of removed) console.warn(`[世界书同步] 仓库已删除「${n}」——酒馆内同名书不会自动删，请手动处理`);
  if (wrote > 0 || failed > 0 || removed.length > 0) {
    const msg = `实时同步：更新 ${wrote} 本${failed > 0 ? `，失败 ${failed} 本` : ''}（${Date.now() - t0}ms）`;
    if (failed > 0) globalThis.toastr?.warning?.(msg);
    else globalThis.toastr?.success?.(msg);
  }
}

// ---------- 实时事件流（SSE） ----------

let lastRevision = null;
let esClient = null;

function watchEvents() {
  if (typeof EventSource !== 'function') {
    console.warn('[世界书同步] 当前环境不支持 EventSource，实时推送不可用（手动全量同步仍可用）');
    return;
  }
  try {
    if (esClient) esClient.close();
  } catch { /* 忽略 */ }

  const es = new EventSource(`${SYNC_BASE}/events`);
  esClient = es;

  es.addEventListener('hello', (ev) => {
    const { revision } = JSON.parse(ev.data);
    if (lastRevision !== null && revision !== lastRevision) {
      // 断线重连或服务重启导致错过变更 → 全量对齐兜底
      console.log(`[世界书同步] 检测到错过变更（本地 r${lastRevision} → 服务端 r${revision}），自动全量对齐`);
      enqueue('全量对齐', syncWorldbooks);
    }
    lastRevision = revision;
  });
  es.addEventListener('sync', (ev) => {
    const { revision, added, changed, removed } = JSON.parse(ev.data);
    lastRevision = revision;
    const names = [...new Set([...(added ?? []), ...(changed ?? [])])];
    console.log(`[世界书同步] 收到变更推送 r${revision}：新增 ${(added ?? []).length}，修改 ${(changed ?? []).length}，移除 ${(removed ?? []).length}`);
    if (names.length > 0 || (removed ?? []).length > 0) {
      enqueue('增量同步', () => applyChanges(names, removed ?? []));
    }
  });
  es.onerror = () => console.warn(`[世界书同步] 事件流断开（目标: ${SYNC_BASE}），浏览器将自动重连`);
  console.log(`[世界书同步] 已连接实时事件流（${SYNC_BASE}/events），等待 worldbooks/ 变更推送`);
}

// ---------- 启动 ----------

enqueue('初始全量同步', syncWorldbooks);
watchEvents();

// 可选按钮触发：在脚本编辑界面添加名为「同步世界书」的按钮后生效；未配置按钮时静默跳过
try {
  eventOn(getButtonEvent('同步世界书'), () => {
    enqueue('按钮全量同步', syncWorldbooks);
  });
  console.log('[世界书同步] 已挂载按钮「同步世界书」');
} catch {
  /* 未配置同名按钮，忽略 */
}
