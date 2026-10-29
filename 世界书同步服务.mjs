#!/usr/bin/env node
/**
 * 世界书同步服务.mjs —— 本地只读世界书分发服务（供酒馆助手脚本拉取，支持实时推送）
 *
 * 用途：
 *   把本仓库 worldbooks/ 目录下的独立世界书 JSON（ST「世界书编辑器」导出格式
 *   { "entries": { "0": {...} } }）实时转换为「酒馆助手」TavernHelper 的
 *   WorldbookEntry[] 格式，通过带 CORS 头的 HTTP 接口供酒馆内脚本拉取，
 *   再由 createOrReplaceWorldbook 写入酒馆内部世界书库；
 *   同时监听 worldbooks/ 文件变更，经 SSE 实时推送给酒馆端做增量同步。
 *   配套脚本：同步世界书-酒馆助手脚本.js（粘贴进酒馆助手「脚本库」使用）。
 *
 * 用法：
 *   node 世界书同步服务.mjs [端口]      默认端口 5510（避开 起服CORS.mjs 的 5500）
 *
 * 端点：
 *   GET /             状态页（书目录一览 + 自检警告 + 实时推送状态）
 *   GET /manifest     书清单 [{name, file, count}]，不含正文
 *   GET /all          全部书 [{name, count, entries}]，条目已转换为酒馆助手格式（同步脚本首次全量用这个）
 *   GET /books        增量端点：?name=书名&name=…（URL 编码），只返回点名的书（已转换格式）
 *   GET /events       SSE 实时事件流：hello（当前 revision）+ sync（added/changed/removed 清单）
 *   其余路径          静态文件（与 起服CORS.mjs 相同，根目录 = 仓库根）
 *
 * 行为与边界：
 *   - 每次请求都重新扫描 worldbooks/，改完文件无需重启服务；
 *   - 书名 = 文件名剥 .json 再剥结尾「_世界书」后缀（工程·盟军_世界书.json → 工程·盟军）；
 *   - 只读仓库文件，绝不写入、绝不删除；酒馆端同名世界书会被仓库版本整本覆盖（覆盖语义见配套脚本头注释）；
 *   - 实时推送：fs.watch 监听 worldbooks/（stat 指纹 diff 定位变更 + 500ms 防抖 + 10s 兜底轮询，
 *     fs.watch 不可用时降级 2s 轮询），变更经 /events SSE 推给酒馆端，酒馆端只增量同步变更的书；
 *     酒馆端断线重连或服务重启导致错过事件时，由 revision 对比触发全量对齐，保证不漏；
 *   - 仓库删除文件只推送 removed 提醒，不删除酒馆内任何世界书（红线不变）；
 *   - 结构自检：JSON 损坏 / 非独立世界书格式 / entries 键≠String(uid) / 重复 uid / 书名冲突
 *     均只告警不中断（返回体的 warnings 字段与启动日志可见）。
 *
 * 字段映射依据：JS-Slash-Runner main 分支 src/function/worldbook.ts
 *   （toWorldbookEntry / fromWorldbookEntry 双向转换，implicit keys 以顶层字段携带）。
 * 免责边界：本脚本只做格式转换与分发，不做真机行为验证；真机验收流程见 NEXT.md 交接段。
 */
import { createServer } from 'node:http';
import { watch } from 'node:fs';
import { stat, readFile, readdir } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig, syncScriptPreset } from './scripts/load-env.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const WORLDBOOKS_DIR = join(ROOT, 'worldbooks');
const envConfig = loadEnvConfig(ROOT);
syncScriptPreset(ROOT);
const PORT = Number(process.argv[2]) || envConfig.sync.port || 5510;
const HOST = process.env.HOST || envConfig.host || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

// ---------- ST 原生条目 → 酒馆助手 WorldbookEntry 转换 ----------

const POSITION_TYPE = [
  'before_character_definition', // 0 Before Char Defs
  'after_character_definition',  // 1 After Char Defs
  'before_author_note',          // 2 Top of Author's Note
  'after_author_note',           // 3 Bottom of Author's Note
  'at_depth',                    // 4 @ Depth
  'before_example_messages',     // 5 Before Example Messages
  'after_example_messages',      // 6 After Example Messages
  'outlet',                      // 7 Outlet
];
const LOGIC = ['and_any', 'not_all', 'not_any', 'and_all']; // ST selectiveLogic 0..3
const ROLE = ['system', 'user', 'assistant'];                // ST role 0..2

// 酒馆助手 _ImplicitKeys：以顶层字段携带，其 fromWorldbookEntry 会 _.pick 还原为 ST 原生字段
const IMPLICIT_KEYS = [
  'addMemo', 'matchPersonaDescription', 'matchCharacterDescription',
  'matchCharacterPersonality', 'matchCharacterDepthPrompt', 'matchScenario',
  'matchCreatorNotes', 'group', 'groupOverride', 'groupWeight',
  'caseSensitive', 'matchWholeWords', 'useGroupScoring', 'automationId',
  'ignoreBudget', 'outletName', 'triggers', 'characterFilter',
];

function convertEntry(src) {
  const out = {
    uid: typeof src.uid === 'number' ? src.uid : 0,
    name: src.comment ?? '',
    enabled: !src.disable,
    strategy: {
      type: src.constant ? 'constant' : src.vectorized ? 'vectorized' : 'selective',
      keys: Array.isArray(src.key) ? src.key.slice() : [],
      keys_secondary: {
        logic: LOGIC[src.selectiveLogic] ?? 'and_any',
        keys: Array.isArray(src.keysecondary) ? src.keysecondary.slice() : [],
      },
      scan_depth: typeof src.scanDepth === 'number' && src.scanDepth > 0 ? src.scanDepth : 'same_as_global',
    },
    position: {
      type: POSITION_TYPE[src.position] ?? 'at_depth',
      role: ROLE[src.role ?? 0] ?? 'system',
      depth: typeof src.depth === 'number' ? src.depth : 4,
      order: typeof src.order === 'number' ? src.order : 100,
    },
    content: src.content ?? '',
    // ST 语义：useProbability=false 表示忽略概率恒激活，等价于 100%
    probability: src.useProbability === false ? 100 : (typeof src.probability === 'number' ? src.probability : 100),
    recursion: {
      prevent_incoming: !!src.excludeRecursion,
      prevent_outgoing: !!src.preventRecursion,
      delay_until: typeof src.delayUntilRecursion === 'number' && src.delayUntilRecursion > 0 ? src.delayUntilRecursion : null,
    },
    effect: {
      sticky: typeof src.sticky === 'number' && src.sticky > 0 ? src.sticky : null,
      cooldown: typeof src.cooldown === 'number' && src.cooldown > 0 ? src.cooldown : null,
      delay: typeof src.delay === 'number' && src.delay > 0 ? src.delay : null,
    },
  };
  for (const k of IMPLICIT_KEYS) if (src[k] !== undefined) out[k] = src[k];
  return out;
}

// ---------- 读取 worldbooks/ 并装配 ----------

function bookNameFromFile(file) {
  return file.replace(/\.json$/i, '').replace(/_世界书$/, '');
}

async function loadBooks() {
  const warnings = [];
  let files = [];
  try {
    files = (await readdir(WORLDBOOKS_DIR))
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort((a, b) => a.localeCompare(b, 'zh'));
  } catch (e) {
    return { books: [], warnings: [`无法读取 worldbooks/ 目录：${e.message}`] };
  }

  const books = [];
  const seenNames = new Map();
  for (const file of files) {
    let raw;
    try {
      raw = await readFile(join(WORLDBOOKS_DIR, file), 'utf8');
    } catch (e) {
      warnings.push(`${file}：读取失败 ${e.message}`);
      continue;
    }
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 容忍 BOM
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      warnings.push(`${file}：JSON 解析失败 ${e.message}`);
      continue;
    }
    if (!data || typeof data !== 'object' || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) {
      warnings.push(`${file}：不是独立世界书格式（期望顶层 { "entries": {...} }），已跳过`);
      continue;
    }

    const name = bookNameFromFile(file);
    if (seenNames.has(name)) {
      warnings.push(`书名冲突：${file} 与 ${seenNames.get(name)} 剥后缀后同名「${name}」，${file} 已跳过`);
      continue;
    }
    seenNames.set(name, file);

    const entryObjs = Object.entries(data.entries).filter(([, v]) => v && typeof v === 'object');

    // entries 键应等于 String(uid)（ST 编辑器按此索引，不一致会导致编辑器里不显示）
    const mismatch = entryObjs.filter(([k, v]) => k !== String(v.uid)).length;
    if (mismatch > 0) warnings.push(`${file}：${mismatch} 条 entries 键≠String(uid)（同步不受影响，但建议修复源文件）`);

    // 编辑器显示顺序 = displayIndex（缺失退回 uid）
    const sorted = entryObjs.map(([, v]) => v).sort((a, b) => (a.displayIndex ?? a.uid ?? 0) - (b.displayIndex ?? b.uid ?? 0));

    const uids = new Set();
    let dup = 0;
    for (const v of sorted) {
      const u = typeof v.uid === 'number' ? v.uid : 0;
      if (uids.has(u)) dup++;
      else uids.add(u);
    }
    if (dup > 0) warnings.push(`${file}：${dup} 个重复 uid（酒馆助手侧会自动改派 uid，不影响条目内容与顺序）`);

    books.push({ name, file, count: sorted.length, entries: sorted.map(convertEntry) });
  }
  return { books, warnings };
}

// ---------- 文件监听与实时推送（SSE） ----------

let revision = 0; // 每检测到一批变更 +1，服务重启归零（酒馆端以此判断是否错过事件）
let fileSnapshot = new Map(); // file -> "mtimeMs|size" 指纹
const sseClients = new Set(); // /events 长连接客户端（可多个酒馆标签页）
let scanTimer = null; // 防抖定时器

async function statSnapshot() {
  const map = new Map();
  try {
    const files = (await readdir(WORLDBOOKS_DIR)).filter((f) => f.toLowerCase().endsWith('.json'));
    for (const f of files) {
      const st = await stat(join(WORLDBOOKS_DIR, f)).catch(() => null);
      if (st) map.set(f, `${st.mtimeMs}|${st.size}`);
    }
  } catch {
    // 目录不可读：loadBooks 已有警告，这里保持空快照即可
  }
  return map;
}

function diffSnapshot(prev, next) {
  const added = [];
  const changed = [];
  const removed = [];
  for (const [f, fp] of next) {
    if (!prev.has(f)) added.push(f);
    else if (prev.get(f) !== fp) changed.push(f);
  }
  for (const f of prev.keys()) if (!next.has(f)) removed.push(f);
  return { added, changed, removed };
}

function broadcast(eventName, obj) {
  const frame = `event: ${eventName}\nid: ${obj.revision}\ndata: ${JSON.stringify(obj)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(frame);
    } catch {
      // 连接已断，交由 close 事件清理
    }
  }
}

function scheduleScan(reason) {
  if (scanTimer) return; // 防抖 500ms：编辑器保存/批量脚本往往连发多个事件
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scan(reason);
  }, 500);
}

async function scan(reason) {
  const next = await statSnapshot();
  const { added, changed, removed } = diffSnapshot(fileSnapshot, next);
  fileSnapshot = next;
  if (added.length + changed.length + removed.length === 0) return;
  revision += 1;
  const payload = {
    revision,
    reason,
    added: added.map(bookNameFromFile),
    changed: changed.map(bookNameFromFile),
    removed: removed.map(bookNameFromFile),
  };
  console.log(
    `[世界书同步] 变更 r${revision}（${reason}）：新增「${payload.added.join('、') || '无'}」` +
      `修改「${payload.changed.join('、') || '无'}」移除「${payload.removed.join('、') || '无'}」→ 推送 ${sseClients.size} 个客户端`,
  );
  broadcast('sync', payload);
}

async function startWatching() {
  fileSnapshot = await statSnapshot();
  // 主监听：目录级 fs.watch。忽略回调 filename（部分平台中文文件名回调有编码问题），
  // 一律全量 stat 指纹 diff 定位变更文件。
  try {
    const w = watch(WORLDBOOKS_DIR, () => scheduleScan('watch'));
    w.on('error', (e) => {
      console.warn(`[世界书同步] fs.watch 异常（${e.message}），降级为 2 秒轮询`);
      try {
        w.close();
      } catch { /* 已关闭 */ }
      setInterval(() => scheduleScan('poll'), 2000);
    });
  } catch (e) {
    console.warn(`[世界书同步] fs.watch 不可用（${e.message}），降级为 2 秒轮询`);
    setInterval(() => scheduleScan('poll'), 2000);
  }
  // 低频兜底轮询：覆盖极个别 watch 漏事件场景（网络盘/特殊编辑器保存方式）
  setInterval(() => scheduleScan('poll-fallback'), 10_000);
}

// ---------- 状态页 ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function statusPage({ books, warnings, totalEntries }) {
  const rows = books
    .map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(b.file)}</td><td style="text-align:right">${b.count}</td></tr>`)
    .join('\n');
  const warns = warnings.length
    ? `<h2>自检警告（${warnings.length}）</h2><ul>${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
    : '<p>自检：无警告 ✔</p>';
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>世界书同步服务</title>
<style>body{font-family:system-ui,sans-serif;max-width:880px;margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}code{background:#f4f4f4;padding:2px 6px}h2{margin-bottom:4px}</style>
</head><body>
<h1>世界书同步服务</h1>
<p>共 <b>${books.length}</b> 本 / <b>${totalEntries}</b> 条 · 每次请求实时重扫 worldbooks/</p>
<p>同步脚本拉取地址：<code>http://127.0.0.1:${PORT}/all</code>${envConfig.lanIps.length ? ` ｜ 内网：<code>http://${envConfig.primaryLanIp}:${PORT}/all</code>` : ''} ｜ 清单：<code>/manifest</code> ｜ 增量：<code>/books?name=书名</code></p>
<p>实时推送：SSE <code>/events</code> 当前 <code>r${revision}</code> · 在线客户端 ${sseClients.size} 个</p>
<h2>书目录</h2>
<table><tr><th>书名（同步进酒馆的名字）</th><th>源文件</th><th>条目数</th></tr>
${rows}
</table>
${warns}
</body></html>`;
}

// ---------- HTTP 服务 ----------

const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Cache-Control', 'no-store'); // 禁缓存：文件改完酒馆端立即拿到最新
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('405 Method Not Allowed'); return; }

  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    // 运行环境配置端点
    if (urlPath === '/env.json' || urlPath === '/api/env') {
      const currentConfig = loadEnvConfig(ROOT);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(
        JSON.stringify({
          active: {
            host: HOST,
            port: PORT,
            url: envConfig.sync.configuredUrl || `http://${envConfig.primaryLanIp}:${PORT}`,
          },
          env: currentConfig,
        }, null, 2),
      );
      return;
    }

    // API 端点
    if (urlPath === '/' || urlPath === '/index.html') {
      const { books, warnings } = await loadBooks();
      const totalEntries = books.reduce((a, b) => a + b.count, 0);
      const body = statusPage({ books, warnings, totalEntries });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (urlPath === '/manifest' || urlPath === '/all') {
      const { books, warnings } = await loadBooks();
      const totalEntries = books.reduce((a, b) => a + b.count, 0);
      const slim = urlPath === '/all' ? books : books.map(({ name, file, count }) => ({ name, file, count }));
      const body = JSON.stringify({ generatedAt: new Date().toISOString(), bookCount: books.length, totalEntries, warnings, books: slim });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (urlPath === '/books') {
      // 增量端点：?name=书名&name=书名2（URL 编码），只返回点名的书（已转换格式）
      const names = new Set(new URL(req.url, 'http://x').searchParams.getAll('name'));
      const { books, warnings } = await loadBooks();
      const picked = names.size === 0 ? [] : books.filter((b) => names.has(b.name));
      const body = JSON.stringify({
        bookCount: picked.length,
        totalEntries: picked.reduce((a, b) => a + b.count, 0),
        warnings,
        books: picked,
      });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (urlPath === '/events' && req.method === 'GET') {
      // SSE 实时事件流：hello（当前 revision）+ sync（变更清单）+ 20s 心跳；断开自动清理
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ revision })}\n\n`);
      sseClients.add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(': ping\n\n');
        } catch {
          // 已断开，交由 close 清理
        }
      }, 20_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
      });
      return;
    }

    // 静态文件（与 起服CORS.mjs 相同）
    let filePath = normalize(join(ROOT, urlPath));
    if (!filePath.startsWith(normalize(ROOT))) { res.writeHead(403); res.end('403'); return; }
    let st = await stat(filePath).catch(() => null);
    if (st?.isDirectory()) { filePath = join(filePath, 'index.html'); st = await stat(filePath).catch(() => null); }
    if (!st?.isFile()) { res.writeHead(404); res.end('404 Not Found: ' + urlPath); return; }
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : await readFile(filePath));
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(
      `[世界书同步] 端口 ${PORT} 被占用。换个端口：\n` +
      `  1. 命令行换端口：node 世界书同步服务.mjs ${PORT + 1}\n` +
      `  2. 或在 env.yaml 中修改 sync.port`,
    );
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, HOST, async () => {
  const lanLines = envConfig.lanIps.map((ip) => `  · 内网访问: http://${ip}:${PORT}/`).join('\n');
  const syncTarget = envConfig.sync.configuredUrl || `http://${envConfig.primaryLanIp}:${PORT}`;
  console.log(
    `[世界书同步] 服务启动成功 (配置源: ${envConfig.source})\n` +
    `  · 本地访问: http://127.0.0.1:${PORT}/\n` +
    (lanLines ? lanLines + '\n' : '') +
    `  · 酒馆脚本拉取地址: ${syncTarget}/all（实时事件流：${syncTarget}/events）\n` +
    `  · 根目录:   ${ROOT}\n` +
    `  · CORS已开启 (含 Access-Control-Allow-Private-Network)`,
  );
  await startWatching();
  console.log('[世界书同步] 已监听 worldbooks/ 变更（fs.watch + 10s 兜底轮询，SSE 就绪）');
  // 启动自检（只读打印，不阻断）
  const { books, warnings } = await loadBooks();
  const totalEntries = books.reduce((a, b) => a + b.count, 0);
  console.log(`[世界书同步] 自检：${books.length} 本 / ${totalEntries} 条`);
  for (const b of books) console.log(`  · ${b.name}（${b.count} 条）<- ${b.file}`);
  for (const w of warnings) console.warn(`  ⚠ ${w}`);
});
