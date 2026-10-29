import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTauriTavernExtensionBundle } from '../../../scripts/tt-build-extension.mjs';
import {
  resolveExtensionTargetDir,
  syncTauriTavernExtension,
} from '../../../../scripts/tt-ext-sync.mjs';
import {
  buildPilotEnv,
  DEFAULT_RUST_CARGO_BIN,
  runTtPilotCommand,
  runTtPilotDoctor,
} from '../../../../scripts/tt-pilot-runner.mjs';
import { installTauriTavernSimulator } from '../host/ttHostSimulator';
import { activate, deactivate, isExtensionActive } from '../ttExtensionEntry';

describe('PKG-A · ttExtensionEntry & TT-DevKit Build / Sync / Pilot Scripts', () => {
  const tempDirs: string[] = [];

  function makeTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  afterEach(() => {
    deactivate();
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.__TAURITAVERN__;
    delete g.__TAURITAVERN_MAIN_READY__;
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!;
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('1. ttExtensionEntry.ts 原生扩展激活与幂等清理生命周期', () => {
    it('等待 TauriTavern ready 后执行挂载回调，支持幂等重入与 pagehide 自动卸载', async () => {
      const sim = installTauriTavernSimulator();
      const cleanupSpy = vi.fn();
      const mountSpy = vi.fn(() => cleanupSpy);

      const handle1 = await activate({
        win: window,
        mountConsole: mountSpy,
      });

      expect(isExtensionActive()).toBe(true);
      expect(handle1.isTauriReady).toBe(true);
      expect(handle1.diagnostics.abiVersion).toBe(1);
      expect(mountSpy).toHaveBeenCalledTimes(1);

      // 重复调用 activate 默认幂等返回同一 handle
      const handle2 = await activate({
        win: window,
        mountConsole: mountSpy,
      });
      expect(handle2).toBe(handle1);
      expect(mountSpy).toHaveBeenCalledTimes(1);

      // 触发 pagehide 自动清理
      window.dispatchEvent(new Event('pagehide'));
      expect(isExtensionActive()).toBe(false);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      // 再次调用 handle1() 保持幂等
      handle1();
      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      sim.uninstall();
    });
  });

  describe('2. tt-build-extension.mjs 双栖扩展产物构建器', () => {
    it('生成符合 TauriTavern 规范的 manifest.json、index.js、style.css 及主 bundle 副本', () => {
      const tmpRoot = makeTempDir('tw-tt-build-');
      const fakeConsoleDir = path.join(tmpRoot, 'dist', '中控悬浮窗');
      fs.mkdirSync(fakeConsoleDir, { recursive: true });
      fs.writeFileSync(
        path.join(fakeConsoleDir, 'index.js'),
        'globalThis.__TW_CONSOLE_LOADED__ = true;\n',
        'utf8',
      );

      const outDir = path.join(tmpRoot, 'dist', 'tauritavern-extension');
      const res = buildTauriTavernExtensionBundle({
        projectRoot: tmpRoot,
        outDir,
      });

      expect(res.ok).toBe(true);
      expect(res.hasSourceBundle).toBe(true);
      expect(fs.existsSync(res.manifestPath)).toBe(true);
      expect(fs.existsSync(res.jsPath)).toBe(true);
      expect(fs.existsSync(res.cssPath)).toBe(true);
      expect(fs.existsSync(path.join(outDir, 'console.bundle.js'))).toBe(true);

      const manifest = JSON.parse(fs.readFileSync(res.manifestPath, 'utf8'));
      expect(manifest).toEqual({
        display_name: '全域作战指挥系统 (TavernWeave Command)',
        loading_order: 50,
        js: 'index.js',
        css: 'style.css',
        author: 'GHQ-ST-Engineering',
        version: '2.0.0',
        minimum_client_version: 'SillyTavern::TauriTavern',
        hooks: {
          activate: 'activate',
        },
      });

      const jsContent = fs.readFileSync(res.jsPath, 'utf8');
      expect(jsContent).toContain('export async function activate');
      expect(jsContent).toContain('export function deactivate');

      const cssContent = fs.readFileSync(res.cssPath, 'utf8');
      expect(cssContent).toContain('data-tt-mobile-surface="fullscreen-window"');
      expect(cssContent).toContain('--tt-viewport-bottom-inset');
    });
  });

  describe('3. scripts/tt-ext-sync.mjs 热投送与目录同步契约', () => {
    it('支持推导 TauriTavern 标准扩展目录，并正确执行 --dry-run 与 --copy 模式', () => {
      const tmpRoot = makeTempDir('tw-tt-sync-');
      const sourceDir = path.join(tmpRoot, 'source-ext');
      const fakeTtRoot = path.join(tmpRoot, 'FakeTauriTavern');

      buildTauriTavernExtensionBundle({ outDir: sourceDir });

      const expectedTarget = resolveExtensionTargetDir({ ttRoot: fakeTtRoot });
      expect(expectedTarget).toBe(
        path.join(
          fakeTtRoot,
          'data',
          'default-user',
          'extensions',
          'third-party',
          'tavernweave-command-system',
        ),
      );

      // 1. dry-run 模式不应创建目标目录
      const dryRes = syncTauriTavernExtension({
        sourceDir,
        ttRoot: fakeTtRoot,
        mode: 'copy',
        dryRun: true,
      });
      expect(dryRes.ok).toBe(true);
      expect(dryRes.dryRun).toBe(true);
      expect(fs.existsSync(expectedTarget)).toBe(false);

      // 2. copy 模式完整同步扩展文件
      const copyRes = syncTauriTavernExtension({
        sourceDir,
        ttRoot: fakeTtRoot,
        mode: 'copy',
        dryRun: false,
      });
      expect(copyRes.ok).toBe(true);
      expect(copyRes.effectiveMode).toBe('copy');
      expect(fs.existsSync(path.join(expectedTarget, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(expectedTarget, 'index.js'))).toBe(true);
      expect(fs.existsSync(path.join(expectedTarget, 'style.css'))).toBe(true);
    });
  });

  describe('4. scripts/tt-pilot-runner.mjs 工具链探测与真机巡检命令封装', () => {
    it('buildPilotEnv 自动注入 K:\\Rust\\.cargo\\bin，且 doctor 在无宿主进程时稳定输出 JSON 状态', () => {
      const env = buildPilotEnv({ PATH: 'C:\\Windows\\System32' });
      expect(env.PATH).toContain(DEFAULT_RUST_CARGO_BIN);

      const doctorRes = runTtPilotDoctor({
        ttRoot: 'K:\\NonExistentTauriTavernForTest',
        execProbe(cmd, args) {
          if (cmd === 'rustc') {
            return {
              ok: true,
              status: 0,
              stdout: 'rustc 1.86.0 (mock)',
              stderr: '',
              error: null,
            };
          }
          if (cmd === 'cargo') {
            return {
              ok: true,
              status: 0,
              stdout: 'cargo 1.86.0 (mock)',
              stderr: '',
              error: null,
            };
          }
          if (cmd === 'tauri-pilot' && args[0] === '--version') {
            return {
              ok: true,
              status: 0,
              stdout: 'tauri-pilot 0.2.0',
              stderr: '',
              error: null,
            };
          }
          return {
            ok: false,
            status: 1,
            stdout: '',
            stderr: 'pipe not found',
            error: null,
          };
        },
      });

      expect(doctorRes.ok).toBe(true);
      expect(doctorRes.command).toBe('doctor');
      expect(doctorRes.toolchain.rustc.available).toBe(true);
      expect(doctorRes.toolchain.cargo.available).toBe(true);
      expect(doctorRes.toolchain.tauriPilot.available).toBe(true);
      expect(doctorRes.liveHost.connected).toBe(false);

      // 验证 smoke 子命令在模拟连接正常时全部断言通过
      const smokeRes = runTtPilotCommand('smoke', {
        execProbe(_cmd, args) {
          if (args[0] === 'ping') {
            return { ok: true, status: 0, stdout: 'pong', stderr: '', error: null };
          }
          if (args[0] === 'eval') {
            return { ok: true, status: 0, stdout: 'true', stderr: '', error: null };
          }
          if (args[0] === 'snapshot') {
            return {
              ok: true,
              status: 0,
              stdout: '[RootWebArea]',
              stderr: '',
              error: null,
            };
          }
          return { ok: true, status: 0, stdout: '', stderr: '', error: null };
        },
      });
      expect(smokeRes.ok).toBe(true);
      expect(smokeRes.checks).toEqual({
        ping: true,
        abiVersion: true,
        mobileSurfaces: true,
        snapshotCaptured: true,
        errorLogsClean: true,
      });
    });
  });
});
