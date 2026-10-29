/**
 * ConsoleBuildGrid 动态图鉴去重契约（实机复现 BUGFIX）：
 * codex（楼层《图鉴》动态条目）与静态目录同名时会生成 `codex-` 前缀的第二张卡，
 * 建造面板「全部」页中同名建筑在页1（bld- 卡）与末页（codex- 卡）双份渲染。
 * 修复：codex 段先对 catalog.buildings / catalog.productions 精确名集合去重，
 * 同名跳过，目录外新条目保留。
 * vitest 为 node 环境且无 SFC 编译插件，这里以源码文本做静态契约检查（同 PanelBuildings 先例）。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { isIndividualCharacterCodexEntry } from '../console/consoleBuildGridHelpers';

const SFC = readFileSync(join(__dirname, '..', 'console/ConsoleBuildGrid.vue'), 'utf8');

describe('ConsoleBuildGrid 动态图鉴去重（codex vs catalog 同名双卡）', () => {
  it('codex 段之前构建目录名集合（buildings + productions）', () => {
    expect(SFC).toMatch(/const catalogNames = new Set<string>\(\);/);
    expect(SFC).toMatch(/for \(const b of catalog\.buildings\) catalogNames\.add\(b\.name\);/);
    expect(SFC).toMatch(/for \(const p of catalog\.productions\) catalogNames\.add\(p\.name\);/);
  });

  it('codex 循环内按精确名跳过目录已收录条目', () => {
    const codexSection = SFC.slice(SFC.indexOf('// 3. 动态条目 (codex)'));
    expect(codexSection).toMatch(/for \(const c of codex\.value\) \{\s*if \(catalogNames\.has\(c\.name\)\) continue;/);
  });

  it('去重只作用于 codex 段：catalog 两段循环不受 catalogNames 影响', () => {
    const bldSection = SFC.slice(SFC.indexOf('// 1. 建筑目录'), SFC.indexOf('// 2. 生产目录'));
    const prodSection = SFC.slice(SFC.indexOf('// 2. 生产目录'), SFC.indexOf('// 3. 动态条目'));
    expect(bldSection).not.toMatch(/catalogNames/);
    expect(prodSection).not.toMatch(/catalogNames/);
  });

  it('codex 个人角色档案（随行人类副官/参谋/机娘核心/独立人物）不会混入右侧生产面板，只有带显式造价或前置的量产单位才进入', () => {
    const knownPersons = new Set(['白凌', '喀秋莎', '尤里卡', '萧栖雪', '杜月欣', '苏晓']);
    // 1. 开局启动器写入的随行人类核心人员（含 随行渊源 / 开局职务 / 席位任命，无 造价 / 前置）
    expect(
      isIndividualCharacterCodexEntry(
        {
          name: '林晚',
          kind: '人员',
          desc: '随行参谋',
          params: {
            阵营归属: '统帅部直属',
            随行渊源: '旧部亲卫（原世界生死与共的战术班底）',
            开局职务: '情报与电子战参谋',
            席位任命: '己方随行核心人员',
            代号: 'Nightfall',
          },
        },
        knownPersons,
      ),
    ).toBe(true);

    // 2. 在编副官/机娘名单命中
    expect(
      isIndividualCharacterCodexEntry(
        {
          name: '杜月欣',
          kind: '人员',
          desc: '装甲火力与战资统筹',
          params: { 阵营归属: '统帅部直属' },
        },
        knownPersons,
      ),
    ).toBe(true);

    // 3. 任务或剧情授权列装的真实动态量产步兵（含 造价 / 前置）允许进入生产面板
    expect(
      isIndividualCharacterCodexEntry(
        {
          name: '战地重装防化兵',
          kind: '人员',
          desc: '任务授权列装单位，可在主基地对应生产建筑直接排产量产。',
          params: {
            前置: '兵营',
            造价: '450',
            来源: '任务交割·裂隙清剿',
          },
        },
        knownPersons,
      ),
    ).toBe(false);
  });
});
