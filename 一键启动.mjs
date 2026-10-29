#!/usr/bin/env node
// 一键启动.mjs —— PC 本地一键启动与受控更新总控器（FD-48）
//
// 核心职责：
// 1. 环境与脚本对齐：读取 env.yaml 并调用 syncScriptPreset 对齐「同步世界书-酒馆助手脚本.js」
// 2. 构建产物自检：检查 mvu指挥系统/dist/ 四大产物，缺失或传 --build 时自动编译
// 3. 启动期版本检测：默认【只检测新版本、绝不自动执行更新】；检测到新版本或存档结构改动时在终端醒目提示
// 4. 本地服务群拉起与守护：并发拉起并守护 起服CORS.mjs (:5500) + 世界书同步服务.mjs (:5510)
//    + 可选 Vite 热监听 (:6621, --watch/--dev) + 可选 Gemini 代理 (:8787, --gemini-proxy)
// 5. 受控更新模式 (--update)：显式触发 Git 安全预检 + git pull --ff-only + vite-build 重编译
import { spawn } from 'node:child_process';
import { get as httpGet } from 'node:http';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig, syncScriptPreset } from './scripts/load-env.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * 解析命令行参数
 * @param {string[]} argv
 */
export function parseLauncherArgs(argv = []) {
  const flags = new Set();
  let manifestUrl = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = String(argv[i] ?? '').trim();
    if (!arg) continue;
    if (arg.startsWith('--manifest-url=')) {
      manifestUrl = arg.slice('--manifest-url='.length).trim();
      continue;
    }
    if (arg === '--manifest-url' && i + 1 < argv.length) {
      manifestUrl = String(argv[++i] ?? '').trim();
      continue;
    }
    flags.add(arg);
  }

  const watch = flags.has('--watch') || flags.has('--dev');
  const dev = watch;
  const geminiProxy = flags.has('--gemini-proxy');
  const build = flags.has('--build');
  const checkOnly = flags.has('--check-only');
  const update = flags.has('--update');
  const noServe = flags.has('--no-serve');
  const allowDirty = flags.has('--allow-dirty');

  const mode = checkOnly
    ? 'check-only'
    : update && noServe
      ? 'update-only'
      : watch
        ? 'dev-watch'
        : 'stable';

  return {
    mode,
    watch,
    dev,
    geminiProxy,
    build,
    checkOnly,
    update,
    noServe,
    allowDirty,
    manifestUrl,
  };
}

/**
 * 探测指定 TCP 端口是否已被监听
 * @param {number} port
 * @param {string} [host='127.0.0.1']
 * @param {number} [timeoutMs=1200]
 * @returns {Promise<boolean>}
 */
export function probePortInUse(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ port, host });
    let settled = false;
    const finish = (inUse) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolveProbe(inUse);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/**
 * 探测本地 HTTP JSON 端点是否已在线
 * @param {string} url
 * @param {number} [timeoutMs=1800]
 */
export function probeHttpEndpoint(url, timeoutMs = 1800) {
  return new Promise((resolveProbe) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolveProbe(result);
    };

    const req = httpGet(url, { timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          try {
            finish({ ok: true, statusCode: res.statusCode, data: JSON.parse(text) });
          } catch {
            finish({ ok: true, statusCode: res.statusCode, text });
          }
        } else {
          finish({ ok: false, statusCode: res.statusCode });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      finish({ ok: false, reason: 'timeout' });
    });
    req.on('error', (err) => {
      finish({ ok: false, reason: err.message });
    });
  });
}

async function loadUpdateManager() {
  return import('./scripts/local-update-manager.mjs');
}

/**
 * 打印版本检测提示横幅（默认只检测，不自动更新）
 */
function printVersionNotice(checkResult, log = console.log) {
  if (!checkResult) return;
  if (checkResult.hasBreakingSaveChange) {
    log('');
    log('========================================================================');
    log(
      `[总控 · 存档结构升级提醒] 发现新版本 v${checkResult.localVersion} -> v${checkResult.latestVersion}`,
    );
    log('  · 系统已遵循「只检不更」原则，未自动覆盖任何本地文件。');
    log('  · 新版本包含战局存档结构调整，请先在酒馆中控台点击「一键备份战局 (.json + 世界书)」。');
    if (Array.isArray(checkResult.breakingWarnings) && checkResult.breakingWarnings.length > 0) {
      for (const w of checkResult.breakingWarnings) {
        log(`  · 说明: ${w}`);
      }
    }
    log('  · 备份完成后，可在酒馆更新弹窗内一键通知本地服务更新，或双击「一键更新.bat」。');
    log('========================================================================');
    log('');
  } else if (checkResult.hasUpdate) {
    log('');
    log('------------------------------------------------------------------------');
    log(
      `[总控 · 发现新版本] 本地 v${checkResult.localVersion} -> 最新 v${checkResult.latestVersion}（默认只检测，未自动更新）`,
    );
    log('  · 您可在酒馆中控台顶栏点击新版胶囊查看更新日志，或双击「一键更新.bat」更新。');
    log('------------------------------------------------------------------------');
    log('');
  } else {
    log(
      `[总控] 版本检测完成：当前版本 v${checkResult.localVersion || '未知'}（状态: ${checkResult.status || 'up-to-date'}，自动更新: 已禁用）`,
    );
  }
}

/**
 * 为子进程标准输出/错误流挂载带前缀的分行打印
 */
function pipePrefixedStream(stream, prefix, writeLine = console.log) {
  if (!stream) return;
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim().length > 0) {
        writeLine(`${prefix} ${line}`);
      }
    }
  });
  stream.on('end', () => {
    if (buffer.trim().length > 0) {
      writeLine(`${prefix} ${buffer}`);
      buffer = '';
    }
  });
}

/**
 * 执行总控流程
 * @param {string[]} [argv]
 * @param {object} [options]
 */
export async function runLauncher(argv = process.argv.slice(2), options = {}) {
  const rootDir = options.rootDir || ROOT;
  const log = options.log || console.log;
  const warn = options.warn || console.warn;
  const error = options.error || console.error;
  const args = parseLauncherArgs(argv);

  // Phase 1: 读取环境配置与对齐酒馆助手脚本预设
  const envConfig = loadEnvConfig(rootDir);
  syncScriptPreset(rootDir);

  const corsPort = envConfig.cors?.port || 5500;
  const syncPort = envConfig.sync?.port || 5510;

  const updateManager = await loadUpdateManager();
  const {
    readLocalVersionInfo,
    checkDistArtifacts,
    ensureDistBuilt,
    checkRemoteVersion,
    getVersionStatusPayload,
    performControlledLocalUpdate,
  } = updateManager;

  const localInfo = readLocalVersionInfo(rootDir);
  log(
    `[总控] SillyTavern-世界观构建 PC 启动总控器 | 本地版本 v${localInfo.version} (存档代数: 第 ${localInfo.saveSchema} 代) | 模式: ${args.mode}`,
  );

  // --check-only：仅执行环境、构建产物与版本检测，输出结构化摘要后退出
  if (args.checkOnly) {
    const distStatus = checkDistArtifacts(rootDir);
    const versionStatus = await getVersionStatusPayload(rootDir, {
      refresh: true,
      manifestUrl: args.manifestUrl || undefined,
    });
    log(`[总控] 环境配置源: ${envConfig.source} (CORS :${corsPort}, 世界书同步 :${syncPort})`);
    log(
      `[总控] 构建产物状态: ${distStatus.ready ? '齐全 (4/4)' : `缺失 (${distStatus.missing.join(', ')})`}`,
    );
    printVersionNotice(versionStatus.check, log);
    return {
      ok: true,
      mode: 'check-only',
      exitCode: 0,
      envConfig,
      distStatus,
      versionStatus,
    };
  }

  // --update：显式执行受控更新（安全预检 + git pull --ff-only + vite-build 重编译）
  let builtDuringUpdate = false;
  if (args.update) {
    log('[总控] 正在执行受控更新流水线（Git 工作区安全预检 -> 拉取代码 -> 重新编译 dist/）...');
    const updateResult = await performControlledLocalUpdate(rootDir, {
      allowDirty: args.allowDirty,
    });
    if (!updateResult.ok) {
      error(`[总控] 受控更新未完成: ${updateResult.message || updateResult.error || '未知原因'}`);
      return {
        ok: false,
        mode: args.mode,
        exitCode: 1,
        updateResult,
      };
    }
    builtDuringUpdate = true;
    log(
      `[总控] 受控更新完成: v${updateResult.previousVersion} -> v${updateResult.currentVersion} (${updateResult.message || '已同步并重新编译'})`,
    );
    if (args.noServe) {
      return {
        ok: true,
        mode: 'update-only',
        exitCode: 0,
        updateResult,
      };
    }
  }

  // Phase 2: 检查 mvu指挥系统/dist/ 四大构建产物，缺失或 --build 时按需编译
  const distCheck = checkDistArtifacts(rootDir);
  if ((!distCheck.ready || args.build) && !builtDuringUpdate) {
    log(
      distCheck.ready
        ? '[总控] 已指定 --build，正在重新编译 mvu指挥系统/dist/ 生产产物...'
        : `[总控] 检测到 dist/ 构建产物缺失 (${distCheck.missing.join(', ')})，正在自动执行首次编译...`,
    );
    const buildRes = await ensureDistBuilt(rootDir, { forceBuild: args.build });
    if (!buildRes.ok) {
      error(`[总控] 构建 mvu指挥系统/dist/ 失败: ${buildRes.error || buildRes.message || ''}`);
      return {
        ok: false,
        mode: args.mode,
        exitCode: 1,
        buildResult: buildRes,
      };
    }
    log('[总控] mvu指挥系统/dist/ 四大构建产物已就绪。');
  } else {
    log('[总控] mvu指挥系统/dist/ 四大构建产物自检通过（秒起模式）。');
  }

  // Phase 3: 启动后台非阻塞版本检查（严格只检不更！）
  const shouldCheckOnStartup = envConfig.update?.checkOnStartup !== false;
  if (shouldCheckOnStartup) {
    Promise.resolve()
      .then(() =>
        checkRemoteVersion(rootDir, {
          manifestUrl: args.manifestUrl || undefined,
        }),
      )
      .then((checkRes) => {
        printVersionNotice(checkRes, log);
      })
      .catch((err) => {
        warn(`[总控] 启动期版本检测跳过: ${err?.message || String(err)}`);
      });
  }

  // Phase 4: 并发拉起并守护本地服务群
  const children = [];
  let shuttingDown = false;

  const cleanupChildren = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const item of children) {
      try {
        if (item.child && !item.child.killed) {
          item.child.kill('SIGTERM');
        }
      } catch {
        /* ignore */
      }
    }
  };

  const onSigInt = () => {
    log('\n[总控] 收到退出信号，正在安全关闭所有本地子服务...');
    cleanupChildren();
    process.exit(0);
  };

  process.once('SIGINT', onSigInt);
  process.once('SIGTERM', onSigInt);
  process.once('exit', cleanupChildren);

  const spawnManagedService = (label, prefix, scriptArgs, cwd = rootDir) => {
    const child = spawn(process.execPath, scriptArgs, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });
    pipePrefixedStream(child.stdout, prefix, log);
    pipePrefixedStream(child.stderr, prefix, error);
    child.on('exit', (code, signal) => {
      if (!shuttingDown && code !== 0 && code !== null) {
        warn(`${prefix} 进程退出 (code=${code}, signal=${signal || 'none'})`);
      }
    });
    children.push({ label, prefix, child });
    return child;
  };

  // 1) 起服CORS.mjs (:5500)
  const corsProbe = await probeHttpEndpoint(`http://127.0.0.1:${corsPort}/env.json`);
  if (corsProbe.ok) {
    log(`[总控] 检测到 [静态与管控:${corsPort}] 已在线，直接复用现有服务。`);
  } else if (await probePortInUse(corsPort, '127.0.0.1')) {
    warn(
      `[总控] 端口 ${corsPort} 已被其他进程占用且未响应 /env.json，请排查端口冲突或修改 env.yaml 中的 cors.port。`,
    );
  } else {
    spawnManagedService(
      '起服CORS',
      `[静态与管控:${corsPort}]`,
      [join(rootDir, '起服CORS.mjs'), String(corsPort)],
      rootDir,
    );
  }

  // 2) 世界书同步服务.mjs (:5510)
  const syncProbe = await probeHttpEndpoint(`http://127.0.0.1:${syncPort}/manifest`);
  if (syncProbe.ok) {
    log(`[总控] 检测到 [世界书同步:${syncPort}] 已在线，直接复用现有服务。`);
  } else if (await probePortInUse(syncPort, '127.0.0.1')) {
    warn(
      `[总控] 端口 ${syncPort} 已被其他进程占用且未响应 /manifest，请排查端口冲突或修改 env.yaml 中的 sync.port。`,
    );
  } else {
    spawnManagedService(
      '世界书同步服务',
      `[世界书同步:${syncPort}]`,
      [join(rootDir, '世界书同步服务.mjs'), String(syncPort)],
      rootDir,
    );
  }

  // 3) 可选：Vite Watch 热监听 (:6621)
  if (args.watch) {
    spawnManagedService(
      'Vite热监听',
      '[Vite热监听:6621]',
      [join(rootDir, 'mvu指挥系统/scripts/vite-build.mjs'), '--mode', 'development', '--watch'],
      join(rootDir, 'mvu指挥系统'),
    );
  }

  // 4) 可选：Gemini 透传代理 (:8787)
  if (args.geminiProxy) {
    spawnManagedService(
      'Gemini透传代理',
      '[Gemini代理:8787]',
      [join(rootDir, 'Gemini透传代理.mjs')],
      rootDir,
    );
  }

  log(
    `[总控] 本地服务群已就绪：静态与版本管控 http://127.0.0.1:${corsPort} | 世界书同步 http://127.0.0.1:${syncPort}（按 Ctrl+C 可一键停止全部服务）`,
  );

  return {
    ok: true,
    mode: args.mode,
    exitCode: 0,
    children,
    cleanupChildren,
  };
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  runLauncher(process.argv.slice(2))
    .then((res) => {
      if (res && (res.mode === 'check-only' || res.mode === 'update-only' || !res.ok)) {
        process.exit(res.exitCode ?? (res.ok ? 0 : 1));
      }
    })
    .catch((err) => {
      console.error('[总控] 启动异常:', err);
      process.exit(1);
    });
}
