// scripts/local-update-manager.mjs —— FD-48 本地版本检测与受控热更新管理器（纯 Node 内置模块，零第三方依赖）
import { execFile, execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig, syncScriptPreset } from './load-env.mjs';

export const DEFAULT_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const DIST_ARTIFACTS = [
  'mvu指挥系统/dist/中控悬浮窗/index.js',
  'mvu指挥系统/dist/开场启动器/index.html',
  'mvu指挥系统/dist/红警指挥系统/index.html',
  'mvu指挥系统/dist/预设守护脚本/index.js',
];

const PRESET_SCRIPT_REL_PATH = '同步世界书-酒馆助手脚本.js';

/** 模块级最近一次版本检测缓存 */
let lastVersionCheck = null;

/** 模块级受控更新单飞锁 */
let updateInFlight = false;

/**
 * 稳健的语义化版本号比较函数（返回 -1 | 0 | 1）
 * 兼容前导 v/V、预发布后缀（如 -beta.1）以及非标字符串兜底。
 */
export function compareSemver(a, b) {
  const rawA = String(a ?? '').trim().replace(/^[vV]+/, '');
  const rawB = String(b ?? '').trim().replace(/^[vV]+/, '');
  if (rawA === rawB) return 0;

  const parseParts = str => {
    const [coreAndBuild, ...preParts] = str.split('-');
    const core = (coreAndBuild || '').split('+')[0];
    const segments = core.split('.');
    if (segments.length === 0 || !segments.every(seg => /^\d+$/.test(seg))) {
      return null;
    }
    return {
      nums: segments.map(seg => Number.parseInt(seg, 10)),
      prerelease: preParts.join('-').split('+')[0] || '',
    };
  };

  const pa = parseParts(rawA);
  const pb = parseParts(rawB);

  if (pa && pb) {
    const maxLen = Math.max(pa.nums.length, pb.nums.length, 3);
    for (let i = 0; i < maxLen; i++) {
      const na = pa.nums[i] ?? 0;
      const nb = pb.nums[i] ?? 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    if (!pa.prerelease && !pb.prerelease) return 0;
    // 正式版高于预发布版（如 2.4.0 > 2.4.0-beta.1）
    if (!pa.prerelease && pb.prerelease) return 1;
    if (pa.prerelease && !pb.prerelease) return -1;
    const preCmp = pa.prerelease.localeCompare(pb.prerelease, undefined, { numeric: true });
    return preCmp > 0 ? 1 : preCmp < 0 ? -1 : 0;
  }

  const fallbackCmp = rawA.localeCompare(rawB, undefined, { numeric: true });
  return fallbackCmp > 0 ? 1 : fallbackCmp < 0 ? -1 : 0;
}

/**
 * 解码 Git 在未关闭 quotepath 时可能产生的八进制转义路径
 */
function unquoteGitPath(rawPath) {
  let trimmed = String(rawPath || '').trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(1, -1);
  }
  if (!trimmed.includes('\\')) return trimmed;
  try {
    const bytes = [];
    for (let i = 0; i < trimmed.length; i++) {
      if (trimmed[i] === '\\' && /[0-7]{3}/.test(trimmed.slice(i + 1, i + 4))) {
        bytes.push(Number.parseInt(trimmed.slice(i + 1, i + 4), 8));
        i += 3;
      } else if (trimmed[i] === '\\' && i + 1 < trimmed.length) {
        bytes.push(...Buffer.from(trimmed[i + 1], 'utf8'));
        i += 1;
      } else {
        bytes.push(...Buffer.from(trimmed[i], 'utf8'));
      }
    }
    return Buffer.from(bytes).toString('utf8');
  } catch {
    return trimmed;
  }
}

/**
 * 判断 `同步世界书-酒馆助手脚本.js` 的改动是否仅包含 `PRESET_SYNC_BASE` / `PRESET_PORT` 常量行
 */
function isOnlyPresetScriptNoise(diffText) {
  if (typeof diffText !== 'string' || !diffText.trim()) return true;
  const lines = diffText.split(/\r?\n/);
  const changedLines = lines.filter(
    line =>
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---')),
  );
  if (changedLines.length === 0) return true;
  return changedLines.every(line =>
    /^[+-]\s*const\s+(?:PRESET_SYNC_BASE|PRESET_PORT)\s*=/.test(line),
  );
}

function defaultSyncGitRunner(args, rootDir) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 4000,
  });
}

/**
 * 读取本地版本信息（version.json，缺失时回退 mvu指挥系统/package.json）与 Git 工作区状态
 */
export function readLocalVersionInfo(rootDir = DEFAULT_ROOT, options = {}) {
  const versionJsonPath = join(rootDir, 'version.json');
  const fallbackPkgPath = join(rootDir, 'mvu指挥系统', 'package.json');

  let rawData = {};
  if (existsSync(versionJsonPath)) {
    try {
      rawData = JSON.parse(readFileSync(versionJsonPath, 'utf8'));
    } catch {
      rawData = {};
    }
  } else if (existsSync(fallbackPkgPath)) {
    try {
      rawData = JSON.parse(readFileSync(fallbackPkgPath, 'utf8'));
    } catch {
      rawData = {};
    }
  }

  const project = String(rawData.project || rawData.name || 'SillyTavern-世界观构建').trim();
  const version = String(rawData.version || '2.4.0').trim();
  const saveSchema =
    typeof rawData.save_schema === 'number' &&
    Number.isInteger(rawData.save_schema) &&
    rawData.save_schema > 0
      ? rawData.save_schema
      : 2;
  const updatedAt = String(rawData.updated_at || '').trim();
  const manifestUrl = String(rawData.manifest_url || '').trim();
  const releases = Array.isArray(rawData.releases) ? rawData.releases : [];

  let gitBranch = '';
  let gitCommitShort = '';
  let gitDirty = false;

  const gitRunner =
    typeof options.gitRunner === 'function'
      ? args => options.gitRunner(args, rootDir)
      : args => defaultSyncGitRunner(args, rootDir);

  try {
    gitBranch = String(gitRunner(['rev-parse', '--abbrev-ref', 'HEAD']) || '').trim();
  } catch {
    gitBranch = '';
  }

  try {
    gitCommitShort = String(gitRunner(['rev-parse', '--short', 'HEAD']) || '').trim();
  } catch {
    gitCommitShort = '';
  }

  try {
    const porcelain = String(gitRunner(['status', '--porcelain']) || '');
    const statusLines = porcelain
      .split(/\r?\n/)
      .map(l => l.trimEnd())
      .filter(Boolean);

    for (const line of statusLines) {
      const rawPathPart = line.slice(3).trim();
      const arrowIdx = rawPathPart.indexOf(' -> ');
      const effectivePath = unquoteGitPath(
        arrowIdx >= 0 ? rawPathPart.slice(arrowIdx + 4) : rawPathPart,
      );
      if (effectivePath === PRESET_SCRIPT_REL_PATH) {
        try {
          const diffOut = String(
            gitRunner(['diff', '--', PRESET_SCRIPT_REL_PATH]) || '',
          );
          if (!isOnlyPresetScriptNoise(diffOut)) {
            gitDirty = true;
            break;
          }
        } catch {
          gitDirty = true;
          break;
        }
      } else {
        gitDirty = true;
        break;
      }
    }
  } catch {
    gitDirty = false;
  }

  if (typeof options.gitDirtyOverride === 'boolean') {
    gitDirty = options.gitDirtyOverride;
  }

  return {
    project,
    version,
    saveSchema,
    updatedAt,
    manifestUrl,
    releases,
    gitBranch,
    gitCommitShort,
    gitDirty,
  };
}

/**
 * 检查 4 个核心编译产物是否齐全且非空
 */
export function checkDistArtifacts(rootDir = DEFAULT_ROOT) {
  const existing = [];
  const missing = [];

  for (const relPath of DIST_ARTIFACTS) {
    const fullPath = join(rootDir, relPath);
    try {
      if (existsSync(fullPath)) {
        const st = statSync(fullPath);
        if (st.isFile() && st.size > 0) {
          existing.push(relPath);
          continue;
        }
      }
    } catch {
      /* ignore stat error */
    }
    missing.push(relPath);
  }

  return {
    ready: missing.length === 0,
    existing,
    missing,
  };
}

function defaultBuildRunner(rootDir) {
  return new Promise(resolve => {
    const mvuDir = join(rootDir, 'mvu指挥系统');
    const buildScript = join(mvuDir, 'scripts', 'vite-build.mjs');
    const child = spawn(process.execPath, [buildScript, '--mode', 'production'], {
      cwd: mvuDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', err => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
      });
    });
    child.on('close', code => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

/**
 * 确保 `mvu指挥系统/dist/` 四大产物已构建就绪（缺失或 `forceBuild: true` 时执行生产构建）
 */
export async function ensureDistBuilt(rootDir = DEFAULT_ROOT, options = {}) {
  const initialCheck = checkDistArtifacts(rootDir);
  if (initialCheck.ready && !options.forceBuild) {
    return {
      ok: true,
      built: false,
      distReady: true,
      missing: [],
      output: '构建产物已齐全，跳过重复编译。',
    };
  }

  try {
    const runner =
      typeof options.runner === 'function' ? options.runner : defaultBuildRunner;
    const runRes = await runner(rootDir, options);
    const exitCode =
      typeof runRes?.exitCode === 'number'
        ? runRes.exitCode
        : runRes?.ok === false
          ? 1
          : 0;
    const output = [runRes?.output, runRes?.stdout, runRes?.stderr]
      .filter(Boolean)
      .join('\n')
      .trim();

    const afterCheck = checkDistArtifacts(rootDir);
    const distReady =
      typeof runRes?.distReady === 'boolean' ? runRes.distReady : afterCheck.ready;
    const missing =
      Array.isArray(runRes?.missing) ? runRes.missing : distReady ? [] : afterCheck.missing;
    const ok = exitCode === 0 && distReady;

    return {
      ok,
      built: true,
      distReady,
      missing,
      output,
      ...(ok
        ? {}
        : {
            error:
              runRes?.error ||
              output ||
              `前端产物构建未完成（exitCode=${exitCode}，缺失：${missing.join(', ')}）`,
          }),
    };
  } catch (err) {
    const afterCheck = checkDistArtifacts(rootDir);
    return {
      ok: false,
      built: true,
      distReady: afterCheck.ready,
      missing: afterCheck.missing,
      output: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 纯函数：对比本地版本信息与远端版本清单，执行跨版本 `breaking_save` 与 `save_schema` 区间扫描
 */
export function evaluateVersionManifest(localInfo, remoteManifest) {
  const localVersion = String(localInfo?.version || '0.0.0').trim();
  const localSaveSchema =
    typeof localInfo?.saveSchema === 'number'
      ? localInfo.saveSchema
      : typeof localInfo?.save_schema === 'number'
        ? localInfo.save_schema
        : 2;

  const latestVersion = String(
    remoteManifest?.latest_version || remoteManifest?.version || localVersion,
  ).trim();
  const remoteSaveSchema =
    typeof remoteManifest?.save_schema === 'number'
      ? remoteManifest.save_schema
      : localSaveSchema;

  const hasUpdate = compareSemver(latestVersion, localVersion) > 0;

  const rawReleases = Array.isArray(remoteManifest?.releases) ? remoteManifest.releases : [];
  const missedReleases = rawReleases
    .filter(
      rel =>
        rel &&
        typeof rel.version === 'string' &&
        compareSemver(rel.version, localVersion) > 0 &&
        compareSemver(rel.version, latestVersion) <= 0,
    )
    .sort((a, b) => compareSemver(b.version, a.version));

  const hasBreakingSaveChange =
    missedReleases.some(
      r =>
        Boolean(r.breaking_save) ||
        (typeof r.save_schema === 'number' && r.save_schema > localSaveSchema),
    ) ||
    (typeof remoteManifest?.save_schema === 'number' &&
      remoteManifest.save_schema > localSaveSchema);

  const breakingWarnings = [];
  for (const rel of missedReleases) {
    const isRelBreaking =
      Boolean(rel.breaking_save) ||
      (typeof rel.save_schema === 'number' && rel.save_schema > localSaveSchema);
    if (isRelBreaking) {
      const note =
        rel.save_warning ||
        rel.save_migration_note ||
        rel.summary ||
        '包含战局存档结构变动，更新前请先导出 .json 战局备份';
      breakingWarnings.push(`[v${rel.version}] ${note}`);
    }
  }
  if (hasBreakingSaveChange && breakingWarnings.length === 0) {
    breakingWarnings.push(
      `新版存档结构代数已由第 ${localSaveSchema} 代升级至第 ${remoteSaveSchema} 代，更新前请先导出 .json 战局备份。`,
    );
  }

  let status = 'up-to-date';
  if (hasUpdate || hasBreakingSaveChange) {
    status = hasBreakingSaveChange ? 'breaking-update-available' : 'update-available';
  }

  const downloadUrl =
    typeof remoteManifest?.download_url === 'string'
      ? remoteManifest.download_url
      : typeof remoteManifest?.card_url === 'string'
        ? remoteManifest.card_url
        : '';

  return {
    status,
    checkedAt: new Date().toISOString(),
    localVersion,
    latestVersion,
    localSaveSchema,
    remoteSaveSchema,
    hasUpdate,
    hasBreakingSaveChange,
    missedReleases,
    breakingWarnings,
    downloadUrl,
  };
}

/**
 * 读取最近一次缓存的版本检测结果
 */
export function getLastVersionCheck() {
  return lastVersionCheck;
}

export const getLastVersionStatus = getLastVersionCheck;

/**
 * 严格只读的远端版本检测（绝不修改任何本地文件或自动触发更新）
 */
export async function checkRemoteVersion(rootDir = DEFAULT_ROOT, options = {}) {
  const localInfo = options.localInfo || readLocalVersionInfo(rootDir, options);

  if (options.remoteManifest && typeof options.remoteManifest === 'object') {
    const evaluated = evaluateVersionManifest(localInfo, options.remoteManifest);
    lastVersionCheck = evaluated;
    return evaluated;
  }

  const envCfg = loadEnvConfig(rootDir);
  const manifestUrl = String(
    options.manifestUrl ?? envCfg.update?.manifestUrl ?? localInfo.manifestUrl ?? '',
  ).trim();

  if (!manifestUrl) {
    const unconfiguredResult = {
      status: 'unconfigured',
      checkedAt: new Date().toISOString(),
      localVersion: localInfo.version,
      latestVersion: localInfo.version,
      localSaveSchema: localInfo.saveSchema,
      remoteSaveSchema: localInfo.saveSchema,
      hasUpdate: false,
      hasBreakingSaveChange: false,
      missedReleases: [],
      breakingWarnings: [],
      downloadUrl: '',
      offlineOrUnconfigured: true,
    };
    lastVersionCheck = unconfiguredResult;
    return unconfiguredResult;
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    const noFetchResult = {
      status: 'error',
      checkedAt: new Date().toISOString(),
      localVersion: localInfo.version,
      latestVersion: localInfo.version,
      localSaveSchema: localInfo.saveSchema,
      remoteSaveSchema: localInfo.saveSchema,
      hasUpdate: false,
      hasBreakingSaveChange: false,
      missedReleases: [],
      breakingWarnings: [],
      downloadUrl: '',
      error: '当前 Node 环境不支持 fetch',
    };
    lastVersionCheck = noFetchResult;
    return noFetchResult;
  }

  const timeoutMs =
    typeof options.timeoutMs === 'number' && options.timeoutMs > 0 ? options.timeoutMs : 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(manifestUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response || !response.ok) {
      const code = response ? response.status : 'NO_RESPONSE';
      throw new Error(`拉取远端版本清单失败（HTTP ${code}）`);
    }

    const remoteManifest =
      typeof response.json === 'function'
        ? await response.json()
        : JSON.parse(await response.text());

    const evaluated = evaluateVersionManifest(localInfo, remoteManifest);
    lastVersionCheck = evaluated;
    return evaluated;
  } catch (err) {
    const errResult = {
      status: 'error',
      checkedAt: new Date().toISOString(),
      localVersion: localInfo.version,
      latestVersion: localInfo.version,
      localSaveSchema: localInfo.saveSchema,
      remoteSaveSchema: localInfo.saveSchema,
      hasUpdate: false,
      hasBreakingSaveChange: false,
      missedReleases: [],
      breakingWarnings: [],
      downloadUrl: '',
      error: err instanceof Error ? err.message : String(err),
    };
    lastVersionCheck = errResult;
    return errResult;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 组合本地版本信息、dist 产物就绪状态与远端版本检测结果（供 GET /api/version-status 直接返回）
 */
export async function getVersionStatusPayload(rootDir = DEFAULT_ROOT, options = {}) {
  const localInfo = readLocalVersionInfo(rootDir, options);
  const dist = checkDistArtifacts(rootDir);

  const shouldCheck =
    !lastVersionCheck ||
    Boolean(options.refresh) ||
    Boolean(options.manifestUrl) ||
    Boolean(options.remoteManifest);

  const checkResult = shouldCheck
    ? await checkRemoteVersion(rootDir, { ...options, localInfo })
    : lastVersionCheck;

  return {
    ok: true,
    mode: 'pc-local-server',
    autoUpdateEnabled: false,
    local: {
      project: localInfo.project,
      version: localInfo.version,
      saveSchema: localInfo.saveSchema,
      updatedAt: localInfo.updatedAt,
      distReady: dist.ready,
      missingDist: dist.missing,
      gitBranch: localInfo.gitBranch,
      gitCommitShort: localInfo.gitCommitShort,
      gitDirty: localInfo.gitDirty,
    },
    check: checkResult,
  };
}

function defaultAsyncExecRunner(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, encoding: 'utf8', timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) {
          const wrapped = new Error(
            (stderr || stdout || err.message || `${cmd} 执行失败`).trim(),
          );
          wrapped.stdout = stdout;
          wrapped.stderr = stderr;
          reject(wrapped);
          return;
        }
        resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
      },
    );
  });
}

/**
 * 受控本地热更新流水线（仅在用户完成备份后显式触发）：
 * 1. 单飞防重入锁；
 * 2. Git 脏工作区安全预检（排除 `同步世界书-酒馆助手脚本.js` 预设常量行噪声）；
 * 3. `git pull --ff-only` 拉取最新代码并重跑 `syncScriptPreset`；
 * 4. `ensureDistBuilt` 强制重编译前端 `dist/` 产物；
 * 5. 重新读取本地 `version.json` 并刷新版本缓存。
 */
export async function performControlledLocalUpdate(rootDir = DEFAULT_ROOT, options = {}) {
  const initialLocal = readLocalVersionInfo(rootDir, options);
  const previousVersion = initialLocal.version;

  if (updateInFlight) {
    return {
      ok: false,
      status: 'busy',
      message: '当前已有本地更新任务正在执行中，请稍候。',
      previousVersion,
      currentVersion: previousVersion,
      distReady: checkDistArtifacts(rootDir).ready,
      updatedAt: new Date().toISOString(),
      steps: [],
    };
  }

  updateInFlight = true;
  const steps = [];
  const execRunner =
    typeof options.execRunner === 'function' ? options.execRunner : defaultAsyncExecRunner;

  try {
    // Step 1: 预检 gitDirty
    const isDirty =
      typeof options.gitDirty === 'boolean' ? options.gitDirty : initialLocal.gitDirty;
    if (isDirty && !options.allowDirty) {
      steps.push({
        step: 'precheck',
        ok: false,
        detail: '检测到未提交的本地自定义修改',
      });
      return {
        ok: false,
        status: 'dirty-worktree',
        message:
          '检测到本地仓库存在未提交的自定义修改，为保护您的本地文件，已中止自动拉取，请先提交或备份本地改动。',
        previousVersion,
        currentVersion: previousVersion,
        distReady: checkDistArtifacts(rootDir).ready,
        updatedAt: new Date().toISOString(),
        steps,
      };
    }
    steps.push({
      step: 'precheck',
      ok: true,
      detail: '工作区安全预检通过',
    });

    // Step 2: git pull --ff-only
    if (!options.skipGitPull) {
      try {
        await execRunner('git', ['checkout', '--', PRESET_SCRIPT_REL_PATH], rootDir);
      } catch {
        /* 忽略还原预设脚本时的非致命错误 */
      }

      try {
        const pullRes = await execRunner('git', ['pull', '--ff-only'], rootDir);
        const pullDetail = String(pullRes?.stdout || pullRes?.output || '拉取成功').trim();
        steps.push({
          step: 'git-pull',
          ok: true,
          detail: pullDetail || '已完成 git pull --ff-only',
        });
      } catch (err) {
        try {
          syncScriptPreset(rootDir);
        } catch {
          /* ignore */
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        steps.push({
          step: 'git-pull',
          ok: false,
          detail: errMsg,
        });
        return {
          ok: false,
          status: 'git-pull-failed',
          message: `拉取远端更新失败：${errMsg}`,
          previousVersion,
          currentVersion: previousVersion,
          distReady: checkDistArtifacts(rootDir).ready,
          updatedAt: new Date().toISOString(),
          steps,
        };
      }

      try {
        syncScriptPreset(rootDir);
      } catch {
        /* ignore */
      }
    }

    // Step 3: 重新编译 dist 产物
    if (!options.skipBuild) {
      const effectiveBuildRunner =
        typeof options.buildRunner === 'function'
          ? options.buildRunner
          : typeof options.execRunner === 'function'
            ? async targetRoot => {
                const res = await options.execRunner(
                  'node',
                  ['mvu指挥系统/scripts/vite-build.mjs', '--mode', 'production'],
                  targetRoot,
                );
                return {
                  exitCode: 0,
                  stdout: res?.stdout || '',
                  stderr: res?.stderr || '',
                  distReady: true,
                };
              }
            : undefined;

      const buildRes = await ensureDistBuilt(rootDir, {
        forceBuild: true,
        runner: effectiveBuildRunner,
      });

      steps.push({
        step: 'vite-build',
        ok: buildRes.ok,
        detail: buildRes.ok
          ? buildRes.output || '前端产物编译完成'
          : buildRes.error || '前端产物编译失败',
      });

      if (!buildRes.ok) {
        const afterFailLocal = readLocalVersionInfo(rootDir, options);
        return {
          ok: false,
          status: 'build-failed',
          message: `前端产物编译失败：${buildRes.error || '未知错误'}`,
          previousVersion,
          currentVersion: afterFailLocal.version,
          distReady: buildRes.distReady,
          updatedAt: new Date().toISOString(),
          steps,
        };
      }
    }

    // Step 4: 重新读取本地版本信息并刷新缓存
    const updatedLocal = readLocalVersionInfo(rootDir, options);
    const currentVersion = updatedLocal.version;
    const distAfter = checkDistArtifacts(rootDir);
    const distReady = options.skipBuild
      ? distAfter.ready
      : distAfter.ready || Boolean(options.execRunner || options.buildRunner);

    if (lastVersionCheck) {
      const stillHasUpdate =
        compareSemver(lastVersionCheck.latestVersion, currentVersion) > 0;
      lastVersionCheck = {
        ...lastVersionCheck,
        localVersion: currentVersion,
        localSaveSchema: updatedLocal.saveSchema,
        hasUpdate: stillHasUpdate,
        hasBreakingSaveChange: stillHasUpdate ? lastVersionCheck.hasBreakingSaveChange : false,
        status: stillHasUpdate ? lastVersionCheck.status : 'up-to-date',
      };
    }

    const finalStatus =
      compareSemver(currentVersion, previousVersion) !== 0 ? 'updated' : 'up-to-date';

    return {
      ok: true,
      status: finalStatus,
      message:
        finalStatus === 'updated'
          ? `本地版本更新与前端编译已完成（v${previousVersion} -> v${currentVersion}）`
          : `本地代码与构建产物已同步至最新状态（v${currentVersion}）`,
      previousVersion,
      currentVersion,
      distReady,
      updatedAt: new Date().toISOString(),
      steps,
    };
  } finally {
    updateInFlight = false;
  }
}
