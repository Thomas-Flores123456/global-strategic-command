/**
 * 酒馆正则静默过滤规则与通用声明式正则注册中心 (CTRL-REGEX-01 / CMD-REGEX-01)
 *
 * 核心目标：
 * 1. 过滤世界书条目内嵌的 `<数据>{ ... }</数据>` 结构块，确保发往大模型（LLM）的提示词中彻底隐身；
 * 2. 提供通用声明式正则注册表 `SYSTEM_TAVERN_REGEX_REGISTRY`，统一管理世界书数据过滤、阵营解锁卷宗卡片、航天工程合同终端等局部正则；
 * 3. 提供离线/前端展示清理纯函数 `stripWorldbookDataBlock` 与楼层卡片 iframe 壳生成函数 `buildFloorCardIframeShell`；
 * 4. 提供带自愈检测、0 写入快路径与单次批量更新幂等性的 `ensureSystemRegexRegistry` 及向后兼容的 `ensureWorldbookDataRegex`。
 */

export const SYSTEM_WORLDBOOK_DATA_REGEX_NAME = '系统·世界书量化数据隐藏';
export const SYSTEM_WORLDBOOK_DATA_REGEX_FIND = '<数据>[\\s\\S]*?<\\/数据>';
export const SYSTEM_WORLDBOOK_DATA_REGEX_ID = 'tavernweave.system.wb-data-filter.v1';
export const WORLDBOOK_DATA_BLOCK_REGEXP = /<数据>[\s\S]*?<\/数据>/g;

export const WORLDBOOK_DATA_REGEX_ID = SYSTEM_WORLDBOOK_DATA_REGEX_ID;
export const WORLDBOOK_DATA_REGEX_NAME = SYSTEM_WORLDBOOK_DATA_REGEX_NAME;
export const WORLDBOOK_DATA_FIND_REGEX = SYSTEM_WORLDBOOK_DATA_REGEX_FIND;

export const SYSTEM_WORLDBOOK_MAPPING_REGEX_NAME = '系统·世界书系统映射隐藏';
export const SYSTEM_WORLDBOOK_MAPPING_REGEX_FIND =
  '(?:^|(?:\\r?\\n)+)[ \\t]*(?:\\*+|[·\\-•]+\\s*)?(?:(?:【|\\[)\\s*系统映射\\s*(?:】|\\])|系统映射\\s*[：:])[^\\r\\n]*(?:[ \\t]*(?:\\r?\\n)+(?=$))?';
export const SYSTEM_WORLDBOOK_MAPPING_REGEX_ID = 'tavernweave.system.wb-mapping-filter.v1';
export const WORLDBOOK_MAPPING_LINE_REGEXP = new RegExp(SYSTEM_WORLDBOOK_MAPPING_REGEX_FIND, 'g');

export const WORLDBOOK_MAPPING_REGEX_ID = SYSTEM_WORLDBOOK_MAPPING_REGEX_ID;
export const WORLDBOOK_MAPPING_REGEX_NAME = SYSTEM_WORLDBOOK_MAPPING_REGEX_NAME;
export const WORLDBOOK_MAPPING_FIND_REGEX = SYSTEM_WORLDBOOK_MAPPING_REGEX_FIND;

export const PROTOCOL_TAG_UNWRAP_REGEX_ID = 'tavernweave.system.protocol-tag-unwrap.v1';
export const THINKING_INTERLEAVING_STRIP_REGEX_ID = 'tavernweave.system.thinking-interleaving-strip.v1';
export const FACTION_UNLOCK_REGEX_ID = 'tavernweave.system.faction-unlock-iframe.v1';
export const AEROSPACE_CONTRACT_REGEX_ID = 'tavernweave.system.aerospace-contract-iframe.v1';
export const MAIDEN_DOSSIER_REGEX_ID = 'tavernweave.system.maiden-dossier-iframe.v1';
export const MAIDEN_STATUS_REGEX_ID = 'tavernweave.system.maiden-status-iframe.v1';
export const CODEX_ENTRY_REGEX_ID = 'tavernweave.system.codex-entry-iframe.v1';
export const TACTICAL_EVENT_REGEX_ID = 'tavernweave.system.tactical-event-iframe.v1';
export const ENGINEERING_ORDER_REGEX_ID = 'tavernweave.system.engineering-order-iframe.v1';
export const PRODUCTION_SCHEDULE_REGEX_ID = 'tavernweave.system.production-schedule-iframe.v1';
export const INTEL_DOSSIER_REGEX_ID = 'tavernweave.system.intel-dossier-iframe.v1';
export const EXPANSION_DOSSIER_REGEX_ID = INTEL_DOSSIER_REGEX_ID;
export const DATA_PATCH_REGEX_ID = 'tavernweave.system.data-patch-iframe.v1';
export const CHRONO_STEP_REGEX_ID = 'tavernweave.system.chrono-step-iframe.v1';
export const DARKNET_TERMINAL_REGEX_ID = 'tavernweave.system.darknet-terminal-iframe.v1';
export const STORY_SUMMARY_REGEX_ID = 'tavernweave.system.story-summary-iframe.v1';
export const TACTICAL_SITUATION_REGEX_ID = 'tavernweave.system.tactical-situation-iframe.v1';
export const TACTICAL_OPTIONS_REGEX_ID = 'tavernweave.system.tactical-options-iframe.v1';
export const TACTICAL_QUEST_REGEX_ID = 'tavernweave.system.tactical-quest-iframe.v1';
export const TACTICAL_INTEL_REGEX_ID = 'tavernweave.system.tactical-intel-iframe.v1';
export const WORLD_EVOLUTION_STEALTH_REGEX_ID = 'tavernweave.system.world-evolution-stealth.v1';
export const DEPLOYMENT_ORDER_REGEX_ID = 'tavernweave.system.deployment-order-iframe.v1';
export const ECONOMY_CHAINS_REGEX_ID = 'tavernweave.system.economy-chains-iframe.v1';
export const KEMINI_SUOT_SENTINEL_CLEAN_REGEX_ID = 'tavernweave.system.kemini-suot-sentinel-clean.v1';
export const HISTORICAL_REPORT_TAGS_PROMPT_STRIP_REGEX_ID = 'tavernweave.system.historical-report-tags-strip.v1';
export const OPENING_DIRECTIVE_PROMPT_SLIM_REGEX_ID = 'tavernweave.system.opening-directive-slim.v1';
export const OPENING_LAUNCHER_REGEX_ID = 'tavernweave.system.opening-launcher.v1';
export const OPENING_LAUNCHER_REGEX_NAME = '开场启动器';
export const OPENING_LAUNCHER_FIND_REGEX = '^\\s*<launcher>[\\s\\S]*';
export const OPENING_LAUNCHER_REPLACE_STRING =
  "```\n<body>\n<script>\n$('body').load('http://localhost:5500/mvu指挥系统/dist/开场启动器/index.html')\n</script>\n</body>\n```";
export const LEGACY_STATUS_BAR_REGEX_NAME = '状态栏-实时修改';

export const FLOOR_CARD_IFRAME_REGEX_IDS = [
  FACTION_UNLOCK_REGEX_ID,
  AEROSPACE_CONTRACT_REGEX_ID,
  MAIDEN_DOSSIER_REGEX_ID,
  MAIDEN_STATUS_REGEX_ID,
  CODEX_ENTRY_REGEX_ID,
  TACTICAL_EVENT_REGEX_ID,
  ENGINEERING_ORDER_REGEX_ID,
  PRODUCTION_SCHEDULE_REGEX_ID,
  INTEL_DOSSIER_REGEX_ID,
  DATA_PATCH_REGEX_ID,
  CHRONO_STEP_REGEX_ID,
  DARKNET_TERMINAL_REGEX_ID,
  STORY_SUMMARY_REGEX_ID,
  TACTICAL_SITUATION_REGEX_ID,
  TACTICAL_OPTIONS_REGEX_ID,
  TACTICAL_QUEST_REGEX_ID,
  TACTICAL_INTEL_REGEX_ID,
  WORLD_EVOLUTION_STEALTH_REGEX_ID,
  DEPLOYMENT_ORDER_REGEX_ID,
  ECONOMY_CHAINS_REGEX_ID,
] as const;

export interface SystemRegexSpec {
  id: string;
  script_name: string;
  find_regex: string;
  replace_string: string;
  source: TavernRegex['source'];
  destination: TavernRegex['destination'];
  run_on_edit?: boolean;
  min_depth?: number | null;
  max_depth?: number | null;
}

export interface TavernRegexApiDeps {
  getTavernRegexes: (
    option?: TavernRegexOption & { scope?: 'global' | 'character' },
  ) => TavernRegex[] | Promise<TavernRegex[]>;
  updateTavernRegexesWith: (
    updater: (regexes: TavernRegex[]) => TavernRegex[] | Promise<TavernRegex[]>,
    option?: TavernRegexOption & { scope?: 'global' | 'character' },
  ) => Promise<TavernRegex[]> | TavernRegex[];
  isCharacterTavernRegexesEnabled?: () => boolean | Promise<boolean>;
  in_tavern?: boolean;
}

export interface TavernRegexDeps {
  getTavernRegexes?: (option: TavernRegexOption) => TavernRegex[];
  updateTavernRegexesWith?: (
    updater: (regexes: TavernRegex[]) => TavernRegex[] | Promise<TavernRegex[]>,
    option: TavernRegexOption,
  ) => Promise<TavernRegex[]>;
  in_tavern?: boolean;
}

export interface TavernRegexEnsureResult {
  ready: boolean;
  installed: boolean;
  updated: boolean;
}

export interface SystemRegexEnsureResult {
  ready: boolean;
  installedCount: number;
  updatedCount: number;
  characterRegexEnabled: boolean;
  reason?: string;
}

export const TOP_LEVEL_PROTOCOL_TAGS = [
  '正文',
  'summary',
  '摘要',
  '中摘要',
  '大摘要',
  'timePast',
  '战况',
  '初始状态',
  '事件',
  '图鉴',
  '机娘',
  '机娘档案',
  '扩展档案',
  '数据更新',
  '工程',
  '排产计划',
  '阵营解锁',
  '航天合同',
  '暗网',
] as const;

export type TopLevelProtocolTag = (typeof TOP_LEVEL_PROTOCOL_TAGS)[number];

const ALL_FLAT_PROTOCOL_TAGS = [
  ...TOP_LEVEL_PROTOCOL_TAGS,
  '态势',
  '战区态势',
  '环境态势',
  '环境',
  '选项',
  '行动选项',
  '决策选项',
  '任务',
  '作战任务',
  '任务指令',
  '悬赏任务',
  '情报',
  '战区情报',
  '情报电讯',
  '世界演变',
  '世界暗流',
  '宏观演变',
  '部署',
  '展开',
  'deploy',
  '资金链',
  '生产',
  '排产',
  '生产计划',
  '航天',
  '天基',
  '太空',
  '发射中心',
  '阵营启封',
  '机娘状态',
  '扩展',
  '新扩展',
  '数据补丁',
  '数据修改',
  '暗网订单',
  '暗网采购',
  '暗网交易',
  '黑市',
  '黑市订单',
  '黑市交易',
] as const;

const SORTED_PROTOCOL_TAG_PATTERN = [...ALL_FLAT_PROTOCOL_TAGS]
  .sort((a, b) => b.length - a.length)
  .join('|');

const SUB_TAG_IN_REPORT_PATTERN = ALL_FLAT_PROTOCOL_TAGS.filter(
  tag => tag !== '战况' && tag !== '态势' && tag !== '战区态势' && tag !== '环境态势' && tag !== '环境' && tag !== '初始状态',
)
  .sort((a, b) => b.length - a.length)
  .join('|');

const UNWRAP_PROTO_TAG_NAMES =
  '摘要|summary|中摘要|大摘要|timePast|态势|战区态势|环境态势|环境|战况|初始状态|阵营解锁|阵营启封|事件|情报|战区情报|情报电讯|世界演变|世界暗流|宏观演变|任务|作战任务|任务指令|悬赏任务|部署|展开|deploy|资金链|工程|排产计划|排产|生产计划|生产|航天合同|航天|天基|太空|发射中心|暗网|暗网订单|暗网采购|暗网交易|黑市|黑市订单|黑市交易|机娘档案|机娘状态|机娘|图鉴|扩展档案|扩展|新扩展|数据更新|数据补丁|数据修改|选项|行动选项|决策选项';
// 单块以同名开/闭边界为界，不允许失败时跨后续同名块重新切分。
const unwrapRawProtoBlock = (group: number) =>
  `<(${UNWRAP_PROTO_TAG_NAMES})(?:\\s[^<>]*)?>(?:(?!<\\/?\\${group}(?:\\s|>))[\\s\\S])*<\\/\\${group}>`;
const UNWRAP_CARD_HOST_BLOCK = `<div class="tw-floor-card-host"[^>]*>(?:<script(?:(?!<\\/script>)[\\s\\S])*<\\/script>)?(?:<iframe(?:(?!<\\/iframe>)[\\s\\S])*<\\/iframe>|<div class="tw-floor-mount"[^>]*><\\/div>)<\\/div>`;
const unwrapProtoSeq = (group: number) => `(?:(?:${unwrapRawProtoBlock(group)}|${UNWRAP_CARD_HOST_BLOCK})\\s*)+`;
const UNWRAP_FOREIGN_TAG_NAME = `(?!${UNWRAP_PROTO_TAG_NAMES}|details\\b|div\\b|span\\b|p\\b|script\\b|iframe\\b)[a-zA-Z0-9_\\u4e00-\\u9fa5-]+`;

// 保留兼容导出的脱壳语义（新增同名标签捕获使原替换组号后移）。内部解析不再对整段序列回溯。
export const PROTOCOL_TAG_UNWRAP_FIND_REGEX = `(?:<(${UNWRAP_FOREIGN_TAG_NAME})(?:\\s[^<>]*)?>[ \\t]*\\r?\\n?(${unwrapProtoSeq(3)})<\\/\\1>[ \\t]*\\r?\\n?((?:<\\/${UNWRAP_FOREIGN_TAG_NAME}>[ \\t]*\\r?\\n?)*))|(?:(${unwrapProtoSeq(6)})((?:<\\/${UNWRAP_FOREIGN_TAG_NAME}>[ \\t]*\\r?\\n?)+))`;
export const PROTOCOL_TAG_UNWRAP_REPLACE_STRING = '$4$7\n\n$2$5';

/**
 * 将被外部标签（如预设的 `<SUOT>...</SUOT>`、`<Interleaving>...</Interleaving>`、`<content>...</content>`、`<正文>...</正文>` 等）
 * 意外包裹的系统战报协议标签块脱壳提至顶层：
 * - 若外部标签仅包裹协议块（如 `<SUOT>\n<摘要>...</选项>\n</SUOT>`），直接剥除外部开闭标签；
 * - 若外部标签从正文开头一路包裹至协议块末尾（如 `<Interleaving>正文...<摘要>...</选项></Interleaving>`），
 *   将闭合标签提至首个协议块之前，使外部标签仅包裹正文，协议块独立处于顶层。
 */
export function unwrapProtocolBlocksFromExternalTags(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';
  // 只扫描单块，再合并相邻区间；外层闭合标签缺失时不会枚举协议序列的切分组合。
  const blockRe = new RegExp(`(?:${unwrapRawProtoBlock(1)}|${UNWRAP_CARD_HOST_BLOCK})`, 'g');
  const spans: Array<{ start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(raw)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const previous = spans[spans.length - 1];
    if (previous && /^\s*$/.test(raw.slice(previous.end, start))) previous.end = end;
    else spans.push({ start, end });
  }
  const closesRe = new RegExp(`\\s*((?:<\\/${UNWRAP_FOREIGN_TAG_NAME}>[ \\t]*\\r?\\n?)+)`, 'y');
  const firstCloseRe = new RegExp(`^<\\/(${UNWRAP_FOREIGN_TAG_NAME})>[ \\t]*\\r?\\n?`);
  const openRe = new RegExp(`<(${UNWRAP_FOREIGN_TAG_NAME})(?:\\s[^<>]*)?>[ \\t]*\\r?\\n?$`);
  const output: string[] = [];
  let cursor = 0;
  for (const span of spans) {
    closesRe.lastIndex = span.end;
    const closes = closesRe.exec(raw);
    if (!closes) continue;
    const allCloses = closes[1];
    const firstClose = firstCloseRe.exec(allCloses)!;
    const prefix = raw.slice(cursor, span.start);
    const open = openRe.exec(prefix);
    const body = raw.slice(span.start, span.end + closes[0].length - allCloses.length);
    if (open && open[1] === firstClose[1]) {
      output.push(prefix.slice(0, open.index), allCloses.slice(firstClose[0].length), '\n\n', body);
    } else {
      output.push(prefix, allCloses, '\n\n', body);
    }
    cursor = span.end + closes[0].length;
  }
  return cursor === 0 ? raw : output.join('') + raw.slice(cursor);
}

export function buildNativeFloorCardReplacement(cardType: string, titleHint = '战区人物与扩展设定建档卷宗'): string {
  return buildFloorCardIframeShell(cardType, titleHint);
}

export function buildFloorCardIframeShell(cardType: string, titleHint: string): string {
  return `\n\n<div class="tw-floor-card-host" data-tw-card="${cardType}" data-tw-title="${titleHint}" style="background:var(--tw-theme-bg,var(--rac-bg,#070c15));border:1px solid color-mix(in srgb,var(--tw-theme-accent,var(--rac-accent,#38bdf8)) 20%,transparent);"><script type="text/plain" class="tw-raw-payload">$1</script><iframe class="tw-floor-card" data-tw-card="${cardType}" title="${titleHint}" style="width:100%;min-height:40px;border:none;display:block;background:var(--tw-theme-bg,var(--rac-bg,#070c15));color-scheme:dark;" srcdoc="<!doctype html><html><head><meta charset='utf-8'></head><body style='margin:0;background:#070c15;color:#64748b;font-family:monospace,sans-serif;font-size:11.5px;padding:8px 12px;'>[${titleHint} · 正在同步参谋部卷宗...]</body></html>"></iframe></div>\n\n`;
}

/**
 * 规范化顶层平级协议标签块：
 * 1. 解嵌套提平：若 `<战况>...</战况>` 内部意外嵌套了子块（如 `<事件>...</事件>` 或 `<图鉴>...</图鉴>`），
 *    将其从 `<战况>` 内部剥离并移到 `</战况>` 之后作为顶层平级块；
 * 2. 强制空行隔离：确保任意闭合标签 `</Tag>` 与紧随其后的下一个顶层开启标签 `<NextTag>` 之间至少有 `\n\n`，
 *    彻底杜绝 Markdown 列表跨标签延续吞噬。
 */
export function normalizeFlatProtocolBlocks(raw: string): string {
  if (typeof raw !== 'string' || !raw) return '';

  const unwrapped = unwrapProtocolBlocksFromExternalTags(raw);
  const reportBlockRegex = /<(战况|态势)>([\s\S]*?)<\/\1>/g;
  const nestedSubBlockRegex = new RegExp(
    `([ \\t]*)<(${SUB_TAG_IN_REPORT_PATTERN})>([\\s\\S]*?)<\\/\\2>[ \\t]*`,
    'g',
  );

  let normalized = unwrapped.replace(reportBlockRegex, (_fullMatch, reportTag: string, innerContent: string) => {
    const extractedBlocks: string[] = [];
    const cleanedInner = innerContent.replace(
      nestedSubBlockRegex,
      (_subMatch, leadingIndent: string, tagName: string, subInner: string) => {
        let dedentedInner = subInner;
        if (leadingIndent) {
          const indentRegex = new RegExp(`^${leadingIndent}`, 'gm');
          dedentedInner = subInner.replace(indentRegex, '');
        }
        const trimmedSubInner = dedentedInner.replace(/^\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
        extractedBlocks.push(`<${tagName}>\n${trimmedSubInner}\n</${tagName}>`);
        return '';
      },
    );

    if (extractedBlocks.length === 0) {
      return `<${reportTag}>${innerContent}</${reportTag}>`;
    }

    const trimmedReportInner = cleanedInner.replace(/[ \t]+\r?\n/g, '\n').replace(/\n{2,}$/, '\n');
    const finalReportInner = trimmedReportInner.endsWith('\n')
      ? trimmedReportInner
      : `${trimmedReportInner}\n`;

    return `<${reportTag}>${finalReportInner}</${reportTag}>\n\n${extractedBlocks.join('\n\n')}`;
  });

  const boundaryRegex = new RegExp(
    `(<\\/(?:${SORTED_PROTOCOL_TAG_PATTERN})>)\\s*(?=<(?:${SORTED_PROTOCOL_TAG_PATTERN})>)`,
    'g',
  );
  normalized = normalized.replace(boundaryRegex, '$1\n\n');

  return normalized;
}

export const SYSTEM_TAVERN_REGEX_REGISTRY: readonly SystemRegexSpec[] = [
  {
    id: WORLDBOOK_DATA_REGEX_ID,
    script_name: WORLDBOOK_DATA_REGEX_NAME,
    find_regex: WORLDBOOK_DATA_FIND_REGEX,
    replace_string: '',
    source: { user_input: false, ai_output: false, slash_command: false, world_info: true, reasoning: false },
    destination: { display: false, prompt: true },
    run_on_edit: false,
  },
  {
    id: WORLDBOOK_MAPPING_REGEX_ID,
    script_name: WORLDBOOK_MAPPING_REGEX_NAME,
    find_regex: WORLDBOOK_MAPPING_FIND_REGEX,
    replace_string: '',
    source: { user_input: false, ai_output: false, slash_command: false, world_info: true, reasoning: false },
    destination: { display: false, prompt: true },
    run_on_edit: false,
  },
  {
    id: FACTION_UNLOCK_REGEX_ID,
    script_name: '系统·阵营解锁卷宗卡片挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:阵营解锁|阵营启封)>(?![`\'"）)、，])\\s*((?:(?!<(?:阵营解锁|阵营启封)>)[\\s\\S])*?)\\s*<\\/(?:阵营解锁|阵营启封)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('faction-unlock', '战区阵营编制启封卷宗'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: AEROSPACE_CONTRACT_REGEX_ID,
    script_name: '系统·航天工程合同交互终端挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:航天合同|航天|天基|太空|发射中心)>(?![`\'"）)、，])\\s*((?:(?!<(?:航天合同|航天|天基|太空|发射中心)>)[\\s\\S])*?)\\s*<\\/(?:航天合同|航天|天基|太空|发射中心)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('aerospace-contract', '战区航天工程合同拟定终端'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: MAIDEN_DOSSIER_REGEX_ID,
    script_name: '系统·机娘心智建档卷宗卡片挂载',
    find_regex: '(?<![`\'"（(、，])<机娘档案>(?![`\'"）)、，])\\s*((?:(?!<机娘档案>)[\\s\\S])*?)\\s*<\\/机娘档案>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('maiden-dossier', '战区机娘心智核心建档卷宗'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: MAIDEN_STATUS_REGEX_ID,
    script_name: '系统·机娘初诞与状态终端挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:机娘|机娘状态)>(?![`\'"）)、，])\\s*((?:(?!<(?:机娘|机娘状态)>)[\\s\\S])*?)\\s*<\\/(?:机娘|机娘状态)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('maiden-status', '战区机娘心智与状态同步终端'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: CODEX_ENTRY_REGEX_ID,
    script_name: '系统·总参装备与科技列装图鉴挂载',
    find_regex: '(?<![`\'"（(、，])<图鉴>(?![`\'"）)、，])\\s*((?:(?!<图鉴>)[\\s\\S])*?)\\s*<\\/图鉴>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('codex-entry', '总参装备与科技列装图鉴卡'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: TACTICAL_EVENT_REGEX_ID,
    script_name: '系统·战区加密态势电报卡片挂载',
    find_regex: '(?<![`\'"（(、，])<事件>(?![`\'"）)、，])\\s*((?:(?!<事件>)[\\s\\S])*?)\\s*<\\/事件>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('tactical-event', '战区最高统帅部加密电报回执'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: ENGINEERING_ORDER_REGEX_ID,
    script_name: '系统·总参重工基建蓝图终端挂载',
    find_regex: '(?<![`\'"（(、，])<工程>(?![`\'"）)、，])\\s*((?:(?!<工程>)[\\s\\S])*?)\\s*<\\/工程>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('engineering-order', '总参重工基建蓝图立项终端'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: PRODUCTION_SCHEDULE_REGEX_ID,
    script_name: '系统·兵工流水线排产调度终端挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:排产计划|排产|生产计划|生产)>(?![`\'"）)、，])\\s*((?:(?!<(?:排产计划|排产|生产计划|生产)>)[\\s\\S])*?)\\s*<\\/(?:排产计划|排产|生产计划|生产)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('production-schedule', '兵工流水线排产调度终端'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: INTEL_DOSSIER_REGEX_ID,
    script_name: '系统·战区机密情报卷宗卡片挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:扩展档案|扩展|新扩展)>(?![`\'"）)、，])\\s*((?:(?!<(?:扩展档案|扩展|新扩展)>)[\\s\\S])*?)\\s*<\\/(?:扩展档案|扩展|新扩展)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('expansion-dossier', '战区机密人物与势力情报卷宗'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: DATA_PATCH_REGEX_ID,
    script_name: '系统·纳米固件量化重构终端挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:数据更新|数据补丁|数据修改)>(?![`\'"）)、，])\\s*((?:(?!<(?:数据更新|数据补丁|数据修改)>)[\\s\\S])*?)\\s*<\\/(?:数据更新|数据补丁|数据修改)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('data-patch', '纳米固件量化重构 Diff 终端'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: CHRONO_STEP_REGEX_ID,
    script_name: '系统·战术时钟步进标尺挂载',
    find_regex: '(?:^|(?<=[\\r\\n>]))[ \\t]*<timePast>\\s*((?:(?!<timePast>)[\\s\\S])*?)\\s*<\\/timePast>[ \\t]*(?=$|[\\r\\n<])',
    replace_string: buildFloorCardIframeShell('chrono-step', '战区战术时钟步进标尺'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: DARKNET_TERMINAL_REGEX_ID,
    script_name: '系统·超维暗网终端卡片',
    find_regex:
      '\\n*(?<![`\'"（(、，])<(?:暗网|暗网订单|暗网采购|暗网交易|黑市|黑市订单|黑市交易)>(?![`\'"）)、，])((?:(?!<(?:暗网|暗网订单|暗网采购|暗网交易|黑市|黑市订单|黑市交易)>)[\\s\\S])*?)<\\/(?:暗网|暗网订单|暗网采购|暗网交易|黑市|黑市订单|黑市交易)>(?![`\'"])\\n*',
    replace_string: buildFloorCardIframeShell('darknet-terminal', '超维暗网中继终端 · 交割与拍卖回执'),
    source: { user_input: false, ai_output: true, slash_command: true, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: STORY_SUMMARY_REGEX_ID,
    script_name: '系统·战地纪要与阶段摘要胶囊挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:(?:摘要|中摘要|大摘要)(?:\\s+[^>]*)?|(?<!<details[^>]*>\\s*)summary)>(?![`\'"）)、，])\\s*((?:(?!<(?:摘要|中摘要|大摘要|summary)[>\\s])[\\s\\S])*?)\\s*<\\/(?:摘要|summary|中摘要|大摘要)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('story-summary', '战区本轮纪要与阶段卷宗'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: TACTICAL_SITUATION_REGEX_ID,
    script_name: '系统·战场环境与态势汇总卡片挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:态势|战区态势|环境态势|环境|战况|初始状态)>(?![`\'"）)、，])\\s*((?:(?!<(?:态势|战区态势|环境态势|环境|战况|初始状态)>)[\\s\\S])*?)\\s*<\\/(?:态势|战区态势|环境态势|环境|战况|初始状态)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('tactical-situation', '战区环境与态势汇总标尺'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: TACTICAL_OPTIONS_REGEX_ID,
    script_name: '系统·战术决策行动选项卡片挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:选项|行动选项|决策选项)>(?![`\'"）)、，])\\s*((?:(?!<(?:选项|行动选项|决策选项)>)[\\s\\S])*?)\\s*<\\/(?:选项|行动选项|决策选项)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('tactical-options', '战区指挥部战术决策选项'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: TACTICAL_QUEST_REGEX_ID,
    script_name: '系统·战区作战任务指令书卡片挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:任务|作战任务|任务指令|悬赏任务)>(?![`\'"）)、，])\\s*((?:(?!<(?:任务|作战任务|任务指令|悬赏任务)>)[\\s\\S])*?)\\s*<\\/(?:任务|作战任务|任务指令|悬赏任务)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('tactical-quest', '战区作战任务指令与悬赏回执'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: TACTICAL_INTEL_REGEX_ID,
    script_name: '系统内建·战区情报与世界演变卡片',
    find_regex:
      '(?<![`\'"（(、，])<(?:情报|战区情报|情报电讯)>(?![`\'"）)、，])\\s*((?:(?!<(?:情报|战区情报|情报电讯)>)[\\s\\S])*?)\\s*<\\/(?:情报|战区情报|情报电讯)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('tactical-intel', '战区情报电讯终端'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: WORLD_EVOLUTION_STEALTH_REGEX_ID,
    script_name: '系统内建 · 世界演变暗流静默隐藏',
    find_regex:
      '(?<![`\'"（(、，])<(?:世界演变|世界暗流|宏观演变)>(?![`\'"）)、，])\\s*((?:(?!<(?:世界演变|世界暗流|宏观演变)>)[\\s\\S])*?)\\s*<\\/(?:世界演变|世界暗流|宏观演变)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('world-evolution-stealth', '世界演变暗流态势'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: DEPLOYMENT_ORDER_REGEX_ID,
    script_name: '系统·战区基地车与防区部署终端挂载',
    find_regex:
      '(?<![`\'"（(、，])<(?:部署|展开|deploy)>(?![`\'"）)、，])\\s*((?:(?!<(?:部署|展开|deploy)>)[\\s\\S])*?)\\s*<\\/(?:部署|展开|deploy)>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('deployment-order', '战区基地车与防区部署回执'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: ECONOMY_CHAINS_REGEX_ID,
    script_name: '系统·战区多元资金链态势终端挂载',
    find_regex:
      '(?<![`\'"（(、，])<资金链>(?![`\'"）)、，])\\s*((?:(?!<资金链>)[\\s\\S])*?)\\s*<\\/资金链>(?![`\'"])',
    replace_string: buildFloorCardIframeShell('economy-chains', '战区多元资金链态势回执'),
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: true,
  },
  {
    id: KEMINI_SUOT_SENTINEL_CLEAN_REGEX_ID,
    script_name: '系统·Kemini预设SUOT哨兵静默清理',
    find_regex: '<SUOT\\b[^>]*>\\s*(?:done|ok|finish|completed)?\\s*<\\/SUOT>|<\\/?SUOT\\b[^>]*>',
    replace_string: '',
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: false,
    min_depth: null,
    max_depth: null,
  },
  {
    id: HISTORICAL_REPORT_TAGS_PROMPT_STRIP_REGEX_ID,
    script_name: '系统·历史楼层战报标签静默剥离',
    find_regex:
      '\\n*(?<![`\'"（(、，])<(摘要|summary|中摘要|大摘要|timePast|态势|战区态势|环境态势|环境|战况|初始状态|阵营解锁|阵营启封|事件|情报|战区情报|情报电讯|世界演变|世界暗流|宏观演变|任务|作战任务|任务指令|悬赏任务|部署|展开|deploy|资金链|工程|排产计划|排产|生产计划|生产|航天合同|航天|天基|太空|发射中心|暗网|暗网订单|暗网采购|暗网交易|黑市|黑市订单|黑市交易|机娘档案|机娘状态|机娘|图鉴|扩展档案|扩展|新扩展|数据更新|数据补丁|数据修改|选项|行动选项|决策选项)(?:\\s+[^>]*)?>(?![`\'"）)、，])(?:(?!<\\1[>\\s])[\\s\\S])*?<\\/\\1>(?![`\'"])[ \\t]*',
    replace_string: '',
    source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: false, prompt: true },
    run_on_edit: false,
    min_depth: 2,
    max_depth: null,
  },
  {
    id: OPENING_DIRECTIVE_PROMPT_SLIM_REGEX_ID,
    script_name: '系统·首幕定场指令远期静默瘦身',
    find_regex: '\\n*【(?:慢热模拟经营与渐进发育准则|首幕创作指令|首幕推演与现场请示)】[\\s\\S]*$',
    replace_string: '',
    source: { user_input: true, ai_output: false, slash_command: false, world_info: false, reasoning: false },
    destination: { display: false, prompt: true },
    run_on_edit: false,
    min_depth: 4,
    max_depth: null,
  },
  {
    id: OPENING_LAUNCHER_REGEX_ID,
    script_name: OPENING_LAUNCHER_REGEX_NAME,
    find_regex: OPENING_LAUNCHER_FIND_REGEX,
    replace_string: OPENING_LAUNCHER_REPLACE_STRING,
    source: { user_input: true, ai_output: true, slash_command: false, world_info: false, reasoning: false },
    destination: { display: true, prompt: false },
    run_on_edit: false,
    min_depth: null,
    max_depth: null,
  },
];

/**
 * 根据声明式规格 `SystemRegexSpec` 构造符合酒馆规范的局部正则对象。
 */
export function createTavernRegexFromSpec(
  spec: SystemRegexSpec,
  existing?: Partial<TavernRegex>,
): TavernRegex {
  const resolvedId =
    typeof existing?.id === 'string' && existing.id.trim().length > 0 ? existing.id : spec.id;

  return {
    id: resolvedId,
    script_name: spec.script_name,
    enabled: true,
    scope: 'character',
    find_regex: spec.find_regex,
    replace_string: spec.replace_string,
    trim_strings: [],
    source: {
      user_input: Boolean(spec.source.user_input),
      ai_output: Boolean(spec.source.ai_output),
      slash_command: Boolean(spec.source.slash_command),
      world_info: Boolean(spec.source.world_info),
      reasoning: Boolean(spec.source.reasoning),
    },
    destination: {
      display: Boolean(spec.destination.display),
      prompt: Boolean(spec.destination.prompt),
    },
    run_on_edit: spec.run_on_edit ?? false,
    min_depth: spec.min_depth ?? null,
    max_depth: spec.max_depth ?? null,
  } as TavernRegex;
}

/**
 * 校验既有正则对象是否完全匹配指定 `SystemRegexSpec` 且处于启用与角色局部作用域状态。
 */
export function isSystemRegexSpecConfigured(
  regex: Partial<TavernRegex> | null | undefined,
  spec: SystemRegexSpec,
): boolean {
  if (!regex || typeof regex !== 'object') return false;
  if (regex.enabled !== true) return false;
  const scopeVal = (regex as Partial<TavernRegex> & { scope?: string }).scope;
  if (scopeVal !== undefined && scopeVal !== 'character') return false;
  if (regex.find_regex !== spec.find_regex) return false;
  if (regex.replace_string !== spec.replace_string) return false;
  if (
    !regex.source ||
    regex.source.user_input !== spec.source.user_input ||
    regex.source.ai_output !== spec.source.ai_output ||
    regex.source.slash_command !== spec.source.slash_command ||
    regex.source.world_info !== spec.source.world_info ||
    regex.source.reasoning !== spec.source.reasoning
  ) {
    return false;
  }
  if (
    !regex.destination ||
    regex.destination.display !== spec.destination.display ||
    regex.destination.prompt !== spec.destination.prompt
  ) {
    return false;
  }
  if (spec.run_on_edit !== undefined && regex.run_on_edit !== undefined && regex.run_on_edit !== spec.run_on_edit) {
    return false;
  }
  if ((regex.min_depth ?? null) !== (spec.min_depth ?? null)) {
    return false;
  }
  if ((regex.max_depth ?? null) !== (spec.max_depth ?? null)) {
    return false;
  }
  return true;
}

/**
 * 构造标准世界书数据隐藏局部正则对象（向后兼容）。
 */
export function createWorldbookDataRegex(id: string = SYSTEM_WORLDBOOK_DATA_REGEX_ID): TavernRegex {
  return createTavernRegexFromSpec(SYSTEM_TAVERN_REGEX_REGISTRY[0], { id });
}

/**
 * 构造标准世界书系统映射隐藏局部正则对象。
 */
export function createWorldbookMappingRegex(id: string = SYSTEM_WORLDBOOK_MAPPING_REGEX_ID): TavernRegex {
  return createTavernRegexFromSpec(SYSTEM_TAVERN_REGEX_REGISTRY[1], { id });
}

/**
 * 校验既有世界书数据隐藏正则对象是否完全匹配规范且处于启用状态（向后兼容）。
 */
export function isWorldbookDataRegexConfigured(regex: TavernRegex | null | undefined): boolean {
  if (!regex || typeof regex !== 'object') return false;
  if (regex.enabled !== true) return false;
  if (regex.find_regex !== SYSTEM_WORLDBOOK_DATA_REGEX_FIND) return false;
  if (regex.replace_string !== '') return false;
  if (
    !regex.source ||
    regex.source.world_info !== true ||
    regex.source.user_input !== false ||
    regex.source.ai_output !== false ||
    regex.source.slash_command !== false ||
    regex.source.reasoning !== false
  ) {
    return false;
  }
  if (!regex.destination || regex.destination.prompt !== true || regex.destination.display !== false) {
    return false;
  }
  if (regex.run_on_edit !== false || regex.min_depth !== null || regex.max_depth !== null) {
    return false;
  }
  return true;
}

/**
 * 校验既有世界书系统映射隐藏正则对象是否完全匹配规范且处于启用状态。
 */
export function isWorldbookMappingRegexConfigured(regex: TavernRegex | null | undefined): boolean {
  if (!regex || typeof regex !== 'object') return false;
  if (regex.enabled !== true) return false;
  if (regex.find_regex !== SYSTEM_WORLDBOOK_MAPPING_REGEX_FIND) return false;
  if (regex.replace_string !== '') return false;
  if (
    !regex.source ||
    regex.source.world_info !== true ||
    regex.source.user_input !== false ||
    regex.source.ai_output !== false ||
    regex.source.slash_command !== false ||
    regex.source.reasoning !== false
  ) {
    return false;
  }
  if (!regex.destination || regex.destination.prompt !== true || regex.destination.display !== false) {
    return false;
  }
  if (regex.run_on_edit !== false || regex.min_depth !== null || regex.max_depth !== null) {
    return false;
  }
  return true;
}

/**
 * 纯函数辅助工具：直接在本地用正则 `/<数据>[\s\S]*?<\/数据>/g` 移除数据块，
 * 用于离线模拟、单测验证或前端展示前文本清理。
 */
export function stripWorldbookDataBlock(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(WORLDBOOK_DATA_BLOCK_REGEXP, '');
}

/**
 * 纯函数辅助工具：直接在本地移除世界书中的 `*系统映射：...*` 等系统映射行，
 * 用于离线模拟、单测验证或前端展示前文本清理。
 */
export function stripWorldbookSystemMapping(text: string): string {
  if (typeof text !== 'string') return '';
  return text.replace(WORLDBOOK_MAPPING_LINE_REGEXP, '');
}

/**
 * 纯函数辅助工具：一次性剥离世界书中的 `<数据>...</数据>` 与 `系统映射` 元数据行。
 */
export function stripWorldbookPromptMeta(text: string): string {
  if (typeof text !== 'string') return '';
  return stripWorldbookDataBlock(stripWorldbookSystemMapping(text)).trim();
}

/**
 * 纯函数辅助工具：将旧版 `<战况>` 局部正则中吞噬后续 `<事件>`/`<图鉴>` 等标签的尾部匹配段剥离，
 * 恢复为仅匹配 `<战况>[\s\S]*?<\/战况>` 本身的纯净正则（注意：不把 `<态势>` 路由到旧版状态栏 iframe）。
 */
export function sanitizeLegacyBattlefieldTailRegex(findRegex: string): string {
  if (typeof findRegex !== 'string') return '';
  if (
    findRegex.includes('事件|图鉴') ||
    (findRegex.includes('<战况>') && /\[\s*\\s\\S\s*\]\*\$$/.test(findRegex.trim()))
  ) {
    return findRegex.startsWith('(<战况>') ? '(<战况>[\\s\\S]*?<\\/战况>)' : '<战况>[\\s\\S]*?<\\/战况>';
  }
  if (findRegex === '<(?:战况|态势)>[\\s\\S]*?<\\/(?:战况|态势)>') {
    return '<战况>[\\s\\S]*?<\\/战况>';
  }
  return findRegex;
}

function isLegacyGreedyStatusBarRegex(item: Partial<TavernRegex> | null | undefined): boolean {
  if (!item || item.script_name !== '状态栏-实时修改' || typeof item.find_regex !== 'string') {
    return false;
  }
  return sanitizeLegacyBattlefieldTailRegex(item.find_regex) !== item.find_regex;
}

function isDeprecatedUnwrapSystemRegex(item: Partial<TavernRegex> | null | undefined): boolean {
  if (!item || typeof item !== 'object') return false;
  return (
    item.id === PROTOCOL_TAG_UNWRAP_REGEX_ID ||
    item.script_name === '系统·战报协议标签反外部包裹脱壳' ||
    item.id === THINKING_INTERLEAVING_STRIP_REGEX_ID ||
    item.script_name === '系统·思考链与交错容器前置剥离' ||
    item.script_name === LEGACY_STATUS_BAR_REGEX_NAME
  );
}

function matchesSpecIdentity(regex: Partial<TavernRegex> | null | undefined, spec: SystemRegexSpec): boolean {
  if (!regex || typeof regex !== 'object') return false;
  return regex.id === spec.id || regex.script_name === spec.script_name;
}

/**
 * 确保声明式系统正则注册表中的所有规则在角色局部正则中全部就绪（带 0 写入快路径与单次批量自愈）。
 */
export async function ensureSystemRegexRegistry(
  deps?: Partial<TavernRegexApiDeps>,
  registry: readonly SystemRegexSpec[] = SYSTEM_TAVERN_REGEX_REGISTRY,
): Promise<SystemRegexEnsureResult> {
  try {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const getFn =
      deps?.getTavernRegexes ??
      (globalThis as any).getTavernRegexes ??
      win?.TavernHelper?.getTavernRegexes;
    const updateFn =
      deps?.updateTavernRegexesWith ??
      (globalThis as any).updateTavernRegexesWith ??
      win?.TavernHelper?.updateTavernRegexesWith;
    const isEnabledFn =
      deps?.isCharacterTavernRegexesEnabled ??
      (globalThis as any).isCharacterTavernRegexesEnabled ??
      win?.TavernHelper?.isCharacterTavernRegexesEnabled;

    const inTavern =
      deps?.in_tavern ??
      ((Boolean(deps?.getTavernRegexes) && Boolean(deps?.updateTavernRegexesWith)) ||
        typeof win?.TavernHelper !== 'undefined' ||
        (typeof (globalThis as any).getTavernRegexes === 'function' &&
          typeof (globalThis as any).updateTavernRegexesWith === 'function'));

    if (!inTavern || typeof getFn !== 'function' || typeof updateFn !== 'function') {
      return {
        ready: false,
        installedCount: 0,
        updatedCount: 0,
        characterRegexEnabled: false,
        reason: 'tavern_regex_api_unavailable',
      };
    }

    let characterRegexEnabled = true;
    if (typeof isEnabledFn === 'function') {
      try {
        characterRegexEnabled = Boolean(await isEnabledFn());
      } catch {
        characterRegexEnabled = false;
      }
    }

    const existingRaw = await getFn({ scope: 'character' } as any);
    const existingList: TavernRegex[] = Array.isArray(existingRaw) ? existingRaw : [];

    let preInstalledCount = 0;
    let preUpdatedCount = 0;

    const legacyStatusBarNeedDecouple = existingList.some(item => isLegacyGreedyStatusBarRegex(item));
    if (legacyStatusBarNeedDecouple) {
      preUpdatedCount += 1;
    }

    const deprecatedUnwrapCount = existingList.filter(item => isDeprecatedUnwrapSystemRegex(item)).length;
    if (deprecatedUnwrapCount > 0) {
      preUpdatedCount += deprecatedUnwrapCount;
    }

    for (const spec of registry) {
      const existing = existingList.find(item => matchesSpecIdentity(item, spec));
      if (!existing) {
        preInstalledCount += 1;
      } else if (!isSystemRegexSpecConfigured(existing, spec)) {
        preUpdatedCount += 1;
      }
    }

    if (preInstalledCount === 0 && preUpdatedCount === 0) {
      return {
        ready: true,
        installedCount: 0,
        updatedCount: 0,
        characterRegexEnabled,
      };
    }

    let updaterRan = false;
    let runInstalledCount = 0;
    let runUpdatedCount = 0;

    await updateFn(
      (regexes: TavernRegex[]) => {
        updaterRan = true;
        runInstalledCount = 0;
        runUpdatedCount = 0;
        const list: TavernRegex[] = [];
        for (const item of Array.isArray(regexes) ? regexes : []) {
          if (isDeprecatedUnwrapSystemRegex(item)) {
            runUpdatedCount += 1;
            continue;
          }
          if (isLegacyGreedyStatusBarRegex(item)) {
            list.push({
              ...item,
              find_regex: sanitizeLegacyBattlefieldTailRegex(item.find_regex),
            });
            runUpdatedCount += 1;
            continue;
          }
          list.push(item);
        }

        for (const spec of registry) {
          const idx = list.findIndex(item => matchesSpecIdentity(item, spec));
          if (idx >= 0) {
            if (!isSystemRegexSpecConfigured(list[idx], spec)) {
              list[idx] = createTavernRegexFromSpec(spec, list[idx]);
              runUpdatedCount += 1;
            }
          } else {
            list.push(createTavernRegexFromSpec(spec));
            runInstalledCount += 1;
          }
        }

        return list;
      },
      { scope: 'character' } as any,
    );

    return {
      ready: true,
      installedCount: updaterRan ? runInstalledCount : preInstalledCount,
      updatedCount: updaterRan ? runUpdatedCount : preUpdatedCount,
      characterRegexEnabled,
    };
  } catch (err) {
    console.warn('[tavernRegexPipeline] ensureSystemRegexRegistry 异常降级:', err);
    return {
      ready: false,
      installedCount: 0,
      updatedCount: 0,
      characterRegexEnabled: false,
      reason: err instanceof Error ? err.message : 'unknown_error',
    };
  }
}

/**
 * 确保酒馆角色卡局部正则中存在并启用了世界书量化数据隐藏规则（向后兼容自愈注入与纠偏）。
 *
 * @param deps 可选注入的依赖，便于测试 mock 与 Node/浏览器环境解耦
 * @returns { ready, installed, updated } 状态元组
 */
export async function ensureWorldbookDataRegex(deps?: TavernRegexDeps): Promise<TavernRegexEnsureResult> {
  try {
    const win = typeof window !== 'undefined' ? (window as any) : undefined;
    const getFn =
      deps?.getTavernRegexes ??
      (globalThis as any).getTavernRegexes ??
      win?.TavernHelper?.getTavernRegexes;
    const updateFn =
      deps?.updateTavernRegexesWith ??
      (globalThis as any).updateTavernRegexesWith ??
      win?.TavernHelper?.updateTavernRegexesWith;

    const inTavern =
      deps?.in_tavern ??
      ((Boolean(deps?.getTavernRegexes) && Boolean(deps?.updateTavernRegexesWith)) ||
        typeof win?.TavernHelper !== 'undefined' ||
        (typeof (globalThis as any).getTavernRegexes === 'function' &&
          typeof (globalThis as any).updateTavernRegexesWith === 'function'));

    if (!inTavern || typeof getFn !== 'function' || typeof updateFn !== 'function') {
      return { ready: false, installed: false, updated: false };
    }

    const currentRegexes: TavernRegex[] = (await getFn({ type: 'character' })) ?? [];
    const target = currentRegexes.find(
      r => r && (r.script_name === SYSTEM_WORLDBOOK_DATA_REGEX_NAME || r.id === SYSTEM_WORLDBOOK_DATA_REGEX_ID),
    );

    if (target && isWorldbookDataRegexConfigured(target)) {
      return { ready: true, installed: false, updated: false };
    }

    if (!target) {
      const newRegex = createWorldbookDataRegex();
      await updateFn((regexes: TavernRegex[]) => [...(regexes ?? []), newRegex], { type: 'character' });
      return { ready: true, installed: true, updated: false };
    }

    // 已存在但配置不一致或被禁用：执行修复
    await updateFn(
      (regexes: TavernRegex[]) => {
        const list = Array.isArray(regexes) ? [...regexes] : [];
        const idx = list.findIndex(
          r => r && (r.script_name === SYSTEM_WORLDBOOK_DATA_REGEX_NAME || r.id === SYSTEM_WORLDBOOK_DATA_REGEX_ID),
        );
        const existingId = idx >= 0 ? list[idx].id : SYSTEM_WORLDBOOK_DATA_REGEX_ID;
        const repaired = createWorldbookDataRegex(existingId);
        if (idx >= 0) {
          list[idx] = repaired;
        } else {
          list.push(repaired);
        }
        return list;
      },
      { type: 'character' },
    );
    return { ready: true, installed: false, updated: true };
  } catch (err) {
    console.warn('[tavernRegexPipeline] ensureWorldbookDataRegex 异常降级:', err);
    return { ready: false, installed: false, updated: false };
  }
}
