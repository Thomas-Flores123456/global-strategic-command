#!/usr/bin/env node
/**
 * 统计常驻.mjs —— 世界书书架统计脚本
 *
 * 扫描目录下所有 *世界书*.json（自动发现，不用手动维护清单），统计：
 *   1. 每本书的启用条目数、Prompt 净注入 token 估算（剥离酒馆正则拦截的 <数据> 块与 *系统映射* 行）及原始总 token
 *   2. 全书架常驻(蓝灯)合计（每轮固定注入开销）
 *   3. 全书架 Prompt 净 token 容量 vs 原始仓库总 token（仓库容量参考）
 *   4. 被禁用(disable)的条目提醒
 *
 * token 估算规则：中日韩字符≈1 token/字，其余(英文/数字/符号)≈0.3 token/字符。
 * 与真实分词器有偏差（±15%量级），够做预算判断。
 *
 * 用法：node 统计常驻.mjs [目录]   （缺省为脚本同级 worldbooks/）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || path.join(scriptDir, 'worldbooks');

export const estTokens = (s) => {
  let t = 0;
  for (const ch of s) {
    t += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\u3040-\u30ff]/.test(ch) ? 1 : 0.3;
  }
  return Math.round(t);
};

/**
 * 剥离在 SillyTavern 酒馆环境中被正则精准拦截、不会进入最终 LLM 提示词的机器契约块：
 *   1. <数据>...</数据> 结构化 JSON 块
 *   2. *系统映射：...* 尾行机器索引
 */
export const stripPromptIntercepted = (s) =>
  (s || '')
    .replace(/<数据>[\s\S]*?<\/数据>/g, '')
    .replace(/^\s*\*?系统映射[：:][^\r\n]*$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const files = fs.readdirSync(dir)
    .filter(f => f.includes('世界书') && f.endsWith('.json'))
    .sort();

  if (!files.length) {
    console.error('未在目录中发现 *世界书*.json：' + dir);
    process.exit(2);
  }

  let totalBooks = 0, totalEntries = 0, totalEnabledEntries = 0;
  let totalConst = 0, totalConstNetTok = 0, totalConstRawTok = 0;
  let totalEnabledNetTok = 0, totalEnabledRawTok = 0, totalAllRawTok = 0, totalDisabled = 0;
  const constRows = [];

  for (const f of files) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    } catch (e) {
      console.error(`⚠ ${f} 解析失败：${e.message}`);
      continue;
    }
    const entries = Object.values(data.entries || {});
    if (!entries.length) { console.error(`⚠ ${f} 无 entries，跳过`); continue; }

    totalBooks++;
    totalEntries += entries.length;
    let bookNetTok = 0, bookEnabledRawTok = 0, bookAllRawTok = 0, bookEnabledCnt = 0;
    const consts = [];

    for (const e of entries) {
      const raw = e.content || '';
      const rawTok = estTokens(raw);
      bookAllRawTok += rawTok;
      totalAllRawTok += rawTok;

      if (e.disable) {
        totalDisabled++;
        continue;
      }

      const netTok = estTokens(stripPromptIntercepted(raw));
      bookEnabledCnt++;
      totalEnabledEntries++;
      bookNetTok += netTok;
      bookEnabledRawTok += rawTok;
      totalEnabledNetTok += netTok;
      totalEnabledRawTok += rawTok;

      if (e.constant) {
        consts.push({ comment: e.comment || `(uid ${e.uid})`, tok: netTok, rawTok });
        totalConst++;
        totalConstNetTok += netTok;
        totalConstRawTok += rawTok;
      }
    }

    const name = f.replace(/_?世界书\.json$/, '');
    const disNote = entries.length - bookEnabledCnt > 0 ? ` (启用${bookEnabledCnt}/禁${entries.length - bookEnabledCnt})` : '';
    console.log(`📖 ${name} —— ${entries.length} 条${disNote} · 净Prompt≈${bookNetTok} tokens (含数据块/映射≈${bookEnabledRawTok}t) · 常驻 ${consts.length} 条`);
    for (const c of consts) {
      console.log(`     🔵 ${c.comment} ≈${c.tok} tokens`);
      constRows.push({ book: name, ...c });
    }
  }

  const interceptedTok = totalEnabledRawTok - totalEnabledNetTok;
  console.log('\n' + '═'.repeat(68));
  console.log(`书架：${totalBooks} 本 · 共 ${totalEntries} 条目（启用 ${totalEnabledEntries} 条 / 禁用 ${totalDisabled} 条）`);
  console.log(`启用条目 Prompt 净容量：≈${totalEnabledNetTok} tokens（已剔除酒馆正则拦截的 <数据> 与 *系统映射* ≈${interceptedTok} tokens）`);
  console.log(`全库原始文件总容量：≈${totalAllRawTok} tokens（启用原始≈${totalEnabledRawTok}t ＋ 禁用SVG等≈${totalAllRawTok - totalEnabledRawTok}t，非每轮开销）`);
  console.log(`常驻(蓝灯)：${totalConst} 条 · 每轮固定净注入≈${totalConstNetTok} tokens（原始≈${totalConstRawTok} tokens）`);
  if (constRows.length) {
    const max = constRows.reduce((a, b) => (b.tok > a.tok ? b : a));
    console.log(`常驻最大条：『${max.book}』${max.comment} ≈${max.tok} tokens`);
  }
}
