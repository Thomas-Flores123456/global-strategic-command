#!/usr/bin/env node
/**
 * 查看世界书.mjs —— 快速查看独立世界书（World Info 格式）的条目
 *
 * 用途：本地只读检查 ST「世界书编辑器」导出的独立文件
 *   { "entries": { "0": {...}, "1": {...} } }
 * 供任何 Agent 复用：列全书条目、看指定条目全文、按正则搜内容。
 * 本脚本只读，不修改任何文件。
 *
 * 用法：
 *   node 查看世界书.mjs <文件.json>                     列出全部条目（uid/order/key/comment/首行预览）
 *   node 查看世界书.mjs <文件.json> <uid> [uid...]      打印指定 uid 条目的完整字段与 content
 *   node 查看世界书.mjs <文件.json> -k <词> [词...]     按 key/comment 包含匹配，打印完整条目
 *   node 查看世界书.mjs <文件.json> -g <正则> [选项]    在条目文本中正则搜索，打印命中行
 *
 * -g 选项：
 *   --field content|key|comment|all   搜索范围（默认 all＝content+key+comment）
 *   --ctx N                           每个命中行附带上下 N 行（默认 0）
 *   --count                           只输出每条目命中数，不输出命中行
 *   -i                                忽略大小写
 *
 * 退出码：0=正常；1=-g 模式无任何命中；2=用法或读取错误。
 *
 * 免责边界：本脚本只做静态离线查看，不证明真机激活/递归/order 注入行为。
 */

import fs from 'node:fs';
import path from 'node:path';

function usage() {
  console.error('用法：node 查看世界书.mjs <文件.json> [uid... | -k 词... | -g 正则 [选项]]');
  console.error('详见脚本头注释。');
  process.exit(2);
}

// ---------- 读取与解析 ----------

function loadEntries(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`无法读取文件 ${filePath}：${e.message}`);
    process.exit(2);
  }
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 容忍 BOM
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(`JSON 解析失败：${e.message}`);
    process.exit(2);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data.entries)) {
    console.error('不是独立世界书格式（期望顶层 { "entries": { "0": {...} } }）。');
    process.exit(2);
  }
  const entries = Object.values(data.entries)
    .filter((e) => e && typeof e === 'object')
    .sort((a, b) => (a.uid ?? 0) - (b.uid ?? 0));
  return entries;
}

function oneLine(s, n = 40) {
  return String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
}

// ---------- 模式一：列全部条目 ----------

function listAll(entries, name) {
  console.log(`📖 ${name} · 共 ${entries.length} 条`);
  console.log('─'.repeat(72));
  for (const e of entries) {
    const keys = (e.key ?? []).join(' / ');
    console.log(
      `uid ${String(e.uid).padStart(4)} | order ${String(e.order ?? '-').padStart(6)} | ` +
      `${e.constant ? '常驻' : '触发'} | ${keys}`
    );
    if (e.comment) console.log(`         备注: ${oneLine(e.comment, 60)}`);
    console.log(`         预览: ${oneLine(e.content, 60)}`);
  }
}

// ---------- 模式二/三：打印完整条目 ----------

function printEntry(e) {
  console.log('═'.repeat(72));
  console.log(`uid ${e.uid} | order ${e.order ?? '-'} | ${e.constant ? '常驻' : '触发'}` +
    `${e.disable ? ' | 已禁用' : ''}`);
  console.log(`key: ${JSON.stringify(e.key ?? [])}`);
  if (e.keysecondary?.length) console.log(`keysecondary: ${JSON.stringify(e.keysecondary)}`);
  if (e.comment) console.log(`comment: ${e.comment}`);
  console.log('─'.repeat(72));
  console.log(e.content ?? '(无 content)');
}

// ---------- 模式四：正则搜索 ----------

function grepEntries(entries, name, re, { field, ctx, countOnly }) {
  let totalHits = 0;
  let printedHeader = false;

  for (const e of entries) {
    const label = `uid ${e.uid}${e.comment ? `（${oneLine(e.comment, 30)}）` : ''}`;
    const targets = [];
    if (field === 'all' || field === 'content') targets.push(['content', String(e.content ?? '')]);
    if (field === 'all' || field === 'key') targets.push(['key', (e.key ?? []).join('\n')]);
    if (field === 'all' || field === 'comment') targets.push(['comment', String(e.comment ?? '')]);

    let entryHits = 0;
    const hitLines = [];
    for (const [fname, text] of targets) {
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (re.test(line)) {
          entryHits++;
          hitLines.push({ fname, lineNo: i + 1, line, lines });
        }
      });
    }
    if (entryHits === 0) continue;
    totalHits += entryHits;

    if (countOnly) {
      console.log(`${name} · ${label} · 命中 ${entryHits} 行`);
      continue;
    }
    if (!printedHeader) {
      console.log(`📖 ${name}`);
      printedHeader = true;
    }
    console.log(`  ▶ ${label} · 命中 ${entryHits} 行`);
    const shown = new Set();
    for (const h of hitLines) {
      const from = Math.max(1, h.lineNo - ctx);
      const to = Math.min(h.lines.length, h.lineNo + ctx);
      for (let n = from; n <= to; n++) {
        const tag = `${h.fname}:L${n}`;
        if (shown.has(tag)) continue;
        shown.add(tag);
        const marker = n === h.lineNo ? '>>' : '  ';
        console.log(`     ${marker} ${tag} | ${h.lines[n - 1]}`);
      }
      if (ctx > 0) console.log('     ···');
    }
  }

  if (printedHeader && !countOnly) console.log(`  小计：${totalHits} 行命中`);
  return totalHits;
}

// ---------- 主流程 ----------

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const filePath = args[0];
  if (args[0].startsWith('-')) usage();
  const entries = loadEntries(filePath);
  const name = path.basename(filePath);
  const rest = args.slice(1);

  // 模式四：-g 正则搜索
  const gIdx = rest.indexOf('-g');
  if (gIdx !== -1) {
    const pattern = rest[gIdx + 1];
    if (!pattern) usage();
    const opt = { field: 'all', ctx: 0, countOnly: false, ignoreCase: false };
    for (let i = gIdx + 2; i < rest.length; i++) {
      if (rest[i] === '--field') opt.field = rest[++i];
      else if (rest[i] === '--ctx') opt.ctx = parseInt(rest[++i], 10) || 0;
      else if (rest[i] === '--count') opt.countOnly = true;
      else if (rest[i] === '-i') opt.ignoreCase = true;
    }
    if (!['content', 'key', 'comment', 'all'].includes(opt.field)) usage();
    const re = new RegExp(pattern, opt.ignoreCase ? 'i' : '');
    const hits = grepEntries(entries, name, re, opt);
    process.exit(hits > 0 ? 0 : 1);
  }

  // 模式三：-k 按 key/comment 包含匹配
  const kIdx = rest.indexOf('-k');
  if (kIdx !== -1) {
    const words = rest.slice(kIdx + 1);
    if (words.length === 0) usage();
    const matched = entries.filter((e) => {
      const hay = `${(e.key ?? []).join('\n')}\n${e.comment ?? ''}`;
      return words.some((w) => hay.includes(w));
    });
    if (matched.length === 0) {
      console.log(`📖 ${name} · 无 key/comment 包含 ${JSON.stringify(words)} 的条目`);
      process.exit(0);
    }
    console.log(`📖 ${name} · 匹配 ${matched.length} 条`);
    matched.forEach(printEntry);
    process.exit(0);
  }

  // 模式二：指定 uid
  if (rest.length > 0) {
    const uids = rest.map((s) => parseInt(s, 10));
    if (uids.some((n) => !Number.isInteger(n))) usage();
    let found = 0;
    for (const u of uids) {
      const e = entries.find((x) => x.uid === u);
      if (!e) {
        console.log(`⚠️  uid ${u} 不存在`);
        continue;
      }
      printEntry(e);
      found++;
    }
    process.exit(found > 0 ? 0 : 2);
  }

  // 模式一：列全部
  listAll(entries, name);
}

main();
