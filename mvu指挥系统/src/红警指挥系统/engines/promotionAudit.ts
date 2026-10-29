/**
 * 提升链路只读体检（CTRL-PROMOTE-PERSIST-01 · F8 附带治理）
 *
 * - R24 空壳书：书名在册（世界书名单内）但条目为 0——F8 类「建书成功、条目未落盘」残留的只读检出；
 *   扫描范围＝全局启用列表 ∪ $promoted 目标书 ∪ 「红警扩展·」前缀书（提升产物体例），不全库扫描。
 * - R25 $promoted 悬挂：注册表记录指向的目标书已不在名单（被删/改名）——分叉警示已降级为提示；
 *   注册表是 advisory 元数据，本模块只读列出，不清理、不改写（清理由驾驶员裁决）。
 *
 * 只读：仅调用 getWorldbookNames / getGlobalWorldbookNames / getWorldbook / getVariables；
 * 无任何世界书或变量写入 API。
 */
import { promotedRecordStatus, readPromoted, type PromotedRegistry } from '../worldbook/expansionFiler';
import { tav, type CheckIssue } from '../parse/systemCheck';

export const PROMOTED_BOOK_PREFIX = '红警扩展·';

export interface PromotionAuditDeps {
  getWorldbookNames?: () => string[];
  getGlobalWorldbookNames?: () => string[];
  getWorldbook?: (name: string) => Promise<unknown[]>;
  readPromoted?: () => Promise<PromotedRegistry | null>;
}

function realDeps(): PromotionAuditDeps {
  return {
    getWorldbookNames: tav<() => string[]>('getWorldbookNames'),
    getGlobalWorldbookNames: tav<() => string[]>('getGlobalWorldbookNames'),
    getWorldbook: tav<(n: string) => Promise<unknown[]>>('getWorldbook'),
    readPromoted,
  };
}

export async function checkPromotedBooks(deps: PromotionAuditDeps = realDeps()): Promise<CheckIssue[]> {
  const { getWorldbookNames, getWorldbook } = deps;
  if (!getWorldbookNames || !getWorldbook) {
    return [{ rule: 'ENV', level: 'info', target: '提升链路', message: '独立预览环境无世界书 API，本维度跳过' }];
  }

  let names: string[];
  try {
    names = getWorldbookNames();
  } catch {
    return [{ rule: 'ENV', level: 'warn', target: '提升链路', message: '获取世界书名称列表失败' }];
  }
  const nameSet = new Set(names);

  const globals: string[] = (() => {
    try {
      return deps.getGlobalWorldbookNames?.() ?? [];
    } catch {
      return [];
    }
  })();

  const reg: PromotedRegistry | null = await (deps.readPromoted?.() ?? Promise.resolve(null)).catch(() => null);

  const issues: CheckIssue[] = [];

  // R25 $promoted 悬挂记录
  for (const [entryName, record] of Object.entries(reg ?? {})) {
    if (promotedRecordStatus(record, names) === 'dangling') {
      issues.push({
        rule: 'R25',
        level: 'info',
        target: entryName,
        message: `$promoted 悬挂记录：目标书「${record.targetBook}」已不在世界书名单（提升于 ${record.promotedAt}）——分叉警示已降级为提示；记录保留可审计，清理由驾驶员裁决`,
      });
    }
  }

  // R24 空壳书
  const candidates = new Set<string>();
  for (const g of globals) if (nameSet.has(g)) candidates.add(g);
  for (const r of Object.values(reg ?? {})) if (nameSet.has(r.targetBook)) candidates.add(r.targetBook);
  for (const n of names) if (n.startsWith(PROMOTED_BOOK_PREFIX)) candidates.add(n);

  for (const book of candidates) {
    let entries: unknown[];
    try {
      entries = await getWorldbook(book);
    } catch {
      continue;
    }
    if (!Array.isArray(entries) || entries.length === 0) {
      const where = [globals.includes(book) ? '全局启用列表' : '', '世界书名单'].filter(Boolean).join('、');
      issues.push({
        rule: 'R24',
        level: 'warn',
        target: book,
        message: `空壳书：书名在册（${where}）但条目为空——疑似提升条目未落盘（F8 类残留），删除/补录由驾驶员裁决`,
      });
    }
  }

  return issues;
}
