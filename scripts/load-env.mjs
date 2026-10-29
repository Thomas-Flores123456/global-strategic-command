// scripts/load-env.mjs —— 零依赖读取 env.yaml / env.example.yaml 与网络环境推断
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * 纯正则/状态机零依赖简易 YAML 解析器
 * 支持：
 * - 注释与行内注释过滤
 * - 一级标量与二级字典嵌套（如 cors:\n  port: 5500）
 * - 引号剥离与基本类型转换（数字、布尔、字符串）
 */
export function parseSimpleYaml(content) {
  const result = {};
  let currentKey = null;

  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    let line = rawLine;
    const hashIdx = line.indexOf('#');
    if (hashIdx >= 0) {
      // 简单判断 # 是否在未闭合引号内
      const quoteCount = (line.slice(0, hashIdx).match(/['"]/g) || []).length;
      if (quoteCount % 2 === 0) {
        line = line.slice(0, hashIdx);
      }
    }
    line = line.trimEnd();
    if (!line.trim()) continue;

    // 二级缩进（2 个或以上空格）
    const isIndented = /^\s{2,}/.test(line);
    const trimmed = line.trim();
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const valStr = trimmed.slice(colonIdx + 1).trim();

    // 转换值
    let val;
    if (!valStr) {
      val = {};
    } else if (/^true$/i.test(valStr)) {
      val = true;
    } else if (/^false$/i.test(valStr)) {
      val = false;
    } else if (/^-?\d+(\.\d+)?$/.test(valStr)) {
      val = Number(valStr);
    } else {
      // 去除外层单/双引号
      if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
        val = valStr.slice(1, -1).trim();
      } else {
        val = valStr;
      }
    }

    if (isIndented && currentKey && typeof result[currentKey] === 'object' && result[currentKey] !== null) {
      result[currentKey][key] = val;
    } else {
      if (!valStr) {
        result[key] = {};
        currentKey = key;
      } else {
        result[key] = val;
        currentKey = null;
      }
    }
  }

  return result;
}

/**
 * 获取本机所有的局域网非回环 IPv4 地址
 */
export function getLanIps() {
  const nets = networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push(net.address);
      }
    }
  }
  return ips;
}

/**
 * 读取 env.yaml（不存在时降级读 env.example.yaml），并计算出标准化配置对象
 */
export function loadEnvConfig(customRoot = ROOT) {
  const yamlPath = join(customRoot, 'env.yaml');
  const examplePath = join(customRoot, 'env.example.yaml');
  let raw = '';
  let source = 'default';

  if (existsSync(yamlPath)) {
    try {
      raw = readFileSync(yamlPath, 'utf8');
      source = 'env.yaml';
    } catch { /* 忽略错误 */ }
  } else if (existsSync(examplePath)) {
    try {
      raw = readFileSync(examplePath, 'utf8');
      source = 'env.example.yaml';
    } catch { /* 忽略错误 */ }
  }

  let parsed = {};
  if (raw) {
    try {
      parsed = parseSimpleYaml(raw);
    } catch (e) {
      console.warn(`[env-loader] 解析 ${source} 出错：${e.message}，已回退默认值`);
    }
  }

  const lanIps = getLanIps();
  const primaryLanIp = lanIps[0] || '127.0.0.1';

  // 1. host
  const host = process.env.HOST || parsed.host || '0.0.0.0';

  // 2. CORS 静态服务配置
  const corsPort =
    Number(process.env.PORT) ||
    Number(parsed.cors?.port) ||
    Number(parsed.cors_port) ||
    5500;
  const rawCorsUrl = (parsed.cors?.url || parsed.target_url || '').trim();
  const corsUrl = rawCorsUrl ? rawCorsUrl.replace(/\/+$/, '') : `http://${primaryLanIp}:${corsPort}`;

  // 3. 世界书同步服务配置
  const syncPort =
    Number(process.env.SYNC_PORT) ||
    Number(parsed.sync?.port) ||
    Number(parsed.sync_port) ||
    5510;
  const rawSyncUrl = (parsed.sync?.url || parsed.sync_url || '').trim();
  const syncUrl = rawSyncUrl ? rawSyncUrl.replace(/\/+$/, '') : `http://${primaryLanIp}:${syncPort}`;

  return {
    source,
    host,
    lanIps,
    primaryLanIp,
    cors: {
      port: corsPort,
      url: corsUrl,
      configuredUrl: rawCorsUrl,
    },
    sync: {
      port: syncPort,
      url: syncUrl,
      configuredUrl: rawSyncUrl,
    },
    update: {
      checkOnStartup: parsed.update?.check_on_startup !== false && parsed.check_on_startup !== false,
      autoUpdate: false, // 架构铁律：强制默认 false，禁止启动时静默自动更新
      manifestUrl: String(parsed.update?.manifest_url || parsed.manifest_url || '').trim(),
    },
  };
}

/**
 * 将 env.yaml 中的同步目标配置自动同步至「同步世界书-酒馆助手脚本.js」头部
 */
export function syncScriptPreset(customRoot = ROOT) {
  const scriptPath = join(customRoot, '同步世界书-酒馆助手脚本.js');
  if (!existsSync(scriptPath)) return false;

  const config = loadEnvConfig(customRoot);
  const targetBase = config.sync.configuredUrl || '';
  const targetPort = config.sync.port;

  try {
    const raw = readFileSync(scriptPath, 'utf8');
    let updated = raw;

    const baseRegex = /^const PRESET_SYNC_BASE = '.*';/m;
    const portRegex = /^const PRESET_PORT = \d+;/m;

    const newBaseLine = `const PRESET_SYNC_BASE = '${targetBase}';`;
    const newPortLine = `const PRESET_PORT = ${targetPort};`;

    if (baseRegex.test(updated)) {
      updated = updated.replace(baseRegex, newBaseLine);
    }
    if (portRegex.test(updated)) {
      updated = updated.replace(portRegex, newPortLine);
    }

    if (updated !== raw) {
      writeFileSync(scriptPath, updated, 'utf8');
      console.log(`[env-loader] 已将 env.yaml 中的同步目标配置同步至「同步世界书-酒馆助手脚本.js」`);
      return true;
    }
  } catch (e) {
    console.warn(`[env-loader] 尝试同步酒馆助手脚本预设失败：${e.message}`);
  }
  return false;
}
