/**
 * 阶段 G/P6 + CMD-LAUNCH-01 · 世界书清单、多阵营四书同步与开局体检纯函数（零宿主依赖，可 vitest 直测）
 *
 * ⚠ 驾驶员裁定铁律：绑定角色卡 ≠ 启用。
 * 启用 = 加入全局启用列表（World Info Active）：判据 `getGlobalWorldbookNames()`。
 * P7 排他同步只管理已注册世界的专属书与受管阵营四书：
 * 清单外他卡/用户自定义世界书 100% 原样保留。
 */

import { normalizeFactionId } from '../红警指挥系统/core/commandPresets';
import {
  ALLIED_WORLDBOOK_GROUP,
  allManagedEngineeringBooks,
  allManagedFactionBooks,
  allWorldExclusiveBooks,
  CORE_REQUIRED_WORLDBOOKS,
  ENGINEERING_COMMON_WORLDBOOK,
  ENGINEERING_WORLDBOOKS,
  ensureWorldbookSuffix,
  FACTION_ENGINEERING_WORLDBOOKS,
  FACTION_WORLDBOOK_GROUPS,
  getFactionWorldbookGroup,
  isEngineeringWorldbookName,
  LEGACY_DUPLICATE_WORLDBOOK_NAMES,
  MAIDEN_DOSSIER_WORLDBOOK,
  PROTOCOL_WORLDBOOK,
  SOVIET_WORLDBOOK_GROUP,
  stripWorldbookSuffix,
  WORLD_MANIFESTS,
  YURI_WORLDBOOK_GROUP,
} from './worlds';

export {
  ALLIED_WORLDBOOK_GROUP,
  allManagedEngineeringBooks,
  CORE_REQUIRED_WORLDBOOKS,
  ENGINEERING_COMMON_WORLDBOOK,
  ENGINEERING_WORLDBOOKS,
  ensureWorldbookSuffix,
  FACTION_ENGINEERING_WORLDBOOKS,
  FACTION_WORLDBOOK_GROUPS,
  getFactionWorldbookGroup,
  isEngineeringWorldbookName,
  LEGACY_DUPLICATE_WORLDBOOK_NAMES,
  MAIDEN_DOSSIER_WORLDBOOK,
  PROTOCOL_WORLDBOOK,
  SOVIET_WORLDBOOK_GROUP,
  stripWorldbookSuffix,
  YURI_WORLDBOOK_GROUP,
};

export interface ManifestBook {
  name: string;
  /** true=开局必需（缺失亮红/可修）；false=可选（如运行时归档产物，缺失仅 info） */
  required: boolean;
}

export interface WorldbookManifest {
  label: string;
  books: ManifestBook[];
}

export const WORLD_BOOK_MANIFESTS: Record<string, WorldbookManifest> = Object.fromEntries(
  Object.values(WORLD_MANIFESTS).map(world => [
    world.world_id,
    { label: world.display_name, books: world.worldbook_group.map(book => ({ ...book })) },
  ]),
);

export function getWorldManifest(worldId: string): WorldbookManifest | undefined {
  return WORLD_BOOK_MANIFESTS[worldId];
}

export interface WorldbookCheckResult {
  /** missing / unavailable / conflicting 全空才 ok（可选书不参与判定） */
  ok: boolean;
  /** 必需 + 书文件在酒馆 + 未进全局启用列表 → 可一键修复 */
  missing: string[];
  /** 必需 + 书文件不在酒馆（getWorldbookNames 查无）→ 提示需导入，不假装能修 */
  unavailable: string[];
  /** 另一已注册世界的专属书仍在全局启用列表 → 必须排他停用 */
  conflicting: string[];
  /** 可选书未启用 → info 展示，不亮红不破坏 ok */
  optionalMissing: string[];
}

export interface WorldbookSyncPlan {
  previous: string[];
  next: string[];
  /** 与 next 等价的别名，方便多阵营世界书同步调用方直接解构 */
  nextActiveGlobal?: string[];
  added?: string[];
  removed?: string[];
  unavailableRequired: string[];
  conflicting: string[];
  changed: boolean;
}

export interface FactionWorldbookSyncInput {
  worldId?: string;
  unlockedFactions: readonly string[];
  activeGlobal: readonly string[];
  available: readonly string[];
  /** 当前聊天自己的专属/档案世界书列表（如 红警档案·*、$promoted 提升档案书、$dlc 书、EVA·动态档案） */
  chatArchiveBooks?: readonly string[];
  /**
   * 工程系统（含装备改装与仓段化巨构）开关：
   * - true（或缺省未显式传 false）：按已解锁阵营启用对应《工程·*》与《工程·通用》；
   * - false（生产环境默认态）：将《工程·通用》与全部《工程·*》从全局启用列表中排他摘除。
   */
  engineeringEnabled?: boolean;
}

export const CHAT_ARCHIVE_BOOK_PREFIX = '红警档案·';

export function isChatArchiveWorldbookName(name: string): boolean {
  return typeof name === 'string' && name.trim().startsWith(CHAT_ARCHIVE_BOOK_PREFIX);
}

export interface FactionWorldbookSyncPlan extends WorldbookSyncPlan {
  nextActiveGlobal: string[];
  added: string[];
  removed: string[];
}

const MANAGED_WORLD_BOOKS = new Set<string>([
  ...Object.values(WORLD_BOOK_MANIFESTS).flatMap(manifest =>
    manifest.books.flatMap(book => [stripWorldbookSuffix(book.name), ensureWorldbookSuffix(book.name)]),
  ),
  ...CORE_REQUIRED_WORLDBOOKS.flatMap(name => [stripWorldbookSuffix(name), ensureWorldbookSuffix(name)]),
  ...LEGACY_DUPLICATE_WORLDBOOK_NAMES,
  ...allManagedFactionBooks(),
  ...allManagedEngineeringBooks(),
  stripWorldbookSuffix(PROTOCOL_WORLDBOOK),
  ensureWorldbookSuffix(PROTOCOL_WORLDBOOK),
]);

/** P7 会主动改动成员资格的已知书集合；清单外书不受管辖。 */
export function managedWorldbookNames(): Set<string> {
  return new Set(MANAGED_WORLD_BOOKS);
}

/** 忽略顺序与清单外书，只核验 P7 受管书的成员资格。 */
export function hasSameManagedWorldbooks(actual: string[], expected: string[]): boolean {
  const actualManaged = new Set(actual.filter(name => MANAGED_WORLD_BOOKS.has(name)));
  const expectedManaged = new Set(expected.filter(name => MANAGED_WORLD_BOOKS.has(name)));
  return actualManaged.size === expectedManaged.size && [...actualManaged].every(name => expectedManaged.has(name));
}

/** 恢复旧受管成员资格，但保留恢复时现场全部清单外书，避免盲写旧快照误杀新哨兵。 */
export function planManagedWorldbookRecovery(previous: string[], current: string[]): string[] {
  const previousManaged = new Set(previous.filter(name => MANAGED_WORLD_BOOKS.has(name)));
  const next = current.filter(name => !MANAGED_WORLD_BOOKS.has(name) || previousManaged.has(name));
  for (const name of previous) {
    if (MANAGED_WORLD_BOOKS.has(name) && !next.includes(name)) next.push(name);
  }
  return [...new Set(next)];
}

/**
 * 开局体检核心判定（纯函数）。
 * @param activeGlobal     全局启用列表（getGlobalWorldbookNames()）
 * @param available        酒馆全部书文件名（getWorldbookNames()，存在性判据）
 * @param unlockedFactions 可选已选阵营列表（传入时同步核验多阵营专属四书与《协议_世界书》）
 */
export function checkWorldbookActivation(
  manifest: WorldbookManifest,
  activeGlobal: string[],
  available: string[],
  unlockedFactions?: readonly string[],
): WorldbookCheckResult {
  const active = new Set(activeGlobal);
  const exists = new Set(available);
  const hasBook = (set: Set<string>, name: string) =>
    set.has(name) || set.has(ensureWorldbookSuffix(name)) || set.has(stripWorldbookSuffix(name));
  const hasInList = (list: string[], name: string) => hasBook(new Set(list), name);

  const normalizedUnlocked =
    unlockedFactions && unlockedFactions.length > 0
      ? [...new Set(unlockedFactions.map(f => normalizeFactionId(f)).filter(Boolean))]
      : [];
  const unlockedSet = new Set(normalizedUnlocked);
  const lockedFactionBooks = new Set<string>();
  if (normalizedUnlocked.length > 0) {
    for (const [factionKey, group] of Object.entries(FACTION_WORLDBOOK_GROUPS)) {
      if (!unlockedSet.has(factionKey)) {
        for (const book of group) {
          lockedFactionBooks.add(stripWorldbookSuffix(book));
          lockedFactionBooks.add(ensureWorldbookSuffix(book));
        }
      }
    }
  }

  const selected = new Set(
    manifest.books.flatMap(book => [
      book.name,
      ensureWorldbookSuffix(book.name),
      stripWorldbookSuffix(book.name),
    ]),
  );
  const missing: string[] = [];
  const unavailable: string[] = [];
  const optionalMissing: string[] = [];
  for (const book of manifest.books) {
    if (
      normalizedUnlocked.length > 0 &&
      (lockedFactionBooks.has(book.name) || lockedFactionBooks.has(ensureWorldbookSuffix(book.name)))
    ) {
      continue;
    }
    if (!book.required) {
      if (!hasBook(active, book.name)) optionalMissing.push(book.name);
    } else if (!hasBook(exists, book.name)) {
      unavailable.push(book.name);
    } else if (!hasBook(active, book.name)) {
      missing.push(book.name);
    }
  }

  const exclusive = new Set(
    allWorldExclusiveBooks().flatMap(name => [
      name,
      ensureWorldbookSuffix(name),
      stripWorldbookSuffix(name),
    ]),
  );
  const conflicting = activeGlobal.filter(name => exclusive.has(name) && !selected.has(name));

  if (normalizedUnlocked.length > 0) {
    const desiredFactionAndProtocolBooks: string[] = [];
    for (const factionId of normalizedUnlocked) {
      for (const book of getFactionWorldbookGroup(factionId)) {
        if (!desiredFactionAndProtocolBooks.includes(book)) {
          desiredFactionAndProtocolBooks.push(book);
        }
      }
    }
    if (!desiredFactionAndProtocolBooks.includes(PROTOCOL_WORLDBOOK)) {
      desiredFactionAndProtocolBooks.push(PROTOCOL_WORLDBOOK);
    }

    for (const book of desiredFactionAndProtocolBooks) {
      if (!hasBook(exists, book)) {
        if (!hasInList(unavailable, book)) unavailable.push(book);
      } else if (!hasBook(active, book)) {
        if (!hasInList(missing, book)) missing.push(book);
      }
    }

    for (const name of activeGlobal) {
      if (lockedFactionBooks.has(name) && !conflicting.includes(name)) {
        conflicting.push(name);
      }
    }
  }

  return {
    ok: missing.length === 0 && unavailable.length === 0 && conflicting.length === 0,
    missing,
    unavailable,
    conflicting,
    optionalMissing,
  };
}

/**
 * 多阵营四书与《协议_世界书》同步规划纯函数（CMD-LAUNCH-01 / DEC-04）：
 * - 计算所有已解锁阵营（`unlockedFactions`，如 `['allied', 'soviet']`）对应的专属四书并集 + 《协议_世界书》；
 * - 将未在 `unlockedFactions` 中的受管阵营专属四书从 `nextActiveGlobal` 中移除（支持 Swipe 切回未解锁分支时自动关书回退）；
 * - 100% 保留用户自定义非受管世界书。
 */
export function planFactionWorldbookSync(
  inputOrWorldId: FactionWorldbookSyncInput | string | undefined,
  unlockedFactionsArg?: readonly string[],
  activeGlobalArg?: readonly string[],
  availableArg?: readonly string[],
): FactionWorldbookSyncPlan {
  const input: FactionWorldbookSyncInput =
    typeof inputOrWorldId === 'object' && inputOrWorldId !== null
      ? inputOrWorldId
      : {
          worldId: inputOrWorldId,
          unlockedFactions: unlockedFactionsArg ?? [],
          activeGlobal: activeGlobalArg ?? [],
          available: availableArg ?? [],
        };

  const { worldId, unlockedFactions, activeGlobal, available, chatArchiveBooks, engineeringEnabled } = input;
  const isEngineeringDisabled = engineeringEnabled === false;
  const isEngineeringExplicitlyEnabled = engineeringEnabled === true;
  const exists = new Set(available);
  const activeSet = new Set(activeGlobal);

  const normalizedChatBooks = Array.isArray(chatArchiveBooks)
    ? [...new Set(chatArchiveBooks.map(b => (typeof b === 'string' ? b.trim() : '')).filter(Boolean))]
    : undefined;
  const currentChatBookSet = new Set(normalizedChatBooks ?? []);

  const normalizedUnlocked = [
    ...new Set((unlockedFactions ?? []).map(f => normalizeFactionId(f)).filter(Boolean)),
  ];
  const unlockedSet = new Set(normalizedUnlocked);

  // 未解锁阵营的受管专属四书（同时含无后缀标准名与 `_世界书` 后缀兼容名）
  // 当 engineeringEnabled === false 时，全部工程与巨构世界书（工程·通用 / 工程·盟军 / 工程·苏联 / 工程·尤里）一并进入受管停用集
  const lockedFactionBooks = new Set<string>();
  for (const [factionKey, group] of Object.entries(FACTION_WORLDBOOK_GROUPS)) {
    if (!unlockedSet.has(factionKey)) {
      for (const book of group) {
        lockedFactionBooks.add(stripWorldbookSuffix(book));
        lockedFactionBooks.add(ensureWorldbookSuffix(book));
      }
    }
  }
  if (isEngineeringDisabled) {
    for (const engBook of allManagedEngineeringBooks()) {
      lockedFactionBooks.add(engBook);
    }
  }

  // 若指定了 worldId，同时排他移除其他世界的专属书
  const manifest = worldId ? WORLD_BOOK_MANIFESTS[worldId] : undefined;
  const otherWorldExclusive = new Set<string>();
  if (manifest) {
    const selectedWorldBooks = new Set(
      manifest.books.flatMap(b => [stripWorldbookSuffix(b.name), ensureWorldbookSuffix(b.name)]),
    );
    for (const excl of allWorldExclusiveBooks()) {
      if (!selectedWorldBooks.has(excl)) {
        otherWorldExclusive.add(stripWorldbookSuffix(excl));
        otherWorldExclusive.add(ensureWorldbookSuffix(excl));
      }
    }
  }

  // 若显式提供了当前聊天的档案书集合，则排他卸载其他聊天残留的 `红警档案·*` 专属档案书，防止跨聊天串档
  const isForeignChatArchiveBook = (name: string): boolean =>
    normalizedChatBooks !== undefined &&
    isChatArchiveWorldbookName(name) &&
    !currentChatBookSet.has(name.trim());

  const conflicting = activeGlobal.filter(
    name => lockedFactionBooks.has(name) || otherWorldExclusive.has(name) || isForeignChatArchiveBook(name),
  );
  const keep = activeGlobal.filter(
    name => !lockedFactionBooks.has(name) && !otherWorldExclusive.has(name) && !isForeignChatArchiveBook(name),
  );

  const unavailableRequired: string[] = [];
  const targetBooks: string[] = [];

  // 1. 若有 worldId manifest，先纳入世界基础书（排除未解锁阵营专属书，优先无后缀同步目标名）
  if (manifest) {
    for (const book of manifest.books) {
      if (lockedFactionBooks.has(stripWorldbookSuffix(book.name)) || lockedFactionBooks.has(ensureWorldbookSuffix(book.name))) {
        continue;
      }
      const bare = stripWorldbookSuffix(book.name);
      const suffixed = ensureWorldbookSuffix(book.name);
      if (available.length === 0) {
        if (book.required || activeSet.has(bare) || activeSet.has(suffixed)) {
          targetBooks.push(activeSet.has(suffixed) && !activeSet.has(bare) ? suffixed : bare);
        }
      } else if (exists.has(bare)) {
        if (book.required || activeSet.has(bare) || activeSet.has(suffixed)) targetBooks.push(bare);
      } else if (exists.has(suffixed)) {
        if (book.required || activeSet.has(bare) || activeSet.has(suffixed)) targetBooks.push(suffixed);
      } else if (book.required) {
        unavailableRequired.push(bare);
      }
    }
  }

  // 2. 纳入全部已解锁阵营的专属四书 + 《协议》（优先对齐世界书同步服务无后缀目标名）
  //    若 engineeringEnabled === false，自动跳过所有《工程·*》世界书；
  //    若 engineeringEnabled === true 且宿主存在《工程·通用》，一并纳入《工程·通用》。
  const desiredFactionAndProtocolBooks: string[] = [];
  for (const factionId of normalizedUnlocked) {
    for (const book of getFactionWorldbookGroup(factionId)) {
      if (isEngineeringDisabled && isEngineeringWorldbookName(book)) {
        continue;
      }
      if (!desiredFactionAndProtocolBooks.includes(book)) {
        desiredFactionAndProtocolBooks.push(book);
      }
    }
  }
  if (
    isEngineeringExplicitlyEnabled &&
    (available.length === 0 ||
      exists.has(ENGINEERING_COMMON_WORLDBOOK) ||
      exists.has(ensureWorldbookSuffix(ENGINEERING_COMMON_WORLDBOOK)))
  ) {
    if (!desiredFactionAndProtocolBooks.includes(ENGINEERING_COMMON_WORLDBOOK)) {
      desiredFactionAndProtocolBooks.push(ENGINEERING_COMMON_WORLDBOOK);
    }
  }
  if (!desiredFactionAndProtocolBooks.includes(PROTOCOL_WORLDBOOK)) {
    desiredFactionAndProtocolBooks.push(PROTOCOL_WORLDBOOK);
  }

  for (const book of desiredFactionAndProtocolBooks) {
    const bare = stripWorldbookSuffix(book);
    const suffixed = ensureWorldbookSuffix(book);
    if (available.length === 0) {
      targetBooks.push(activeSet.has(suffixed) && !activeSet.has(bare) ? suffixed : bare);
    } else if (exists.has(bare)) {
      targetBooks.push(bare);
    } else if (exists.has(suffixed)) {
      targetBooks.push(suffixed);
    } else {
      unavailableRequired.push(bare);
    }
  }

  // 2.5 纳入当前聊天自己的世界书（如本聊天绑定的 红警档案·*、$promoted 提升档案书、$dlc 书、EVA·动态档案）
  if (normalizedChatBooks && normalizedChatBooks.length > 0) {
    for (const chatBook of normalizedChatBooks) {
      if (available.length === 0 || exists.has(chatBook)) {
        if (!targetBooks.includes(chatBook)) {
          targetBooks.push(chatBook);
        }
      }
    }
  }

  // 3. 去重受管同书异名（如 activeGlobal 同时残留 `武备·盟军_世界书` 与目标 `武备·盟军` 时自动剔除冗余异名）
  const chosenVariantByBare = new Map<string, string>();
  for (const chosen of targetBooks) {
    chosenVariantByBare.set(stripWorldbookSuffix(chosen), chosen);
  }
  const deduplicatedKeep = keep.filter(name => {
    if (!MANAGED_WORLD_BOOKS.has(name)) return true;
    const bare = stripWorldbookSuffix(name);
    const chosen = chosenVariantByBare.get(bare);
    if (chosen && chosen !== name) {
      if (!conflicting.includes(name)) conflicting.push(name);
      return false;
    }
    return true;
  });

  const next = [...new Set([...deduplicatedKeep, ...targetBooks])];
  const nextSet = new Set(next);
  const added = next.filter(name => !activeSet.has(name));
  const removed = activeGlobal.filter(name => !nextSet.has(name));

  return {
    previous: [...activeGlobal],
    next,
    nextActiveGlobal: [...next],
    added,
    removed,
    unavailableRequired: [...new Set(unavailableRequired)],
    conflicting: [...new Set(conflicting)],
    changed: activeSet.size !== next.length || next.some(name => !activeSet.has(name)),
  };
}

/**
 * 生成 P7 排他同步计划。只有已注册世界专属书（及传入 unlockedFactions 时的受管阵营四书）属于本函数管辖；
 * 共享书与清单外哨兵保序保留。
 * required 书文件缺失时仍返回计划信息，但调用方必须 fail-closed，禁止部分切换。
 * optional 政策：不强制启用；仅同一世界同步时保留当前已启用项。跨世界往返不记忆 optional 偏好。
 */
export function planWorldbookSync(
  manifest: WorldbookManifest,
  activeGlobal: string[],
  available: string[],
  unlockedFactions?: readonly string[],
  engineeringEnabled?: boolean,
): WorldbookSyncPlan {
  const exists = new Set(available);
  const active = new Set(activeGlobal);
  const exclusive = new Set(allWorldExclusiveBooks());
  const selected = new Set(manifest.books.map(book => book.name));
  const unavailableRequired = manifest.books
    .filter(book => book.required && !exists.has(book.name))
    .map(book => book.name);
  const conflicting = activeGlobal.filter(name => exclusive.has(name) && !selected.has(name));
  const keep = activeGlobal.filter(name => !exclusive.has(name));
  const selectedAvailable = manifest.books
    .filter(book => exists.has(book.name) && (book.required || active.has(book.name)))
    .map(book => book.name);
  let next = [...new Set([...keep, ...selectedAvailable])];

  if (unlockedFactions && unlockedFactions.length > 0) {
    const factionPlan = planFactionWorldbookSync({
      unlockedFactions,
      activeGlobal: next,
      available,
      engineeringEnabled,
    });
    // 仅当 available 中存在对应阵营书/协议书时并入 next，并移除未解锁阵营四书
    next = factionPlan.next;
    for (const c of factionPlan.conflicting) {
      if (!conflicting.includes(c)) conflicting.push(c);
    }
  }

  const currentSet = new Set(activeGlobal);
  return {
    previous: [...activeGlobal],
    next,
    nextActiveGlobal: [...next],
    unavailableRequired,
    conflicting,
    changed: currentSet.size !== next.length || next.some(name => !currentSet.has(name)),
  };
}
