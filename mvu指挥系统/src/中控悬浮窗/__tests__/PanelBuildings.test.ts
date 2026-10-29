/**
 * PanelBuildings 只读 + 窄宽排版契约（D-RAC-FLOAT-READONLY-01 / F-QA-03 → A）：
 * vitest 为 node 环境且无 SFC 编译插件，这里以源码文本做静态契约检查：
 * 只读（openLookup 查阅、零 send / 写入 API）、窄宽 `@media (max-width: 239px)` 两行布局规则。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';

const SFC = readFileSync(join(__dirname, '..', 'panels/PanelBuildings.vue'), 'utf8');

/** 去掉块注释与行注释后的源码（注释里对写 API 的说明性提及不算命中） */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

describe('PanelBuildings 只读契约', () => {
  it('只做查阅：点击走 openLookup，不引入 send / sendAction / 写入 API', () => {
    expect(SFC).toMatch(/^import \{ openLookup \} from '(?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useDetail';/m);
    expect(SFC).toMatch(/@click="openLookup\(b\.name, codex\)"/);
    const code = stripComments(SFC);
    expect(code).not.toMatch(/sendAction/);
    expect(code).not.toMatch(/from '[^']*\/send'/);
    expect(code).not.toMatch(
      /createChatMessages|triggerSlash|updateWorldbookWith|createWorldbook|replaceWorldbook|deleteWorldbook|insertOrAssignVariables|replaceVariables|updateVariablesWith|deleteVariable/,
    );
  });

  it('已建计数来自 snapshot.bases[].buildings；目录来自 useCatalogStore', () => {
    expect(SFC).toMatch(/floating\.snapshot\?\.bases/);
    expect(SFC).toMatch(/base\.buildings/);
    expect(SFC).toMatch(/useCatalogStore\(\)/);
  });
});

describe('PanelBuildings 窄宽排版（F-QA-03）', () => {
  it('scoped 样式内存在 `@media (max-width: 239px)` 两行布局：名称行可换行不截断，造价·电力 + 前置第二行', () => {
    expect(SFC).toMatch(/<style scoped>/);
    const media = /@media \(max-width: 239px\)\s*\{([\s\S]*?)\n\}/.exec(SFC);
    expect(media, 'media block').not.toBeNull();
    const block = media![1];
    expect(block).toMatch(/\.bld-row\s*\{[^}]*flex-wrap:\s*wrap;?[^}]*\}/);
    expect(block).toMatch(/\.bld-col\s*\{[^}]*display:\s*contents;?[^}]*\}/);
    expect(block).toMatch(/\.bld-head\s*\{[^}]*flex:\s*1 1 100%;?[^}]*\}/);
    expect(block).toMatch(/\.bld-name\s*\{[^}]*white-space:\s*normal;?[^}]*\}/);
    expect(block).toMatch(/\.bld-meta\s*\{[^}]*order:\s*1;?[^}]*\}/);
    expect(block).toMatch(/\.bld-prereq\s*\{[^}]*order:\s*2;?[^}]*font-size:\s*10px;?[^}]*\}/);
  });

  it('模板挂钩类齐全，且宽屏基线样式（9.5px 前置 / 10px 造价）保留在媒体块之外', () => {
    for (const cls of ['bld-row', 'bld-col', 'bld-head', 'bld-name', 'bld-prereq', 'bld-meta']) {
      expect(SFC, cls).toMatch(new RegExp(`class="${cls} `));
    }
    const media = /@media \(max-width: 239px\)\s*\{[\s\S]*?\n\}/.exec(SFC)!;
    const outside = SFC.replace(media[0], '');
    expect(outside).toMatch(/\.bld-prereq\s*\{[^}]*font-size:\s*9\.5px;?[^}]*\}/);
    expect(outside).toMatch(/\.bld-meta\s*\{[^}]*font-size:\s*10px;?[^}]*\}/);
    // 不新增任何操作按钮：模板内 <button> 仅为分段折叠与 openLookup 两处
    const template = /<template>([\s\S]*?)<\/template>/.exec(SFC)![1];
    expect(template.match(/<button/g)?.length).toBe(2);
    expect(template).not.toMatch(/<input|<form|<textarea/);
  });
});
