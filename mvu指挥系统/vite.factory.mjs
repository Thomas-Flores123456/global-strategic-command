// vite.factory.mjs —— webpack.config.ts 的 Vite 等价物：入口发现 + 每入口隔离配置工厂。
//
// 产物契约（与 webpack 完全一致，不可回退）：
// - 界面入口（index.ts + index.html）→ dist/**/index.html 单文件，JS/CSS 全内联；
// - 脚本入口（仅 index.ts）→ dist/**/index.js 单文件 ESM，CSS 运行时注入；
// - 宿主全局（$/_/toastr/Vue/VueRouter/YAML/z…）与 jsdelivr CDN 外联语义逐条对齐；
// - 中控悬浮窗入口把 红警指挥系统/store.ts 重定向到只读 storeAdapter.ts（D-RAC-ENTRY-STORE-01）。
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import unpluginVueComponents from 'unplugin-vue-components/vite';
import { VueUseComponentsResolver, VueUseDirectiveResolver } from 'unplugin-vue-components/resolvers';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformWithEsbuild } from 'vite';

const require = createRequire(import.meta.url);

export const project_dir = path.dirname(fileURLToPath(import.meta.url));

const package_json = JSON.parse(fs.readFileSync(path.join(project_dir, 'package.json'), 'utf-8'));
const package_versions = { ...package_json.devDependencies, ...package_json.dependencies };

/* ---------------------------------- 入口发现 ---------------------------------- */

function parse_entry(script_file) {
  const html = path.join(path.dirname(script_file), 'index.html');
  if (fs.existsSync(html)) {
    return { script: script_file, html };
  }
  return { script: script_file };
}

function common_path(lhs, rhs) {
  const lhs_parts = lhs.split(path.sep);
  const rhs_parts = rhs.split(path.sep);
  for (let i = 0; i < Math.min(lhs_parts.length, rhs_parts.length); i++) {
    if (lhs_parts[i] !== rhs_parts[i]) {
      return lhs_parts.slice(0, i).join(path.sep);
    }
  }
  return lhs_parts.join(path.sep);
}

export function discover_entries() {
  const results = [];

  fs.globSync(`{示例,src}/**/index.{ts,tsx,js,jsx}`, { cwd: project_dir })
    .filter(file => process.env.CI !== 'true' || !fs.readFileSync(path.join(project_dir, file)).includes('@no-ci'))
    .forEach(file => {
      const file_dirname = path.dirname(file);
      for (const [index, result] of results.entries()) {
        const result_dirname = path.dirname(result);
        const common = common_path(result_dirname, file_dirname);
        if (common === result_dirname) {
          return;
        }
        if (common === file_dirname) {
          results.splice(index, 1, file);
          return;
        }
      }
      results.push(file);
    });

  return results.map(parse_entry);
}

/* ------------------------------ 宿主全局 / CDN 外联 ------------------------------ */

const GLOBAL_EXPORTS = {
  jquery: '$',
  lodash: '_',
  showdown: 'showdown',
  toastr: 'toastr',
  vue: 'Vue',
  'vue-router': 'VueRouter',
  yaml: 'YAML',
  zod: 'z',
};
const CDN_MAP = {
  sass: 'https://jspm.dev/sass',
};

const shim_code_cache = new Map();

const RESERVED_WORDS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

/**
 * 宿主全局 shim：`import { ref } from 'vue'` → `Vue.ref`。
 * 具名导出清单在构建期从本地安装的同名包枚举（语义等价 webpack var 外联的属性访问）。
 */
function build_global_shim(package_name, global_name) {
  const cache_key = `${package_name}->${global_name}`;
  if (shim_code_cache.has(cache_key)) {
    return shim_code_cache.get(cache_key);
  }

  const names = new Set();
  try {
    const mod = require(package_name);
    for (const source of [mod, mod?.default]) {
      if (source && typeof source === 'object') {
        for (const key of Object.keys(source)) {
          names.add(key);
        }
      } else if (typeof source === 'function') {
        for (const key of Object.keys(source)) {
          names.add(key);
        }
      }
    }
  } catch {
    // 未安装的包（如 showdown）：只提供 default；具名导入会在构建期显式报缺失
  }

  const lines = [`const g = globalThis[${JSON.stringify(global_name)}];`, 'export default g;'];
  for (const name of [...names].sort()) {
    if (
      name === 'default' ||
      name.startsWith('__') ||
      RESERVED_WORDS.has(name) ||
      !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ) {
      continue;
    }
    lines.push(`export const ${name} = g[${JSON.stringify(name)}];`);
  }

  const code = lines.join('\n');
  shim_code_cache.set(cache_key, code);
  return code;
}

export function tavern_externals() {
  return {
    name: 'tavern-externals',
    enforce: 'pre',
    resolveId(source, importer) {
      // 0) http(s) URL 请求（如 MVU 的 gh 外链）原样外联 —— 对齐 webpack 原生行为
      if (/^https?:/.test(source)) {
        return { id: source, external: true };
      }
      if (
        !importer ||
        !source ||
        source.startsWith('\0') ||
        source.startsWith('virtual:') ||
        source.includes('preload-helper')
      ) {
        return null;
      }
      // 1) 本地请求放行（与 webpack 判定清单一致）
      if (
        source.startsWith('-') ||
        source.startsWith('.') ||
        source.startsWith('/') ||
        source.startsWith('!') ||
        source.startsWith('@/') ||
        source.startsWith('@util/') ||
        path.isAbsolute(source) ||
        fs.existsSync(path.join(path.dirname(importer), source)) ||
        fs.existsSync(source)
      ) {
        return null;
      }
      // 2) 含 pixi/react/vue/gsap 字样的包本地打包（裸 'vue'、'vue-router' 除外，走宿主全局）
      if (
        ['vue', 'vue-router'].every(key => source !== key) &&
        ['pixi', 'react', 'vue', 'gsap'].some(key => source.includes(key))
      ) {
        return null;
      }
      // 3) 宿主全局
      if (source in GLOBAL_EXPORTS) {
        return `\0tavern-global:${source}`;
      }
      // 4) 其余裸包 → jsdelivr CDN 外联（版本取自 package.json）
      const version = package_versions[source]?.replace(/^[~^]/, '');
      const versioned_request = /^[.\d]+$/.test(version) ? `${source}@${version}` : source;
      return {
        id: CDN_MAP[source] ?? `https://testingcf.jsdelivr.net/npm/${versioned_request}/+esm`,
        external: true,
      };
    },
    load(id) {
      if (id.startsWith('\0tavern-global:')) {
        const package_name = id.slice('\0tavern-global:'.length);
        return build_global_shim(package_name, GLOBAL_EXPORTS[package_name]);
      }
      return null;
    },
  };
}

/* ------------------------- store 只读适配层重定向（悬浮窗入口） ------------------------- */

function same_file(lhs, rhs) {
  return path.resolve(lhs).toLowerCase() === path.resolve(rhs).toLowerCase();
}

export function store_adapter_redirect() {
  const store_path = path.resolve(project_dir, 'src/红警指挥系统/composables/store.ts');
  const adapter_path = path.resolve(project_dir, 'src/中控悬浮窗/host/storeAdapter.ts');

  // 注：rolldown 1.2.6 对 resolveId 返回另一绝对文件路径会触发原生崩溃（0xC0000005，已用探针定位），
  // 因此不做 id 重定向，改为在 load 钩子里把 store.ts 的模块内容替换为适配层源码——
  // 模块 id 保持 store.ts，适配层的相对导入（../红警指挥系统/…）恰好解析到同一批文件，语义等价。
  return {
    name: 'tavern-store-adapter',
    enforce: 'pre',
    load(id) {
      const [file] = id.split('?');
      if (!same_file(file, store_path)) {
        return null;
      }
      this.addWatchFile(adapter_path);
      return fs.readFileSync(adapter_path, 'utf-8');
    },
  };
}

/* --------------- webpack 特殊加载器等价物：?raw / ?url / .md / .yaml / .html 字符串 --------------- */

let postcss_plugins_promise;
function load_postcss_plugins() {
  postcss_plugins_promise ??= (async () => {
    const postcssrc = (await import('postcss-load-config')).default;
    const config = await postcssrc({}, project_dir);
    return config.plugins;
  })();
  return postcss_plugins_promise;
}

async function compile_css(file, source) {
  let css = source;
  if (file.endsWith('.scss')) {
    const sass = (await import('sass')).default;
    css = sass.compileString(source, { url: pathToFileURL(file) }).css;
  }
  const postcss = (await import('postcss')).default;
  const plugins = await load_postcss_plugins();
  return (await postcss(plugins).process(css, { from: file })).css;
}

function minimize_html(source) {
  return source
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .trim();
}

function to_data_url(file, content) {
  const mime = file.endsWith('.css') ? 'text/css' : 'text/javascript';
  return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
}

export function tavern_module_types(entry) {
  const entry_script = path.resolve(project_dir, entry.script);
  const entry_html = entry.html ? path.resolve(project_dir, entry.html) : null;
  const project_dir_posix = project_dir.replaceAll('\\', '/');

  return {
    name: 'tavern-module-types',
    enforce: 'pre',
    // html 字符串模块（html-loader 语义）：Vite 会把模块图中以 .html 结尾的 id 一律当
    // HTML 入口走 parse5（且 rolldown 对相对路径有原生快速解析，resolveId 拦不到），
    // 因此在 transform 阶段把相对 .html 导入改写为带 ?tavern_html 查询串的 id。
    transform(code, id) {
      if (!/\.(ts|tsx|js|jsx|mjs|vue)(\?|$)/.test(id) || !/\.html['"]/.test(code)) {
        return null;
      }
      const rewritten = code
        .replace(/(\bfrom\s*)(['"])(\.\.?\/[^'"]*\.html)\2/g, '$1$2$3?tavern_html$2')
        .replace(/(\bimport\s+)(['"])(\.\.?\/[^'"]*\.html)\2/g, '$1$2$3?tavern_html$2');
      return rewritten === code ? null : rewritten;
    },
    async load(id) {
      const [file, query = ''] = id.split('?');
      if (query === 'tavern_html') {
        const source = await fs.promises.readFile(file, 'utf-8');
        return `export default ${JSON.stringify(minimize_html(source))}`;
      }
      // Vite 传入的模块 id 是 posix 分隔符，project_dir 在 Windows 上是反斜杠，须统一后比较
      if (!file.replaceAll('\\', '/').startsWith(project_dir_posix)) {
        return null;
      }
      const ext = path.extname(file);

      // `?raw` on ts/scss/css：编译后的内容字符串（webpack 语义）；单文件转译，不追依赖图（当前零使用）
      if (query === 'raw' && /^\.tsx?$/.test(ext)) {
        const source = await fs.promises.readFile(file, 'utf-8');
        const { code } = await transformWithEsbuild(source, file, {
          loader: ext.slice(1),
          target: 'es2018',
          format: 'es',
        });
        return `export default ${JSON.stringify(code)}`;
      }
      if (query === 'raw' && /^\.s?css$/.test(ext)) {
        const source = await fs.promises.readFile(file, 'utf-8');
        const css = await compile_css(file, source);
        return `export default ${JSON.stringify(css)}`;
      }
      // `?url` on ts/scss/css：编译后内容的 data URL（webpack asset/inline 语义；当前零使用）
      if (query === 'url' && /^\.tsx?$/.test(ext)) {
        const source = await fs.promises.readFile(file, 'utf-8');
        const { code } = await transformWithEsbuild(source, file, {
          loader: ext.slice(1),
          target: 'es2018',
          format: 'es',
        });
        return `export default ${JSON.stringify(to_data_url(file, code))}`;
      }
      if (query === 'url' && /^\.s?css$/.test(ext)) {
        const source = await fs.promises.readFile(file, 'utf-8');
        const css = await compile_css(file, source);
        return `export default ${JSON.stringify(to_data_url(file, css))}`;
      }
      // .md → remark 转 html 字符串（remark-loader 语义）
      if (query === '' && ext === '.md') {
        const source = await fs.promises.readFile(file, 'utf-8');
        const { remark } = await import('remark');
        const remark_html = (await import('remark-html')).default;
        const processed = await remark().use(remark_html).process(source);
        return `export default ${JSON.stringify(String(processed))}`;
      }
      // .yaml → 解析对象；`?stream` → 文档数组（yaml-loader 语义）
      if (/^\.ya?ml$/.test(ext) && (query === '' || query === 'stream')) {
        const source = await fs.promises.readFile(file, 'utf-8');
        const YAML = await import('yaml');
        const docs = [...YAML.parseAllDocuments(source)].map(doc => doc.toJS());
        return `export default ${JSON.stringify(query === 'stream' ? docs : docs[0])}`;
      }
      return null;
    },
  };
}

/* ---------------------- 单文件产物：界面内联 / 脚本 CSS 运行时注入 ---------------------- */

function find_bundle_asset(bundle, href) {
  const basename = path.posix.basename(href.split('?')[0]);
  return Object.values(bundle).find(asset => asset.fileName === basename || asset.fileName.endsWith(`/${basename}`));
}

/**
 * 动态 import() 的 __vitePreload 运行时本地内联（CTRL-BUILD-VITE-VMODULE-01）。
 *
 * 根因：源码里的动态 import()（如 useParse.ts 的 `await import('./useCatalog')`）会让 vite/rolldown
 * 注入内部虚拟模块 `\0vite/preload-helper.js` 并生成
 *   `import { __vitePreload } from "https://.../npm/\0vite/preload-helper.js/+esm"`
 * 这行外联在本项目「base:'./' + 全内联单文件 + 裸包 CDN 外联」的非常规产物契约下是错误的：
 * helper 本应随包内联，却被写成 jsdelivr CDN URL（\0 编码为 %00），真机加载即 CORS 拒绝。
 *
 * 本项目产物是单文件、动态 import 的目标模块已随包内联，无需真正的资源预加载，
 * 故把 __vitePreload 降级为「本地直通」shim：`(factory) => Promise.resolve().then(factory)`
 * ——只负责按原语义异步执行工厂并返回其结果，忽略 deps 预加载参数。
 * 同时删掉那行坏的 CDN import。对界面（html 内联 chunk）与脚本（index.js）两条产物路径统一处理。
 */
const VITE_PRELOAD_CDN_IMPORT_RE =
  /import\s*(?:\{[^}]*\}\s*from\s*)?["'][^"']*preload-helper[^"']*["'];?\s*/g;
const VITE_PRELOAD_LOCAL_SHIM = 'const __vitePreload = (factory) => Promise.resolve().then(factory);\n';

function inline_vite_preload(code) {
  if (!VITE_PRELOAD_CDN_IMPORT_RE.test(code)) {
    return code;
  }
  VITE_PRELOAD_CDN_IMPORT_RE.lastIndex = 0;
  // 先删除坏的 CDN import 行，再在开头补本地 shim（放最前，保证任何 __vitePreload 引用前已声明）
  const stripped = code.replace(VITE_PRELOAD_CDN_IMPORT_RE, '');
  return VITE_PRELOAD_LOCAL_SHIM + stripped;
}

export function tavern_inline(entry) {
  const is_interface = entry.html !== undefined;

  return {
    name: 'tavern-inline',
    enforce: 'post',

    // __vitePreload 本地内联：必须在 renderChunk 阶段做——本机 rolldown 版本对 generateBundle 里
    // 改写的 chunk.code 不生效（写盘用的是 renderChunk 后的权威代码），renderChunk 的返回才是权威。
    // 界面入口的 html 内联在 generateBundle 里读 asset.code，此时已是 renderChunk 处理过的代码，故一并覆盖。
    renderChunk: {
      order: 'post',
      handler(code) {
        const next = inline_vite_preload(code);
        return next === code ? null : { code: next, map: null };
      },
    },

    // 界面入口：在 vite:build-html 扫描之前把入口 script 写进 html（HtmlWebpackPlugin 注入的等价物，不改源文件）
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (!is_interface) {
          return html;
        }
        const script_tag = `<script type="module" src="./${path.basename(entry.script)}"></script>`;
        if (html.includes('</head>')) {
          return html.replace('</head>', `${script_tag}</head>`);
        }
        if (html.includes('</body>')) {
          return html.replace('</body>', `${script_tag}</body>`);
        }
        return `${html}${script_tag}`;
      },
    },

    generateBundle(_options, bundle) {
      if (is_interface) {
        const html_name = Object.keys(bundle).find(name => name.endsWith('.html'));
        if (!html_name) {
          return;
        }
        let html = bundle[html_name].source;

        // JS 内联（防止 </script> 截断；去掉指向已删除 map 的注释）
        html = html.replace(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>\s*<\/script>/g, (match, href) => {
          const asset = find_bundle_asset(bundle, href);
          if (!asset || asset.type !== 'chunk') {
            return match;
          }
          // 确保在 generateBundle 阶段再次执行 inline_vite_preload，彻底清除任何形态的 preload-helper CDN import
          const code = inline_vite_preload(asset.code)
            .replace(/<\/script>/gi, '<\\/script>')
            .replace(/^\/\/# sourceMappingURL=.*$/m, '');
          delete bundle[asset.fileName];
          const map_name = `${asset.fileName}.map`;
          if (bundle[map_name]) {
            delete bundle[map_name];
          }
          return `<script type="module">\n${code}\n</script>`;
        });

        // CSS 内联
        html = html.replace(/<link\b[^>]*>/g, match => {
          if (!/rel=["']stylesheet["']/.test(match)) {
            return match;
          }
          const href = match.match(/href=["']([^"']+)["']/)?.[1];
          if (!href) {
            return match;
          }
          const asset = find_bundle_asset(bundle, href);
          if (!asset || asset.type !== 'asset') {
            return match;
          }
          const css = String(asset.source);
          delete bundle[asset.fileName];
          const map_name = `${asset.fileName}.map`;
          if (bundle[map_name]) {
            delete bundle[map_name];
          }
          return `<style>\n${css}\n</style>`;
        });

        // modulepreload 残留清理与最终 HTML 级 preload-helper 兜底清理
        html = inline_vite_preload(html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>\s*/g, ''));
        bundle[html_name].source = html;
      } else {
        // 脚本入口：CSS 转运行时注入（style-loader 等价）。
        // 注：__vitePreload 本地内联已在 renderChunk 阶段完成，此处仅做 CSS 注入。
        const css_names = Object.keys(bundle).filter(name => name.endsWith('.css'));
        if (!css_names.length) {
          return;
        }
        const css = css_names.map(name => String(bundle[name].source)).join('\n');
        for (const name of css_names) {
          delete bundle[name];
          if (bundle[`${name}.map`]) {
            delete bundle[`${name}.map`];
          }
        }
        const chunk = Object.values(bundle).find(asset => asset.type === 'chunk' && asset.isEntry);
        if (!chunk) {
          return;
        }
        const injection = `;(function () {\n  var css = ${JSON.stringify(css)};\n  var style = document.createElement('style');\n  style.appendChild(document.createTextNode(css));\n  document.head.appendChild(style);\n})();\n`;
        chunk.code = injection + chunk.code;
      }
    },

    // rolldown 会把已从 bundle 移除的资源照样写盘：按产物契约做最终清理，并对落盘文件做 preload-helper 终极兜底清洗
    writeBundle() {
      const out_dir = entry_out_dir(entry);
      const keep = is_interface ? name => name.endsWith('.html') : name => /^index\.js(\.map)?$/.test(name);
      for (const name of fs.existsSync(out_dir) ? fs.readdirSync(out_dir) : []) {
        const child = path.join(out_dir, name);
        if (keep(name)) {
          if (name.endsWith('.html') || name.endsWith('.js')) {
            try {
              const raw = fs.readFileSync(child, 'utf-8');
              if (raw.includes('preload-helper')) {
                const cleaned = raw.replace(
                  /import\s*(?:\{[^}]*\}\s*from\s*)?["'][^"']*preload-helper[^"']*["'];?\s*/g,
                  row => (row.includes('__vitePreload') ? VITE_PRELOAD_LOCAL_SHIM : ''),
                );
                fs.writeFileSync(child, cleaned, 'utf-8');
              }
            } catch {
              /* ignore */
            }
          }
          continue;
        }
        try {
          if (fs.lstatSync(child).isDirectory()) {
            empty_dir(child);
          } else {
            remove_file(child);
          }
        } catch (error) {
          console.warn(
            `${'\x1b[33m'}[tavern-inline]${'\x1b[0m'} 产物清理失败（请手动删除）: ${child} → ${error.message}`,
          );
        }
      }
    },
  };
}

/* ------------------------------ @obfuscate 混淆（标记触发） ------------------------------ */

async function tavern_obfuscator() {
  const JavaScriptObfuscator = (await import('javascript-obfuscator')).default;
  return {
    name: 'tavern-obfuscator',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'chunk') {
          continue;
        }
        asset.code = JavaScriptObfuscator.obfuscate(asset.code, {
          controlFlowFlattening: true,
          numbersToExpressions: true,
          selfDefending: true,
          simplify: true,
          splitStrings: true,
          seed: 1,
        }).getObfuscatedCode();
      }
    },
  };
}

/* --------------------------------- 每入口配置工厂 --------------------------------- */

export function entry_out_dir(entry) {
  const out_sub = path.relative(project_dir, path.dirname(entry.script)).replace(/^[^\\/]+[\\/]/, '');
  return path.resolve(project_dir, 'dist', out_sub);
}

/**
 * 带重试的文件删除：本机 Node 23.8.0(Windows) 的 fs.rmSync(force) 会静默无效
 * （返回成功但文件仍在），因此一律用 fs.unlinkSync；rolldown 刚写完的文件可能
 * 仍被原生层持有句柄，立即删除会瞬时失败，故带重试。
 */
export function remove_file(file, attempts = 6) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.unlinkSync(file);
      return;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      if (attempt >= attempts - 1) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 75 * (attempt + 1));
    }
  }
}

/**
 * 清空目录内容但保留目录本身：本机 Node 23.8.0(Windows) 对这些中文路径的
 * rmdir 会持续 ENOTEMPTY（rmSync(recursive) 更是原生段错误），因此完全绕开目录删除，
 * 只做文件级删除；目录本身留着不影响任何构建/同步行为。
 */
export function empty_dir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return;
  }
  for (const name of fs.readdirSync(dir)) {
    const child = path.join(dir, name);
    if (fs.lstatSync(child).isDirectory()) {
      for (const sub_name of fs.readdirSync(child)) {
        remove_file(path.join(child, sub_name));
      }
    } else {
      remove_file(child);
    }
  }
}

export async function entryConfig(entry, { mode = 'development', watch = false, on_rebuild } = {}) {
  const is_interface = entry.html !== undefined;
  const should_obfuscate = fs.readFileSync(path.join(project_dir, entry.script), 'utf-8').includes('@obfuscate');
  const redirect_store = path.normalize(entry.script).startsWith(path.normalize('src/中控悬浮窗/'));

  return {
    configFile: false,
    root: is_interface ? path.dirname(path.resolve(project_dir, entry.html)) : project_dir,
    base: './',
    publicDir: false,
    clearScreen: false,
    plugins: [
      tavern_externals(),
      tavern_module_types(entry),
      ...(redirect_store ? [store_adapter_redirect()] : []),
      vue(),
      AutoImport({
        dts: true,
        imports: [
          'vue',
          'pinia',
          '@vueuse/core',
          { from: 'dedent', imports: [['default', 'dedent']] },
          { from: 'klona', imports: ['klona'] },
          { from: 'vue-final-modal', imports: ['useModal'] },
          { from: 'zod', imports: ['z'] },
          { from: 'type-fest', imports: [['*', 'TypeFest']], type: true },
        ],
      }),
      unpluginVueComponents({
        dts: true,
        resolvers: [VueUseComponentsResolver(), VueUseDirectiveResolver()],
      }),
      ...(should_obfuscate ? [await tavern_obfuscator()] : []),
      tavern_inline(entry),
      ...(watch && on_rebuild
        ? [
            {
              name: 'tavern-watch-notify',
              closeBundle() {
                on_rebuild(entry);
              },
            },
          ]
        : []),
    ],
    resolve: {
      alias: [
        { find: '@util', replacement: path.resolve(project_dir, 'util') },
        { find: /^@\/(.*)$/, replacement: `${path.resolve(project_dir, 'src').replaceAll('\\', '/')}/$1` },
      ],
    },
    define: {
      __VUE_OPTIONS_API__: 'false',
      __VUE_PROD_DEVTOOLS__: process.env.CI === 'true' ? 'false' : 'true',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
    },
    build: {
      outDir: entry_out_dir(entry),
      emptyOutDir: true,
      target: 'es2018',
      minify: should_obfuscate ? false : mode === 'production',
      sourcemap: true,
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
      reportCompressedSize: false,
      modulePreload: { polyfill: false },
      rollupOptions: {
        input: is_interface
          ? path.resolve(project_dir, entry.html)
          : { index: path.resolve(project_dir, entry.script) },
        output: {
          format: 'es',
          entryFileNames: 'index.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: '[name][extname]',
          codeSplitting: false,
        },
      },
      watch: watch ? { exclude: ['**/node_modules/**', '**/dist/**'] } : undefined,
    },
  };
}
