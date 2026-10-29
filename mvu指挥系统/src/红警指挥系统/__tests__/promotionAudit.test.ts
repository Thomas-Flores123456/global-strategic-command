/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本，不进 bundle */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
import { describe, expect, it } from 'vitest';
import { checkPromotedBooks } from '../engines/promotionAudit';

const reg = {
  观测哨戒炮座: { targetBook: '红警扩展·观测哨戒炮座', promotedAt: '2026-09-25T04:24:50.123Z' },
  F8复现探针座: { targetBook: '红警扩展·F8复现探针座', promotedAt: '2026-09-25T15:00:00.000Z' },
};

describe('promotionAudit · R24 空壳书 / R25 $promoted 悬挂（只读）', () => {
  it('无世界书 API：ENV 降级提示', async () => {
    const r = await checkPromotedBooks({});
    expect(r).toEqual([expect.objectContaining({ rule: 'ENV', level: 'info' })]);
  });

  it('目标书已删 → R25 info；目标书在册但 0 条目 → R24 warn；有条目的书不报', async () => {
    const books: Record<string, unknown[]> = {
      '红警扩展·F8复现探针座': [],
      'F8探针·B竞态': [],
      通用·装备: [{}],
      '红警扩展·正常书': [{}],
    };
    const r = await checkPromotedBooks({
      getWorldbookNames: () => Object.keys(books),
      getGlobalWorldbookNames: () => ['通用·装备', '红警扩展·F8复现探针座', 'F8探针·B竞态'],
      getWorldbook: async n => books[n],
      readPromoted: async () => reg,
    });
    const r25 = r.filter(i => i.rule === 'R25');
    const r24 = r.filter(i => i.rule === 'R24');
    expect(r25.map(i => i.target)).toEqual(['观测哨戒炮座']);
    expect(r25[0].level).toBe('info');
    expect(r24.map(i => i.target).sort()).toEqual(['F8探针·B竞态', '红警扩展·F8复现探针座'].sort());
    expect(r24.every(i => i.level === 'warn')).toBe(true);
    expect(r24.find(i => i.target === '红警扩展·F8复现探针座')?.message).toContain('全局启用列表');
  });

  it('非全局、非提升、非「红警扩展·」前缀的空书不在扫描范围（不全库扫描）', async () => {
    const seen: string[] = [];
    const r = await checkPromotedBooks({
      getWorldbookNames: () => ['某空书', '通用·装备'],
      getGlobalWorldbookNames: () => ['通用·装备'],
      getWorldbook: async n => {
        seen.push(n);
        return n === '某空书' ? [] : [{}];
      },
      readPromoted: async () => ({}),
    });
    expect(r).toEqual([]);
    expect(seen).toEqual(['通用·装备']);
  });

  it('读书/注册表异常不抛错（advisory 降级）', async () => {
    const r = await checkPromotedBooks({
      getWorldbookNames: () => ['红警扩展·x'],
      getWorldbook: async () => {
        throw new Error('x');
      },
      readPromoted: async () => {
        throw new Error('y');
      },
    });
    expect(r).toEqual([]);
  });

  it('源码只读：不引用任何世界书/变量写入 API', async () => {
    const src = readFileSync(join(__dirname, '../engines/promotionAudit.ts'), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(code).not.toMatch(
      /createWorldbook|replaceWorldbook|updateWorldbookWith|deleteWorldbook|rebind|updateVariablesWith|replaceVariables|insertOrAssignVariables|saveWorldInfo/,
    );
  });
});
