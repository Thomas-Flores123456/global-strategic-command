// scripts/vite-build.mjs —— 多入口 Vite 构建编排器（webpack 多配置数组的等价物）。
//
// 用法：
//   node scripts/vite-build.mjs --mode development [--watch] [--entry <名称子串>]
// 行为对齐 webpack.config.ts：
// - 每个发现的入口一次隔离构建，产物路径与单文件形态不变；
// - --watch：socket.io(6621) 实时监听推送 + schema.ts 变更 pnpm dump + pnpm sync watch all -f；
// - 非 watch：构建后各执行一次 pnpm dump 与 pnpm sync bundle all。
import { build } from 'vite';
import chokidar from 'chokidar';
import { exec, spawn } from 'node:child_process';
import path from 'node:path';
import lodash from 'lodash';
import { Server } from 'socket.io';
import { discover_entries, empty_dir, entry_out_dir, entryConfig, project_dir } from '../vite.factory.mjs';

const args = process.argv.slice(2);
const arg_value = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const mode = arg_value('--mode') ?? 'development';
const watch = args.includes('--watch');
const entry_filter = arg_value('--entry');

const cyan = text => `\x1b[36m${text}\x1b[0m`;
const normalize = file => file.replaceAll('\\', '/');

const entries = discover_entries().filter(entry => !entry_filter || normalize(entry.script).includes(entry_filter));
if (!entries.length) {
  console.error(`${cyan('[vite-build]')} 没有匹配的入口: ${entry_filter}`);
  process.exit(1);
}

function log_prefixed(is_error, data) {
  const text = data
    .toString()
    .trimEnd()
    .split('\n')
    .map(line => (/^\s*$/s.test(line) ? line : `${cyan('[tavern_sync]')} ${line}`))
    .join('\n');
  (is_error ? console.error : console.info)(text);
}

if (!watch) {
  const failures = [];
  for (const entry of entries) {
    try {
      // 清空该入口的产物目录（保留目录本身，规避本机 Node 23.8.0 的目录删除原生缺陷）
      empty_dir(entry_out_dir(entry));
      await build(await entryConfig(entry, { mode }));
      console.info(`${cyan('[vite-build]')} 构建成功: ${entry.script}`);
    } catch (error) {
      failures.push(entry.script);
      console.error(`${cyan('[vite-build]')} 构建失败: ${entry.script}`);
      console.error(error);
    }
  }
  exec('pnpm dump', { cwd: project_dir });
  console.info(`${cyan('[schema_dump]')} 已将所有 schema.ts 转换为 schema.json`);
  exec('pnpm sync bundle all', { cwd: project_dir });
  console.info(`${cyan('[tavern_sync]')} 已打包所有配置了的角色卡/世界书/预设`);
  if (failures.length) {
    console.error(`${cyan('[vite-build]')} ${failures.length}/${entries.length} 个入口构建失败`);
    process.exitCode = 1;
  }
  // 不 process.exit：rolldown 原生线程需要自然收尾，硬退出会触发 0xC0000005
}

/* --------------------------------- watch 模式 --------------------------------- */

if (watch) {
  const io = new Server(6621, { cors: { origin: '*' } });
  console.info(`${cyan('[tavern_helper]')} 已启动酒馆监听服务`);
  io.on('connect', socket => {
    console.info(`${cyan('[tavern_helper]')} 成功连接到酒馆网页 '${socket.id}', 初始化推送...`);
    io.emit('iframe_updated');
    socket.on('disconnect', reason => {
      console.info(`${cyan('[tavern_helper]')} 与酒馆网页 '${socket.id}' 断开连接: ${reason}`);
    });
  });

  const dump = () => {
    exec('pnpm dump', { cwd: project_dir });
    console.info(`${cyan('[schema_dump]')} 已将所有 schema.ts 转换为 schema.json`);
  };
  const dump_debounced = lodash.debounce(dump, 500, { leading: true, trailing: false });
  chokidar.watch(path.join(project_dir, 'src'), { awaitWriteFinish: true }).on('all', (_event, file) => {
    if (file.endsWith('schema.ts')) {
      dump_debounced();
    }
  });

  const child_process = spawn('pnpm', ['sync', 'watch', 'all', '-f'], {
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: project_dir,
    env: { ...process.env, FORCE_COLOR: '1' },
  });
child_process.stdout?.on('data', data => log_prefixed(false, data));
child_process.stderr?.on('data', data => log_prefixed(true, data));
child_process.on('error', error => {
  console.error(`\x1b[31m[tavern_sync]\x1b[0m Error: ${error.message}`);
});
// Windows 下 spawn(shell:true) 的 kill 只杀 cmd 壳，孙进程会泄漏占用 6620；
// 退出时用 taskkill /T 击杀整棵进程树。
const kill_sync_tree = () => {
  if (!child_process.pid || child_process.exitCode !== null) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child_process.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child_process.kill();
  }
};
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    kill_sync_tree();
    process.exit();
  });
}
process.on('exit', kill_sync_tree);

  for (const entry of entries) {
    const on_rebuild = () => {
      console.info(`\n${cyan('[tavern_helper]')} 检测到完成编译, 推送更新事件...`);
      io.emit(entry.html ? 'message_iframe_updated' : 'script_iframe_updated');
    };
  try {
    empty_dir(entry_out_dir(entry));
    const watcher = await build(await entryConfig(entry, { mode, watch: true, on_rebuild }));
    watcher?.on?.('event', event => {
      if (event.error) {
        console.error(`${cyan('[vite-build]')} 监听构建出错: ${entry.script}`);
        console.error(event.error);
      }
    });
    console.info(`${cyan('[vite-build]')} 监听已启动: ${entry.script}`);
    } catch (error) {
      console.error(`${cyan('[vite-build]')} 启动监听失败: ${entry.script}`);
      console.error(error);
      process.exitCode = 1;
    }
  }
  console.info(`${cyan('[vite-build]')} watch 就绪（${entries.length} 个入口, 酒馆监听端口 6621）`);
}
