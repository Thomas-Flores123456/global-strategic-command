// 起服CORS.mjs —— 零依赖静态文件服务器（带 CORS 头、内网支持与 FD-48 本地版本/受控更新 API）
// 用途：让酒馆（本地或内网端）的 iframe 能跨域拉取本目录下的 dist 产物，并提供本地版本状态查询与受控更新接口
// 用法：node 起服CORS.mjs [端口]
// 配置：支持根目录 env.yaml 配置目标网址与端口（优先级：命令行参数 > 环境变量 > env.yaml > 默认值）
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { join, normalize, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnvConfig, syncScriptPreset } from './scripts/load-env.mjs';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const envConfig = loadEnvConfig(ROOT);
syncScriptPreset(ROOT);

// 优先级：命令行参数 > 环境变量 > env.yaml > 默认 5500 / 0.0.0.0
const PORT = Number(process.argv[2]) || envConfig.cors.port || 5500;
const HOST = process.env.HOST || envConfig.host || '0.0.0.0';

const MAX_JSON_BODY_BYTES = 64 * 1024;
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

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
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
};

/**
 * 读取并解析 JSON 请求体（限制最大 64KB 防滥用）
 */
export function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  return new Promise((resolveBody, rejectBody) => {
    let totalBytes = 0;
    const chunks = [];

    req.on('data', (chunk) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        const err = new Error('Request body exceeds 64KB limit');
        err.statusCode = 413;
        req.destroy();
        rejectBody(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (chunks.length === 0) {
        resolveBody({});
        return;
      }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolveBody({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolveBody(parsed && typeof parsed === 'object' ? parsed : {});
      } catch (err) {
        const parseErr = new Error(`Invalid JSON body: ${err.message}`);
        parseErr.statusCode = 400;
        rejectBody(parseErr);
      }
    });

    req.on('error', rejectBody);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

async function loadUpdateManager() {
  return import('./scripts/local-update-manager.mjs');
}

export function createCorsServer(options = {}) {
  const rootDir = options.rootDir || ROOT;
  const activeHost = options.host || HOST;
  const activePort = options.port || PORT;

  return createServer(async (req, res) => {
    // CORS 响应头 + Chrome Private Network Access (PNA) 允许头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cache-Control', 'no-store'); // 禁缓存：pnpm build 后酒馆刷新即最新

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url, 'http://x');
      const urlPath = decodeURIComponent(url.pathname);

      // 运行环境配置端点：供前端/脚本动态探测内网目标网址与端口
      if (urlPath === '/env.json' || urlPath === '/api/env') {
        const currentConfig = loadEnvConfig(rootDir);
        sendJson(res, 200, {
          active: {
            host: activeHost,
            port: activePort,
            url:
              currentConfig.cors.configuredUrl ||
              `http://${currentConfig.primaryLanIp}:${activePort}`,
          },
          env: currentConfig,
        });
        return;
      }

      // FD-48: GET /api/version-status —— 本地版本、构建产物与远端版本检测状态
      if (req.method === 'GET' && urlPath === '/api/version-status') {
        const { getVersionStatusPayload } = await loadUpdateManager();
        const refresh = url.searchParams.get('refresh') === '1';
        const manifestUrl = url.searchParams.get('manifestUrl') || undefined;
        const payload = await getVersionStatusPayload(rootDir, {
          refresh,
          manifestUrl,
        });
        sendJson(res, 200, payload);
        return;
      }

      // FD-48: POST /api/check-update —— 立即触发远端版本检测（严格只检不更）
      if (req.method === 'POST' && urlPath === '/api/check-update') {
        const body = await readJsonBody(req);
        const { getVersionStatusPayload } = await loadUpdateManager();
        const payload = await getVersionStatusPayload(rootDir, {
          refresh: true,
          manifestUrl:
            typeof body.manifestUrl === 'string' && body.manifestUrl.trim()
              ? body.manifestUrl.trim()
              : undefined,
        });
        sendJson(res, 200, payload);
        return;
      }

      // FD-48: POST /api/local-update —— 受控本地代码拉取与重编译（必须本机回环且确认已完成战局备份）
      if (req.method === 'POST' && urlPath === '/api/local-update') {
        const body = await readJsonBody(req);
        const remoteAddr = String(req.socket?.remoteAddress || '').trim();
        const isLoopback = LOOPBACK_ADDRESSES.has(remoteAddr);
        const hasConfirmedBackup = body && body.confirmBackupCompleted === true;

        if (!isLoopback || !hasConfirmedBackup) {
          sendJson(res, 403, {
            ok: false,
            status: 'error',
            message: '拒绝未确认战局备份的更新请求',
          });
          return;
        }

        const { performControlledLocalUpdate } = await loadUpdateManager();
        const result = await performControlledLocalUpdate(rootDir, {
          allowDirty: Boolean(body.allowDirty),
        });
        sendJson(res, 200, result);
        return;
      }

      let filePath = normalize(join(rootDir, urlPath));
      if (!filePath.startsWith(normalize(rootDir))) {
        res.writeHead(403);
        res.end('403 Forbidden');
        return;
      }

      let st = await stat(filePath).catch(() => null);
      if (st?.isDirectory()) {
        filePath = join(filePath, 'index.html');
        st = await stat(filePath).catch(() => null);
      }
      if (!st?.isFile()) {
        res.writeHead(404);
        res.end('404 Not Found: ' + urlPath);
        return;
      }

      res.writeHead(200, {
        'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      });
      res.end(await readFile(filePath));
    } catch (e) {
      if (e && typeof e.statusCode === 'number') {
        sendJson(res, e.statusCode, {
          ok: false,
          status: 'error',
          message: e.message || String(e),
        });
        return;
      }
      res.writeHead(500);
      res.end(String(e));
    }
  });
}

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const server = createCorsServer({ rootDir: ROOT, host: HOST, port: PORT });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(
        `[起服CORS] 端口 ${PORT} 被占用。先关掉占用该端口的进程，或换端口：\n` +
          `  1. 命令行换端口：node 起服CORS.mjs ${PORT + 1}\n` +
          `  2. 或在 env.yaml 中修改 cors.port`,
      );
      process.exit(1);
    }
    throw e;
  });

  server.listen(PORT, HOST, () => {
    const lanLines = envConfig.lanIps.map((ip) => `  · 内网访问: http://${ip}:${PORT}/`).join('\n');
    const targetInfo = envConfig.cors.configuredUrl
      ? `  · 配置网址: ${envConfig.cors.configuredUrl}\n`
      : '';
    console.log(
      `[起服CORS] 服务启动成功 (配置源: ${envConfig.source})\n` +
        `  · 本地访问: http://127.0.0.1:${PORT}/\n` +
        (lanLines ? lanLines + '\n' : '') +
        targetInfo +
        `  · 环境端点: http://127.0.0.1:${PORT}/env.json\n` +
        `  · 版本状态: http://127.0.0.1:${PORT}/api/version-status\n` +
        `  · 根目录:   ${ROOT}\n` +
        `  · CORS已开启 (含 Access-Control-Allow-Private-Network)`,
    );
  });
}
