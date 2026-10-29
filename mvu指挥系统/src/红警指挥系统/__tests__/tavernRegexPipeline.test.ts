import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AEROSPACE_CONTRACT_REGEX_ID,
  buildFloorCardIframeShell,
  createTavernRegexFromSpec,
  createWorldbookDataRegex,
  createWorldbookMappingRegex,
  DARKNET_TERMINAL_REGEX_ID,
  DATA_PATCH_REGEX_ID,
  DEPLOYMENT_ORDER_REGEX_ID,
  ECONOMY_CHAINS_REGEX_ID,
  ensureSystemRegexRegistry,
  ensureWorldbookDataRegex,
  EXPANSION_DOSSIER_REGEX_ID,
  FACTION_UNLOCK_REGEX_ID,
  FLOOR_CARD_IFRAME_REGEX_IDS,
  HISTORICAL_REPORT_TAGS_PROMPT_STRIP_REGEX_ID,
  isSystemRegexSpecConfigured,
  isWorldbookDataRegexConfigured,
  isWorldbookMappingRegexConfigured,
  MAIDEN_DOSSIER_REGEX_ID,
  MAIDEN_STATUS_REGEX_ID,
  normalizeFlatProtocolBlocks,
  OPENING_DIRECTIVE_PROMPT_SLIM_REGEX_ID,
  OPENING_LAUNCHER_FIND_REGEX,
  OPENING_LAUNCHER_REGEX_ID,
  OPENING_LAUNCHER_REGEX_NAME,
  OPENING_LAUNCHER_REPLACE_STRING,
  LEGACY_STATUS_BAR_REGEX_NAME,
  PRODUCTION_SCHEDULE_REGEX_ID,
  PROTOCOL_TAG_UNWRAP_FIND_REGEX,
  PROTOCOL_TAG_UNWRAP_REGEX_ID,
  PROTOCOL_TAG_UNWRAP_REPLACE_STRING,
  STORY_SUMMARY_REGEX_ID,
  stripWorldbookDataBlock,
  stripWorldbookPromptMeta,
  stripWorldbookSystemMapping,
  SYSTEM_TAVERN_REGEX_REGISTRY,
  SYSTEM_WORLDBOOK_DATA_REGEX_FIND,
  SYSTEM_WORLDBOOK_DATA_REGEX_ID,
  SYSTEM_WORLDBOOK_DATA_REGEX_NAME,
  SYSTEM_WORLDBOOK_MAPPING_REGEX_FIND,
  SYSTEM_WORLDBOOK_MAPPING_REGEX_ID,
  SYSTEM_WORLDBOOK_MAPPING_REGEX_NAME,
  TACTICAL_INTEL_REGEX_ID,
  TACTICAL_OPTIONS_REGEX_ID,
  TACTICAL_QUEST_REGEX_ID,
  TACTICAL_SITUATION_REGEX_ID,
  THINKING_INTERLEAVING_STRIP_REGEX_ID,
  TOP_LEVEL_PROTOCOL_TAGS,
  unwrapProtocolBlocksFromExternalTags,
  WORLD_EVOLUTION_STEALTH_REGEX_ID,
  WORLDBOOK_DATA_BLOCK_REGEXP,
  WORLDBOOK_DATA_FIND_REGEX,
  WORLDBOOK_DATA_REGEX_ID,
  WORLDBOOK_DATA_REGEX_NAME,
  WORLDBOOK_MAPPING_FIND_REGEX,
  WORLDBOOK_MAPPING_LINE_REGEXP,
  WORLDBOOK_MAPPING_REGEX_ID,
  WORLDBOOK_MAPPING_REGEX_NAME,
  type TavernRegexApiDeps,
  type TavernRegexDeps,
} from '../worldbook/tavernRegexPipeline';
import { indexFloorProtocols, TAG_TO_CARD_TYPE } from '../parse/floorProtocolIndex';
import {
  buildStorySummaryCardDom,
  parseStorySummaryCardPayload,
  parseStorySummaryPayload,
} from '../../中控悬浮窗/cards/floorCardSummary';

describe('tavernRegexPipeline · 正则定义与规范构造器', () => {
  it('导出规范常量与匹配模式', () => {
    expect(SYSTEM_WORLDBOOK_DATA_REGEX_NAME).toBe('系统·世界书量化数据隐藏');
    expect(SYSTEM_WORLDBOOK_DATA_REGEX_FIND).toBe('<数据>[\\s\\S]*?<\\/数据>');
    expect(SYSTEM_WORLDBOOK_DATA_REGEX_ID).toBe('tavernweave.system.wb-data-filter.v1');
    expect(WORLDBOOK_DATA_REGEX_ID).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_ID);
    expect(WORLDBOOK_DATA_REGEX_NAME).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_NAME);
    expect(WORLDBOOK_DATA_FIND_REGEX).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_FIND);
    expect(WORLDBOOK_DATA_BLOCK_REGEXP).toBeInstanceOf(RegExp);

    expect(SYSTEM_WORLDBOOK_MAPPING_REGEX_NAME).toBe('系统·世界书系统映射隐藏');
    expect(SYSTEM_WORLDBOOK_MAPPING_REGEX_ID).toBe('tavernweave.system.wb-mapping-filter.v1');
    expect(WORLDBOOK_MAPPING_REGEX_ID).toBe(SYSTEM_WORLDBOOK_MAPPING_REGEX_ID);
    expect(WORLDBOOK_MAPPING_REGEX_NAME).toBe(SYSTEM_WORLDBOOK_MAPPING_REGEX_NAME);
    expect(WORLDBOOK_MAPPING_FIND_REGEX).toBe(SYSTEM_WORLDBOOK_MAPPING_REGEX_FIND);
    expect(WORLDBOOK_MAPPING_LINE_REGEXP).toBeInstanceOf(RegExp);
  });

  it('createWorldbookDataRegex 构造符合 TavernRegex 规范的默认对象', () => {
    const regex = createWorldbookDataRegex();

    expect(regex.id).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_ID);
    expect(regex.script_name).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_NAME);
    expect(regex.enabled).toBe(true);
    expect(regex.find_regex).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_FIND);
    expect(regex.replace_string).toBe('');
    expect(regex.trim_strings).toEqual([]);
    expect(regex.run_on_edit).toBe(false);
    expect(regex.min_depth).toBeNull();
    expect(regex.max_depth).toBeNull();

    // 核心流向与作用范围断言：仅 world_info，仅 prompt
    expect(regex.source).toEqual({
      user_input: false,
      ai_output: false,
      slash_command: false,
      world_info: true,
      reasoning: false,
    });
    expect(regex.destination).toEqual({
      display: false,
      prompt: true,
    });
  });

  it('createWorldbookDataRegex 支持传入自定义 ID', () => {
    const custom = createWorldbookDataRegex('custom-regex-id-123');
    expect(custom.id).toBe('custom-regex-id-123');
    expect(custom.script_name).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_NAME);
  });

  it('isWorldbookDataRegexConfigured 能准确识别合规与不合规配置', () => {
    const standard = createWorldbookDataRegex();
    expect(isWorldbookDataRegexConfigured(standard)).toBe(true);

    // 边界与非法输入
    expect(isWorldbookDataRegexConfigured(null)).toBe(false);
    expect(isWorldbookDataRegexConfigured(undefined)).toBe(false);
    expect(isWorldbookDataRegexConfigured({} as any)).toBe(false);

    // 被禁用
    expect(isWorldbookDataRegexConfigured({ ...standard, enabled: false })).toBe(false);

    // 正则表达式被修改
    expect(isWorldbookDataRegexConfigured({ ...standard, find_regex: 'wrong_regex' })).toBe(false);

    // 替换目标非空
    expect(isWorldbookDataRegexConfigured({ ...standard, replace_string: '[已屏蔽]' })).toBe(false);

    // 来源作用域偏离（例如非精准 world_info 或包含了 user_input）
    expect(isWorldbookDataRegexConfigured({ ...standard, source: { ...standard.source, world_info: false } })).toBe(
      false,
    );
    expect(isWorldbookDataRegexConfigured({ ...standard, source: { ...standard.source, user_input: true } })).toBe(
      false,
    );
    expect(isWorldbookDataRegexConfigured({ ...standard, source: { ...standard.source, ai_output: true } })).toBe(
      false,
    );

    // 流向偏离（发往 LLM 提示词必须开启 prompt，前端显示必须关闭）
    expect(
      isWorldbookDataRegexConfigured({ ...standard, destination: { ...standard.destination, prompt: false } }),
    ).toBe(false);
    expect(
      isWorldbookDataRegexConfigured({ ...standard, destination: { ...standard.destination, display: true } }),
    ).toBe(false);

    // 深度或编辑时触发被篡改
    expect(isWorldbookDataRegexConfigured({ ...standard, run_on_edit: true })).toBe(false);
    expect(isWorldbookDataRegexConfigured({ ...standard, min_depth: 0 })).toBe(false);
    expect(isWorldbookDataRegexConfigured({ ...standard, max_depth: 10 })).toBe(false);
  });
});

describe('tavernRegexPipeline · stripWorldbookDataBlock 纯函数文本清理', () => {
  it('对没有数据块的纯文本保持 100% 原始叙述完好无损', () => {
    const narrative = '这是一段纯自然叙述，包含青岚山北坡基地与周围巡逻队的日常记录。';
    expect(stripWorldbookDataBlock(narrative)).toBe(narrative);
  });

  it('能正确剥离单行数据块并保留外部叙述', () => {
    const input = '建造厂是基地的核心。<数据>{"type":"building","name":"建造厂"}</数据>请妥善保护。';
    const expected = '建造厂是基地的核心。请妥善保护。';
    expect(stripWorldbookDataBlock(input)).toBe(expected);
  });

  it('能正确剥离多行、含缩进、嵌套 JSON 的数据块', () => {
    const input = `【建造厂核心】
全基地的中枢建筑，提供基础电力与建筑建造权限。
<数据>
{
  "type": "building",
  "name": "建造厂核心",
  "cost": 2000,
  "power": -20,
  "prereqs": [],
  "nested": {
    "layer": "地下层",
    "tags": ["core", "defense"]
  }
}
</数据>
状态：正常运转，请指挥官注意维护。`;

    const expected = `【建造厂核心】
全基地的中枢建筑，提供基础电力与建筑建造权限。

状态：正常运转，请指挥官注意维护。`;

    expect(stripWorldbookDataBlock(input)).toBe(expected);
  });

  it('能剥离连续多个及分散的多个数据块', () => {
    const input = '前言叙述<数据>{"block": 1}</数据>中段叙述<数据>{"block": 2}</数据>结语';
    expect(stripWorldbookDataBlock(input)).toBe('前言叙述中段叙述结语');

    const consecutive = '起点<数据>{"a": 1}</数据><数据>{"b": 2}</数据>终点';
    expect(stripWorldbookDataBlock(consecutive)).toBe('起点终点');
  });

  it('边界输入：空串与非法非字符串输入安全防御', () => {
    expect(stripWorldbookDataBlock('')).toBe('');
    expect(stripWorldbookDataBlock(null as any)).toBe('');
    expect(stripWorldbookDataBlock(undefined as any)).toBe('');
  });

  it('离线模拟：RegExp 编译行为与 stripWorldbookDataBlock 结果 100% 对齐', () => {
    const sample = '前置文字\n<数据>\n{"name":"超时空传送仪"}\n</数据>\n后置说明';
    const compiled = new RegExp(SYSTEM_WORLDBOOK_DATA_REGEX_FIND, 'g');
    const replacedByRegex = sample.replace(compiled, '');
    const replacedByHelper = stripWorldbookDataBlock(sample);

    expect(replacedByHelper).toBe(replacedByRegex);
    expect(replacedByHelper).toBe('前置文字\n\n后置说明');
  });

  it('createWorldbookMappingRegex 与 stripWorldbookSystemMapping / stripWorldbookPromptMeta 精准剥离世界书系统映射与 <数据> 块', () => {
    const mappingRegex = createWorldbookMappingRegex();
    expect(mappingRegex.id).toBe(SYSTEM_WORLDBOOK_MAPPING_REGEX_ID);
    expect(mappingRegex.script_name).toBe(SYSTEM_WORLDBOOK_MAPPING_REGEX_NAME);
    expect(mappingRegex.enabled).toBe(true);
    expect(mappingRegex.find_regex).toBe(SYSTEM_WORLDBOOK_MAPPING_REGEX_FIND);
    expect(mappingRegex.replace_string).toBe('');
    expect(mappingRegex.source).toEqual({
      user_input: false,
      ai_output: false,
      slash_command: false,
      world_info: true,
      reasoning: false,
    });
    expect(mappingRegex.destination).toEqual({
      display: false,
      prompt: true,
    });
    expect(isWorldbookMappingRegexConfigured(mappingRegex)).toBe(true);
    expect(isWorldbookMappingRegexConfigured({ ...mappingRegex, enabled: false })).toBe(false);
    expect(
      isWorldbookMappingRegexConfigured({
        ...mappingRegex,
        source: { ...mappingRegex.source, world_info: false },
      }),
    ).toBe(false);
    expect(
      isWorldbookMappingRegexConfigured({
        ...mappingRegex,
        destination: { ...mappingRegex.destination, prompt: false },
      }),
    ).toBe(false);

    // 真实世界书条目样本（同时包含 *系统映射：...* 与 <数据>...</数据>）
    const wbEntrySample = [
      '[通用·主建筑 | 战车工厂]',
      '通用战车工厂是战区生产装甲载具、突击底盘、重型运输平台与工程机械的核心工业熔炉。',
      '',
      '*系统映射：bld.common.war_factory | kind=building | tier=T1 | 前置: 装甲载具工学 | 槽位: ext.building.slot.war_factory*',
      '',
      '<数据>',
      '{',
      '  "schema_version": 1,',
      '  "type": "building",',
      '  "id": "bld.common.war_factory",',
      '  "name": "战车工厂"',
      '}',
      '</数据>',
    ].join('\n');

    expect(stripWorldbookSystemMapping(wbEntrySample)).not.toContain('系统映射');
    expect(stripWorldbookPromptMeta(wbEntrySample)).toBe(
      '[通用·主建筑 | 战车工厂]\n通用战车工厂是战区生产装甲载具、突击底盘、重型运输平台与工程机械的核心工业熔炉。',
    );

    // 模拟酒馆 WORLD_INFO 管线按注册表顺序链式执行：[0] <数据> 隐藏 -> [1] 系统映射隐藏
    const wbSpecs = SYSTEM_TAVERN_REGEX_REGISTRY.filter(s => s.source.world_info && s.destination.prompt);
    expect(wbSpecs.map(s => s.id)).toEqual([
      SYSTEM_WORLDBOOK_DATA_REGEX_ID,
      SYSTEM_WORLDBOOK_MAPPING_REGEX_ID,
    ]);
    const pipelineOut = wbSpecs.reduce(
      (acc, spec) => acc.replace(new RegExp(spec.find_regex), spec.replace_string),
      wbEntrySample,
    );
    expect(pipelineOut).toBe(
      '[通用·主建筑 | 战车工厂]\n通用战车工厂是战区生产装甲载具、突击底盘、重型运输平台与工程机械的核心工业熔炉。',
    );

    // 特殊变体 1：星号在行中闭合后仍跟有 "| 能力槽: ..."
    const trailingSlotSample =
      '[通用·防御辅助 | 哨戒炮位]\n直射点防工事。\n\n*系统映射：def.building.t1.sentry_gun_position | kind=building | 职能: 基地最内层直射点防工事* | 能力槽: ext.building.slot.direct_fire_defense';
    expect(stripWorldbookSystemMapping(trailingSlotSample)).toBe('[通用·防御辅助 | 哨戒炮位]\n直射点防工事。');

    // 特殊变体 2：方括号/列表符号及行内自然语言安全保护
    const proseAndBracketSample =
      '指挥中枢将雷达回波向火控系统映射：完成标定。\n【系统映射】ext.test.slot\n· 系统映射：test.node';
    expect(stripWorldbookSystemMapping(proseAndBracketSample)).toBe(
      '指挥中枢将雷达回波向火控系统映射：完成标定。',
    );
  });
});

describe('tavernRegexPipeline · ensureWorldbookDataRegex 自愈注册与环境降级', () => {
  afterEach(() => {
    delete (globalThis as any).getTavernRegexes;
    delete (globalThis as any).updateTavernRegexesWith;
  });

  it('首次调用：不存在目标正则时成功追加并返回 installed: true', async () => {
    let hostRegexes: TavernRegex[] = [
      {
        id: 'existing-other-regex',
        script_name: '用户自定义对话美化',
        enabled: true,
        find_regex: 'test',
        replace_string: 'test',
        trim_strings: [],
        source: { user_input: true, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: true, prompt: false },
        run_on_edit: false,
        min_depth: null,
        max_depth: null,
      },
    ];

    const getTavernRegexes = vi.fn(() => hostRegexes);
    const updateTavernRegexesWith = vi.fn(
      async (updater: (regexes: TavernRegex[]) => TavernRegex[] | Promise<TavernRegex[]>) => {
        hostRegexes = await updater(hostRegexes);
        return hostRegexes;
      },
    );

    const deps: TavernRegexDeps = {
      getTavernRegexes,
      updateTavernRegexesWith,
      in_tavern: true,
    };

    const res = await ensureWorldbookDataRegex(deps);

    expect(res).toEqual({ ready: true, installed: true, updated: false });
    expect(getTavernRegexes).toHaveBeenCalledWith({ type: 'character' });
    expect(updateTavernRegexesWith).toHaveBeenCalledWith(expect.any(Function), { type: 'character' });

    // 验证新规则已追加到末尾，且既有规则不受损害
    expect(hostRegexes).toHaveLength(2);
    expect(hostRegexes[0].id).toBe('existing-other-regex');
    expect(hostRegexes[1].script_name).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_NAME);
    expect(hostRegexes[1].enabled).toBe(true);
    expect(hostRegexes[1].source.world_info).toBe(true);
    expect(hostRegexes[1].destination.prompt).toBe(true);
  });

  it('幂等性：当条目已存在且配置正确启用时，不重复触发写入', async () => {
    const existing = createWorldbookDataRegex();
    let hostRegexes: TavernRegex[] = [existing];

    const getTavernRegexes = vi.fn(() => hostRegexes);
    const updateTavernRegexesWith = vi.fn(async updater => (hostRegexes = await updater(hostRegexes)));

    const deps: TavernRegexDeps = {
      getTavernRegexes,
      updateTavernRegexesWith,
      in_tavern: true,
    };

    const res = await ensureWorldbookDataRegex(deps);

    expect(res).toEqual({ ready: true, installed: false, updated: false });
    expect(getTavernRegexes).toHaveBeenCalledWith({ type: 'character' });
    expect(updateTavernRegexesWith).not.toHaveBeenCalled();
    expect(hostRegexes).toHaveLength(1);
  });

  it('自动纠偏与修复：当条目存在但处于禁用状态时，自动纠偏为启用', async () => {
    const disabledRegex = {
      ...createWorldbookDataRegex('custom-fixed-id'),
      enabled: false,
    };
    let hostRegexes: TavernRegex[] = [disabledRegex];

    const getTavernRegexes = vi.fn(() => hostRegexes);
    const updateTavernRegexesWith = vi.fn(
      async (updater: (regexes: TavernRegex[]) => TavernRegex[] | Promise<TavernRegex[]>) => {
        hostRegexes = await updater(hostRegexes);
        return hostRegexes;
      },
    );

    const deps: TavernRegexDeps = {
      getTavernRegexes,
      updateTavernRegexesWith,
      in_tavern: true,
    };

    const res = await ensureWorldbookDataRegex(deps);

    expect(res).toEqual({ ready: true, installed: false, updated: true });
    expect(updateTavernRegexesWith).toHaveBeenCalledWith(expect.any(Function), { type: 'character' });
    expect(hostRegexes[0].enabled).toBe(true);
    expect(hostRegexes[0].id).toBe('custom-fixed-id');
  });

  it('自动纠偏与修复：当条目存在但配置被污染篡改时，安全复原标准配置', async () => {
    const tamperedRegex: TavernRegex = {
      id: SYSTEM_WORLDBOOK_DATA_REGEX_ID,
      script_name: SYSTEM_WORLDBOOK_DATA_REGEX_NAME,
      enabled: true,
      find_regex: 'tampered-regex',
      replace_string: 'wrong',
      trim_strings: ['extra'],
      source: {
        user_input: true,
        ai_output: true,
        slash_command: false,
        world_info: false, // 错误：关闭了世界书过滤
        reasoning: false,
      },
      destination: {
        display: true,
        prompt: false, // 错误：关闭了提示词切除
      },
      run_on_edit: true,
      min_depth: 2,
      max_depth: 5,
    };
    let hostRegexes: TavernRegex[] = [tamperedRegex];

    const getTavernRegexes = vi.fn(() => hostRegexes);
    const updateTavernRegexesWith = vi.fn(async updater => (hostRegexes = await updater(hostRegexes)));

    const res = await ensureWorldbookDataRegex({
      getTavernRegexes,
      updateTavernRegexesWith,
      in_tavern: true,
    });

    expect(res).toEqual({ ready: true, installed: false, updated: true });
    expect(isWorldbookDataRegexConfigured(hostRegexes[0])).toBe(true);
    expect(hostRegexes[0].source.world_info).toBe(true);
    expect(hostRegexes[0].source.user_input).toBe(false);
    expect(hostRegexes[0].destination.prompt).toBe(true);
    expect(hostRegexes[0].destination.display).toBe(false);
    expect(hostRegexes[0].find_regex).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_FIND);
    expect(hostRegexes[0].replace_string).toBe('');
    expect(hostRegexes[0].min_depth).toBeNull();
  });

  it('通过全局变量读取（无显式 deps）：模拟真实酒馆 iframe 全局挂载', async () => {
    let list: TavernRegex[] = [];
    (globalThis as any).getTavernRegexes = vi.fn(() => list);
    (globalThis as any).updateTavernRegexesWith = vi.fn(async (updater: any) => (list = await updater(list)));

    const res = await ensureWorldbookDataRegex();

    expect(res).toEqual({ ready: true, installed: true, updated: false });
    expect((globalThis as any).getTavernRegexes).toHaveBeenCalled();
    expect((globalThis as any).updateTavernRegexesWith).toHaveBeenCalled();
    expect(list).toHaveLength(1);
    expect(list[0].script_name).toBe(SYSTEM_WORLDBOOK_DATA_REGEX_NAME);
  });

  it('环境降级：非酒馆环境（in_tavern: false）安全 fail-closed', async () => {
    const updateTavernRegexesWith = vi.fn();
    const res = await ensureWorldbookDataRegex({
      in_tavern: false,
      getTavernRegexes: vi.fn(),
      updateTavernRegexesWith,
    });

    expect(res).toEqual({ ready: false, installed: false, updated: false });
    expect(updateTavernRegexesWith).not.toHaveBeenCalled();
  });

  it('环境降级：缺少必要 API 时安全 fail-closed', async () => {
    const res = await ensureWorldbookDataRegex({
      in_tavern: true,
      getTavernRegexes: undefined,
      updateTavernRegexesWith: undefined,
    });
    expect(res).toEqual({ ready: false, installed: false, updated: false });
  });

  it('异常安全处理：API 抛出异常时永不崩溃，安全返回 fail-closed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const brokenDeps: TavernRegexDeps = {
      in_tavern: true,
      getTavernRegexes: vi.fn(() => {
        throw new Error('SillyTavern internal DB locked');
      }),
      updateTavernRegexesWith: vi.fn(),
    };

    const res = await ensureWorldbookDataRegex(brokenDeps);

    expect(res).toEqual({ ready: false, installed: false, updated: false });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('tavernRegexPipeline · CMD-REGEX-01 通用声明式正则注册表与自愈中心', () => {
  it('SYSTEM_TAVERN_REGEX_REGISTRY 包含 26 条标准规则（含 2 条世界书提示词过滤与开场启动器）且 buildFloorCardIframeShell 格式精确对齐', () => {
    expect(SYSTEM_TAVERN_REGEX_REGISTRY).toHaveLength(26);
    expect(FLOOR_CARD_IFRAME_REGEX_IDS).toHaveLength(20);
    expect(SYSTEM_TAVERN_REGEX_REGISTRY.slice(0, 6).map(item => item.id)).toEqual([
      WORLDBOOK_DATA_REGEX_ID,
      WORLDBOOK_MAPPING_REGEX_ID,
      FACTION_UNLOCK_REGEX_ID,
      AEROSPACE_CONTRACT_REGEX_ID,
      MAIDEN_DOSSIER_REGEX_ID,
      MAIDEN_STATUS_REGEX_ID,
    ]);

    const launcherSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === OPENING_LAUNCHER_REGEX_ID)!;
    expect(launcherSpec).toBeDefined();
    expect(launcherSpec.script_name).toBe(OPENING_LAUNCHER_REGEX_NAME);
    expect(launcherSpec.find_regex).toBe(OPENING_LAUNCHER_FIND_REGEX);
    expect(launcherSpec.replace_string).toBe(OPENING_LAUNCHER_REPLACE_STRING);
    expect(launcherSpec.source).toEqual({
      user_input: true,
      ai_output: true,
      slash_command: false,
      world_info: false,
      reasoning: false,
    });
    expect(launcherSpec.destination).toEqual({
      display: true,
      prompt: false,
    });
    expect(launcherSpec.run_on_edit).toBe(false);
    const sampleFirstMes = '<launcher>\n（指挥官终端初始化中——请在上方界面完成开局配置；配置确认后，作战正式开始。）';
    expect(sampleFirstMes.replace(new RegExp(launcherSpec.find_regex), launcherSpec.replace_string)).toBe(
      OPENING_LAUNCHER_REPLACE_STRING,
    );

    const factionShell = buildFloorCardIframeShell('faction-unlock', '战区阵营编制启封卷宗');
    expect(factionShell.startsWith('\n\n<div class="tw-floor-card-host"')).toBe(true);
    expect(factionShell.endsWith('</iframe></div>\n\n')).toBe(true);
    expect(factionShell).toContain('class="tw-floor-card-host"');
    expect(factionShell).toContain('data-tw-card="faction-unlock"');
    expect(factionShell).toContain('<script type="text/plain" class="tw-raw-payload">$1</script>');
    expect(factionShell).toContain('[战区阵营编制启封卷宗 · 正在同步参谋部卷宗...]');

    // 验证正则与替换壳可正确包裹标签载荷
    const factionSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === FACTION_UNLOCK_REGEX_ID)!;
    const sampleOutput = '报告指挥官：\n<阵营解锁>\n{"faction":"尤里残部"}\n</阵营解锁>';
    const replaced = sampleOutput.replace(new RegExp(factionSpec.find_regex, 'g'), factionSpec.replace_string);
    expect(replaced).toContain('<script type="text/plain" class="tw-raw-payload">{"faction":"尤里残部"}</script>');

    // 验证 <机娘档案> 排在 <机娘> 之前且各自精准匹配
    const dossierSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === MAIDEN_DOSSIER_REGEX_ID)!;
    const statusSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === MAIDEN_STATUS_REGEX_ID)!;
    expect(dossierSpec.id).toBe(MAIDEN_DOSSIER_REGEX_ID);
    expect(statusSpec.id).toBe(MAIDEN_STATUS_REGEX_ID);
    expect(dossierSpec.destination).toEqual({ display: true, prompt: false });
    expect(statusSpec.destination).toEqual({ display: true, prompt: false });
    expect(dossierSpec.run_on_edit).toBe(true);
    expect(statusSpec.run_on_edit).toBe(true);

    const sampleDossier = '授名完成：\n<机娘档案>\n名称: 赤星\n编号: RHINO-02\n</机娘档案>';
    const replacedDossier = sampleDossier.replace(new RegExp(dossierSpec.find_regex, 'g'), dossierSpec.replace_string);
    expect(replacedDossier).toContain('data-tw-card="maiden-dossier"');
    expect(replacedDossier).toContain('<script type="text/plain" class="tw-raw-payload">名称: 赤星\n编号: RHINO-02</script>');

    const sampleStatus = '初诞涌现：\n<机娘>\n名称: 待授名\n编号: RHINO-02\n</机娘>';
    const replacedStatus = sampleStatus.replace(new RegExp(statusSpec.find_regex, 'g'), statusSpec.replace_string);
    expect(replacedStatus).toContain('data-tw-card="maiden-status"');
    expect(replacedStatus).toContain('<script type="text/plain" class="tw-raw-payload">名称: 待授名\n编号: RHINO-02</script>');

    // 验证 <暗网> 终端卡片局部正则
    const darknetSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === DARKNET_TERMINAL_REGEX_ID)!;
    expect(darknetSpec).toBeDefined();
    expect(darknetSpec.script_name).toBe('系统·超维暗网终端卡片');
    expect(darknetSpec.destination).toEqual({ display: true, prompt: false });
    expect(darknetSpec.source).toEqual({
      user_input: false,
      ai_output: true,
      slash_command: true,
      world_info: false,
      reasoning: false,
    });
    const sampleDarknet = '交割完成：\n<暗网>\n市场状态: 正常连接\n拍卖状态: 竞价中\n</暗网>\n';
    const replacedDarknet = sampleDarknet.replace(new RegExp(darknetSpec.find_regex, 'g'), darknetSpec.replace_string);
    expect(replacedDarknet).toContain('data-tw-card="darknet-terminal"');
    expect(replacedDarknet).toContain('data-tw-title="超维暗网中继终端 · 交割与拍卖回执"');
    expect(replacedDarknet).toContain('市场状态: 正常连接\n拍卖状态: 竞价中');

    // 验证 <摘要>/<summary>/<中摘要>/<大摘要> 战地纪要折叠胶囊局部正则
    const summarySpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === STORY_SUMMARY_REGEX_ID)!;
    expect(summarySpec).toBeDefined();
    expect(summarySpec.destination).toEqual({ display: true, prompt: false });
    const sampleSummary = '战报完毕：\n<摘要>\n时间: 秋·九月十九\n纪要: 基地车在北坡展开\n关键词: [北坡, 基地车]\n</摘要>';
    const replacedSummary = sampleSummary.replace(new RegExp(summarySpec.find_regex, 'g'), summarySpec.replace_string);
    expect(replacedSummary).toContain('data-tw-card="story-summary"');
    expect(replacedSummary).toContain('时间: 秋·九月十九\n纪要: 基地车在北坡展开\n关键词: [北坡, 基地车]');

    // 验证当预设「思维链折叠」将 <thinking> 替换为 <details class="st_custom_reasoning"><summary style="...">...</summary> 时，
    // story-summary 正则绝不误吞 HTML <summary style="...">，且即使在非全局（单次）匹配下也能精准替换底部的真实 <摘要>
    const sampleWithReasoningDetails =
      '<details class="st_custom_reasoning"><summary style="list-style:none;"><span>思考了一会</span></summary><div>思维链内容</div></details>\n\n正文段落\n\n<摘要>\n时间: 2042-06-15\n纪要: 真实底部纪要\n关键词: [恶土]\n</摘要>';
    const replacedSinglePass = sampleWithReasoningDetails.replace(
      new RegExp(summarySpec.find_regex),
      summarySpec.replace_string,
    );
    expect(replacedSinglePass).toContain('<summary style="list-style:none;"><span>思考了一会</span></summary>');
    expect(replacedSinglePass).not.toContain('<摘要>');
    expect(replacedSinglePass).toContain('data-tw-card="story-summary"');
    expect(replacedSinglePass).toContain('真实底部纪要');

    // 验证 <任务> 作战任务指令书局部正则
    const questSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === TACTICAL_QUEST_REGEX_ID)!;
    expect(questSpec).toBeDefined();
    expect(questSpec.script_name).toBe('系统·战区作战任务指令书卡片挂载');
    expect(questSpec.destination).toEqual({ display: true, prompt: false });
    expect(questSpec.run_on_edit).toBe(true);
    const sampleQuest = '作战指令下达：\n<任务>\n- 名称: 铁幕前哨·废弃货场清剿\n  状态: 进行中\n</任务>';
    const replacedQuest = sampleQuest.replace(new RegExp(questSpec.find_regex, 'g'), questSpec.replace_string);
    expect(replacedQuest).toContain('data-tw-card="tactical-quest"');
    expect(replacedQuest).toContain('data-tw-title="战区作战任务指令与悬赏回执"');
    expect(replacedQuest).toContain('- 名称: 铁幕前哨·废弃货场清剿\n  状态: 进行中');

    // 验证 <情报>/<世界演变> 卡片局部正则已统一升级为 buildFloorCardIframeShell 并支持同义词
    const intelSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === TACTICAL_INTEL_REGEX_ID)!;
    expect(intelSpec).toBeDefined();
    expect(intelSpec.script_name).toBe('系统内建·战区情报与世界演变卡片');
    expect(intelSpec.replace_string).toBe(buildFloorCardIframeShell('tactical-intel', '战区情报电讯终端'));
    for (const tag of ['情报', '战区情报', '情报电讯']) {
      const sampleIntel = `<${tag}>\n- 标题: 北坡异常电讯\n  来源: 雷达侦察\n</${tag}>`;
      const replacedIntel = sampleIntel.replace(new RegExp(intelSpec.find_regex, 'g'), intelSpec.replace_string);
      expect(replacedIntel).toContain('data-tw-card="tactical-intel"');
      expect(replacedIntel).toContain('<iframe class="tw-floor-card"');
      expect(replacedIntel).toContain('- 标题: 北坡异常电讯\n  来源: 雷达侦察');
    }

    const worldEvoSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === WORLD_EVOLUTION_STEALTH_REGEX_ID)!;
    expect(worldEvoSpec).toBeDefined();
    expect(worldEvoSpec.replace_string).toBe(buildFloorCardIframeShell('world-evolution-stealth', '世界演变暗流态势'));
    for (const tag of ['世界演变', '世界暗流', '宏观演变']) {
      const sampleEvo = `<${tag}>\n- 阶段: 铁幕扩张\n</${tag}>`;
      const replacedEvo = sampleEvo.replace(new RegExp(worldEvoSpec.find_regex, 'g'), worldEvoSpec.replace_string);
      expect(replacedEvo).toContain('data-tw-card="world-evolution-stealth"');
      expect(replacedEvo).toContain('<iframe class="tw-floor-card"');
      expect(replacedEvo).toContain('- 阶段: 铁幕扩张');
    }

    // 验证新增 B 类独立顶层标签：deployment-order (<部署>/<展开>/<deploy>) 与 economy-chains (<资金链>)
    const deploySpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === DEPLOYMENT_ORDER_REGEX_ID)!;
    expect(deploySpec).toBeDefined();
    expect(deploySpec.script_name).toBe('系统·战区基地车与防区部署终端挂载');
    for (const tag of ['部署', '展开', 'deploy']) {
      const sampleDeploy = `<${tag}>\n载具: MCV（盟军）\n基地: 一号基地\n</${tag}>`;
      const replacedDeploy = sampleDeploy.replace(new RegExp(deploySpec.find_regex, 'g'), deploySpec.replace_string);
      expect(replacedDeploy).toContain('data-tw-card="deployment-order"');
      expect(replacedDeploy).toContain('载具: MCV（盟军）\n基地: 一号基地');
    }

    const econSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === ECONOMY_CHAINS_REGEX_ID)!;
    expect(econSpec).toBeDefined();
    expect(econSpec.script_name).toBe('系统·战区多元资金链态势终端挂载');
    const sampleEcon = '<资金链>\n- 名称: 北坡矿场主矿脉\n  日产: 1200\n</资金链>';
    const replacedEcon = sampleEcon.replace(new RegExp(econSpec.find_regex, 'g'), econSpec.replace_string);
    expect(replacedEcon).toContain('data-tw-card="economy-chains"');
    expect(replacedEcon).toContain('- 名称: 北坡矿场主矿脉\n  日产: 1200');

    // 验证同族并入与中文同义词（发射中心、生产、战况/初始状态/环境态势、阵营启封、机娘状态、扩展、数据补丁、黑市、决策选项、悬赏任务）
    const aeroSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === AEROSPACE_CONTRACT_REGEX_ID)!;
    expect(
      '<发射中心>\n项目: 侦察卫星\n</发射中心>'.replace(new RegExp(aeroSpec.find_regex, 'g'), aeroSpec.replace_string),
    ).toContain('data-tw-card="aerospace-contract"');

    const prodSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === PRODUCTION_SCHEDULE_REGEX_ID)!;
    for (const tag of ['排产计划', '排产', '生产计划', '生产']) {
      expect(
        `<${tag}>\n- 单位: 灰熊坦克\n</${tag}>`.replace(new RegExp(prodSpec.find_regex, 'g'), prodSpec.replace_string),
      ).toContain('data-tw-card="production-schedule"');
    }

    const sitSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === TACTICAL_SITUATION_REGEX_ID)!;
    for (const tag of ['态势', '战区态势', '环境态势', '环境', '战况', '初始状态']) {
      expect(
        `<${tag}>\n天气: 暴雪\n</${tag}>`.replace(new RegExp(sitSpec.find_regex, 'g'), sitSpec.replace_string),
      ).toContain('data-tw-card="tactical-situation"');
    }

    const expSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === EXPANSION_DOSSIER_REGEX_ID)!;
    expect(
      '<新扩展>\n名称: 太平洋重工\n</新扩展>'.replace(new RegExp(expSpec.find_regex, 'g'), expSpec.replace_string),
    ).toContain('data-tw-card="expansion-dossier"');

    const patchSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === DATA_PATCH_REGEX_ID)!;
    expect(
      '<数据补丁>\nop: replace\n</数据补丁>'.replace(new RegExp(patchSpec.find_regex, 'g'), patchSpec.replace_string),
    ).toContain('data-tw-card="data-patch"');

    const optSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === TACTICAL_OPTIONS_REGEX_ID)!;
    expect(
      '<决策选项>\n- 文本: 固守待援\n</决策选项>'.replace(new RegExp(optSpec.find_regex, 'g'), optSpec.replace_string),
    ).toContain('data-tw-card="tactical-options"');

    // 验证新增 Prompt 瘦身正则 ①：历史楼层战报标签静默剥离 (min_depth: 2)
    const histStripSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(
      item => item.id === HISTORICAL_REPORT_TAGS_PROMPT_STRIP_REGEX_ID,
    )!;
    expect(histStripSpec).toBeDefined();
    expect(histStripSpec.script_name).toBe('系统·历史楼层战报标签静默剥离');
    expect(histStripSpec.destination).toEqual({ display: false, prompt: true });
    expect(histStripSpec.source).toEqual({
      user_input: false,
      ai_output: true,
      slash_command: false,
      world_info: false,
      reasoning: false,
    });
    expect(histStripSpec.min_depth).toBe(2);
    expect(histStripSpec.max_depth).toBeNull();
    expect(histStripSpec.run_on_edit).toBe(false);

    const sampleHistoricalFloor = [
      '<正文>',
      '指挥官在掩体前观察北坡地貌，萧栖雪在一旁记录岩土回波数据。',
      '</正文>',
      '',
      '<摘要>',
      '时间: 秋·九月十九',
      '纪要: 北坡地质踏勘',
      '</摘要>',
      '<timePast>00.01.30</timePast>',
      '<态势>',
      '日期: 秋·九月十九',
      '参谋建议:',
      '  - 参谋: 萧栖雪',
      '</态势>',
      '<战况>',
      '日期: 秋·九月十九',
      '</战况>',
      '<事件>',
      '- 类型: 踏勘完成',
      '</事件>',
      '<选项>',
      '- 文本: 继续深入山谷',
      '</选项>',
    ].join('\n');
    const strippedFloor = sampleHistoricalFloor.replace(
      new RegExp(histStripSpec.find_regex, 'g'),
      histStripSpec.replace_string,
    );
    expect(strippedFloor).toBe('<正文>\n指挥官在掩体前观察北坡地貌，萧栖雪在一旁记录岩土回波数据。\n</正文>');

    // 验证新增 Prompt 瘦身正则 ②：首幕定场指令远期静默瘦身 (min_depth: 4)
    const openingSlimSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(
      item => item.id === OPENING_DIRECTIVE_PROMPT_SLIM_REGEX_ID,
    )!;
    expect(openingSlimSpec).toBeDefined();
    expect(openingSlimSpec.script_name).toBe('系统·首幕定场指令远期静默瘦身');
    expect(openingSlimSpec.destination).toEqual({ display: false, prompt: true });
    expect(openingSlimSpec.source).toEqual({
      user_input: true,
      ai_output: false,
      slash_command: false,
      world_info: false,
      reasoning: false,
    });
    expect(openingSlimSpec.min_depth).toBe(4);
    expect(openingSlimSpec.max_depth).toBeNull();
    expect(openingSlimSpec.run_on_edit).toBe(false);

    const sampleFirstTurnUser = [
      '【开场设定摘要】',
      '主角：林默｜入场模式：原世界穿越前夕｜随行同伴：萧栖雪',
      '',
      '【首幕创作指令】',
      '1. 请严格按照原世界未穿越节奏展开第一幕...',
      '2. 严禁提前唤醒红警系统...',
    ].join('\n');
    const slimmedFirstTurn = sampleFirstTurnUser.replace(
      new RegExp(openingSlimSpec.find_regex, 'g'),
      openingSlimSpec.replace_string,
    );
    expect(slimmedFirstTurn).toBe('【开场设定摘要】\n主角：林默｜入场模式：原世界穿越前夕｜随行同伴：萧栖雪');
  });

  it('createTavernRegexFromSpec 与 isSystemRegexSpecConfigured 严格校验 enabled / scope / find_regex / replace_string / source / destination', () => {
    const spec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === FACTION_UNLOCK_REGEX_ID)!;
    const built = createTavernRegexFromSpec(spec);

    expect(isSystemRegexSpecConfigured(built, spec)).toBe(true);
    expect((built as any).scope).toBe('character');
    expect(built.run_on_edit).toBe(true);

    // 兼容 TavernHelper 4.8+ 新 API 返回无 scope 字段的对象
    const withoutScope = { ...built };
    delete (withoutScope as any).scope;
    expect(isSystemRegexSpecConfigured(withoutScope, spec)).toBe(true);

    // scope 显式为 global 时判定为未配置就绪
    expect(isSystemRegexSpecConfigured({ ...built, scope: 'global' } as any, spec)).toBe(false);
    // 禁用状态时判定为未配置就绪
    expect(isSystemRegexSpecConfigured({ ...built, enabled: false }, spec)).toBe(false);
    // replace_string 漂移时判定为未配置就绪
    expect(isSystemRegexSpecConfigured({ ...built, replace_string: '<div>bad</div>' }, spec)).toBe(false);
    // source / destination 布尔位漂移时判定为未配置就绪
    expect(
      isSystemRegexSpecConfigured({ ...built, source: { ...built.source, ai_output: false } }, spec),
    ).toBe(false);
    expect(
      isSystemRegexSpecConfigured({ ...built, destination: { ...built.destination, display: false } }, spec),
    ).toBe(false);

    // min_depth / max_depth 校验（针对带 min_depth: 2 / 4 的瘦身规则）
    const depthSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(
      item => item.id === HISTORICAL_REPORT_TAGS_PROMPT_STRIP_REGEX_ID,
    )!;
    const builtDepth = createTavernRegexFromSpec(depthSpec);
    expect(builtDepth.min_depth).toBe(2);
    expect(isSystemRegexSpecConfigured(builtDepth, depthSpec)).toBe(true);
    expect(isSystemRegexSpecConfigured({ ...builtDepth, min_depth: null }, depthSpec)).toBe(false);
    expect(isSystemRegexSpecConfigured({ ...builtDepth, min_depth: 4 }, depthSpec)).toBe(false);
    expect(isSystemRegexSpecConfigured({ ...builtDepth, max_depth: 10 }, depthSpec)).toBe(false);
  });

  it('0 写入快路径：当注册表全部 3 条规则已就绪时，0 次调用 updateTavernRegexesWith', async () => {
    const hostRegexes: TavernRegex[] = SYSTEM_TAVERN_REGEX_REGISTRY.map(spec => createTavernRegexFromSpec(spec));

    const getTavernRegexes = vi.fn(() => hostRegexes);
    const updateTavernRegexesWith = vi.fn();
    const isCharacterTavernRegexesEnabled = vi.fn(() => true);

    const deps: Partial<TavernRegexApiDeps> = {
      getTavernRegexes,
      updateTavernRegexesWith,
      isCharacterTavernRegexesEnabled,
    };

    const res = await ensureSystemRegexRegistry(deps);

    expect(res).toEqual({
      ready: true,
      installedCount: 0,
      updatedCount: 0,
      characterRegexEnabled: true,
    });
    expect(getTavernRegexes).toHaveBeenCalledWith({ scope: 'character' });
    expect(updateTavernRegexesWith).not.toHaveBeenCalled();
  });

  it('批量单次追加：缺失 2~3 条受管规则时仅调用 1 次 updateTavernRegexesWith，且 100% 保留用户自定义正则', async () => {
    const userCustomRegex: TavernRegex = {
      id: 'user-custom-style-1',
      script_name: '用户自定义对话框美化',
      enabled: true,
      find_regex: '\\*([^*]+)\\*',
      replace_string: '<em>$1</em>',
      trim_strings: [],
      source: { user_input: true, ai_output: true, slash_command: false, world_info: false, reasoning: false },
      destination: { display: true, prompt: false },
      run_on_edit: false,
      min_depth: null,
      max_depth: null,
    };

    // 初始仅存在用户自定义正则与第 1 条系统正则（缺失后面 4 条系统正则）
    let hostRegexes: TavernRegex[] = [
      userCustomRegex,
      createTavernRegexFromSpec(SYSTEM_TAVERN_REGEX_REGISTRY[0]),
    ];

    const getTavernRegexes = vi.fn(() => hostRegexes);
    const updateTavernRegexesWith = vi.fn(async updater => {
      hostRegexes = await updater(hostRegexes);
      return hostRegexes;
    });

    const res = await ensureSystemRegexRegistry({
      getTavernRegexes,
      updateTavernRegexesWith,
      isCharacterTavernRegexesEnabled: () => true,
    });

    expect(res).toEqual({
      ready: true,
      installedCount: SYSTEM_TAVERN_REGEX_REGISTRY.length - 1,
      updatedCount: 0,
      characterRegexEnabled: true,
    });
    expect(updateTavernRegexesWith).toHaveBeenCalledTimes(1);
    expect(updateTavernRegexesWith).toHaveBeenCalledWith(expect.any(Function), { scope: 'character' });

    // 用户自定义正则完好保留在首位，全部受管规则均已就绪
    expect(hostRegexes).toHaveLength(SYSTEM_TAVERN_REGEX_REGISTRY.length + 1);
    expect(hostRegexes[0]).toEqual(userCustomRegex);
    for (const spec of SYSTEM_TAVERN_REGEX_REGISTRY) {
      const matched = hostRegexes.find(r => r.id === spec.id);
      expect(matched).toBeDefined();
      expect(isSystemRegexSpecConfigured(matched, spec)).toBe(true);
    }
  });

  it('单条漂移单次自愈：当某条受管规则被禁用或配置漂移时，单次调用 updateTavernRegexesWith 精准原地修复', async () => {
    const userCustomRegex: TavernRegex = {
      id: 'user-custom-2',
      script_name: '用户自定义状态美化',
      enabled: true,
      find_regex: 'foo',
      replace_string: 'bar',
      trim_strings: [],
      source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
      destination: { display: true, prompt: false },
      run_on_edit: false,
      min_depth: null,
      max_depth: null,
    };

    const driftedAerospace = {
      ...createTavernRegexFromSpec(SYSTEM_TAVERN_REGEX_REGISTRY[2], { id: 'preserved-aerospace-id' }),
      enabled: false,
      replace_string: 'tampered-shell',
    };

    let hostRegexes: TavernRegex[] = [
      createTavernRegexFromSpec(SYSTEM_TAVERN_REGEX_REGISTRY[0]),
      userCustomRegex,
      createTavernRegexFromSpec(SYSTEM_TAVERN_REGEX_REGISTRY[1]),
      driftedAerospace,
      ...SYSTEM_TAVERN_REGEX_REGISTRY.slice(3).map(spec => createTavernRegexFromSpec(spec)),
    ];

    const getTavernRegexes = vi.fn(() => hostRegexes);
    const updateTavernRegexesWith = vi.fn(async updater => {
      hostRegexes = await updater(hostRegexes);
      return hostRegexes;
    });

    const res = await ensureSystemRegexRegistry({
      getTavernRegexes,
      updateTavernRegexesWith,
      isCharacterTavernRegexesEnabled: () => false,
    });

    expect(res).toEqual({
      ready: true,
      installedCount: 0,
      updatedCount: 1,
      characterRegexEnabled: false,
    });
    expect(updateTavernRegexesWith).toHaveBeenCalledTimes(1);
    expect(hostRegexes).toHaveLength(SYSTEM_TAVERN_REGEX_REGISTRY.length + 1);
    expect(hostRegexes[1]).toEqual(userCustomRegex);
    expect(hostRegexes[3].id).toBe('preserved-aerospace-id');
    expect(isSystemRegexSpecConfigured(hostRegexes[3], SYSTEM_TAVERN_REGEX_REGISTRY[2])).toBe(true);
  });
});

describe('tavernRegexPipeline · FLAT-TAG-REGEX-01 零嵌套平级顶层标签规约与 iframe 换行隔离保护', () => {
  it('buildFloorCardIframeShell 首尾携带双换行 \\n\\n，当 AI 漏空行时也能强行截断前序 Markdown 列表', () => {
    const statusSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(item => item.id === MAIDEN_STATUS_REGEX_ID)!;
    const noBlankLineOutput = [
      '<战况>',
      '基地:',
      '  - 名称: 前沿第一基地',
      '    建筑:',
      '      - 盟军建造厂: 运转',
      '</战况>',
      '<机娘>',
      '名称: 白凌',
      '编号: MCV-01',
      '</机娘>',
    ].join('\n');

    const replaced = noBlankLineOutput.replace(new RegExp(statusSpec.find_regex, 'g'), statusSpec.replace_string);
    expect(replaced).toContain('</战况>\n\n\n<div class="tw-floor-card-host" data-tw-card="maiden-status"');
    expect(replaced.endsWith('</iframe></div>\n\n')).toBe(true);
  });

  it('normalizeFlatProtocolBlocks 强制在紧邻的顶层协议闭合标签与开启标签之间插入 \\n\\n 空行隔离', () => {
    expect(TOP_LEVEL_PROTOCOL_TAGS).toEqual([
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
    ]);

    const rawTight = [
      '<正文>',
      '基地车在北坡缓缓展开。',
      '</正文>',
      '<summary>基地车展开</summary><timePast>00.00.02</timePast>',
      '<战况>',
      '日期: 秋·九月十九',
      '基地:',
      '  - 名称: 前沿第一基地',
      '    建筑:',
      '      - 盟军建造厂: 运转',
      '</战况>',
      '<事件>',
      '- 类型: MCV展开',
      '  载具: MCV（盟军）',
      '  基地: 前沿第一基地',
      '</事件>',
      '<图鉴>',
      '- 名称: 盟军建造厂',
      '  类别: 建筑',
      '</图鉴>',
    ].join('\n');

    const normalized = normalizeFlatProtocolBlocks(rawTight);

    expect(normalized).toContain('</正文>\n\n<summary>基地车展开</summary>\n\n<timePast>00.00.02</timePast>\n\n<战况>');
    expect(normalized).toContain('</战况>\n\n<事件>');
    expect(normalized).toContain('</事件>\n\n<图鉴>');
    // 幂等性验证：再次调用不产生多余空行
    expect(normalizeFlatProtocolBlocks(normalized)).toBe(normalized);
  });

  it('normalizeFlatProtocolBlocks 可将意外内嵌在 <战况> 中的 <事件>/<图鉴> 等子块剥离提平至 </战况> 之后', () => {
    const rawNested = [
      '<战况>',
      '日期: 秋·九月十九',
      '资金变化: +120',
      '  <事件>',
      '  - 类型: MCV展开',
      '    载具: MCV（盟军）',
      '    基地: 前沿第一基地',
      '  </事件>',
      '  <图鉴>',
      '  - 名称: 矿石精炼厂',
      '    类别: 建筑',
      '  </图鉴>',
      '</战况>',
      '<机娘>',
      '名称: 白凌',
      '</机娘>',
    ].join('\n');

    const normalized = normalizeFlatProtocolBlocks(rawNested);

    expect(normalized).toBe(
      [
        '<战况>',
        '日期: 秋·九月十九',
        '资金变化: +120',
        '</战况>',
        '',
        '<事件>',
        '- 类型: MCV展开',
        '  载具: MCV（盟军）',
        '  基地: 前沿第一基地',
        '</事件>',
        '',
        '<图鉴>',
        '- 名称: 矿石精炼厂',
        '  类别: 建筑',
        '</图鉴>',
        '',
        '<机娘>',
        '名称: 白凌',
        '</机娘>',
      ].join('\n'),
    );
  });

  it('normalizeFlatProtocolBlocks 支持将意外嵌套在 <战况> 内的 <暗网> 提平至文末并强制 \\n\\n 隔离', () => {
    const rawWithDarknet = [
      '<战况>',
      '日期: 秋·九月二十',
      '  <暗网>',
      '  市场状态: 正常连接',
      '  拍卖状态: 竞价中',
      '  </暗网>',
      '</战况><事件>',
      '- 类型: 暗网交割',
      '</事件>',
    ].join('\n');

    const normalized = normalizeFlatProtocolBlocks(rawWithDarknet);
    expect(normalized).toBe(
      [
        '<战况>',
        '日期: 秋·九月二十',
        '</战况>',
        '',
        '<暗网>',
        '市场状态: 正常连接',
        '拍卖状态: 竞价中',
        '</暗网>',
        '',
        '<事件>',
        '- 类型: 暗网交割',
        '</事件>',
      ].join('\n'),
    );
  });

  it('normalizeFlatProtocolBlocks 支持 <任务> 空行隔离与从 <战况>/<态势> 解嵌套提平', () => {
    const rawWithQuest = [
      '<态势>',
      '日期: 秋·九月二十',
      '  <任务>',
      '  - 名称: 铁幕前哨·废弃货场清剿',
      '    状态: 进行中',
      '  </任务>',
      '</态势><选项>',
      '- 文本: 立即出击',
      '</选项>',
    ].join('\n');

    const normalized = normalizeFlatProtocolBlocks(rawWithQuest);
    expect(normalized).toBe(
      [
        '<态势>',
        '日期: 秋·九月二十',
        '</态势>',
        '',
        '<任务>',
        '- 名称: 铁幕前哨·废弃货场清剿',
        '  状态: 进行中',
        '</任务>',
        '',
        '<选项>',
        '- 文本: 立即出击',
        '</选项>',
      ].join('\n'),
    );
  });

  it('unwrapProtocolBlocksFromExternalTags 纯函数与 PROTOCOL_TAG_UNWRAP_REGEX_ID 自动退场清理：剥除 <SUOT> 等包裹容器且不污染角色局部正则', async () => {
    // 角色局部正则在预设正则之后执行，因此 PROTOCOL_TAG_UNWRAP_REGEX_ID 已从 SYSTEM_TAVERN_REGEX_REGISTRY 移除，并在 ensureSystemRegexRegistry 中自动清理遗留项
    const unwrapSpec = SYSTEM_TAVERN_REGEX_REGISTRY.find(s => s.id === PROTOCOL_TAG_UNWRAP_REGEX_ID);
    expect(unwrapSpec).toBeUndefined();

    let hostRegexes: TavernRegex[] = [
      ...SYSTEM_TAVERN_REGEX_REGISTRY.map(spec => createTavernRegexFromSpec(spec)),
      {
        id: PROTOCOL_TAG_UNWRAP_REGEX_ID,
        script_name: '系统·战报协议标签反外部包裹脱壳',
        enabled: true,
        scope: 'character',
        find_regex: 'legacy',
        replace_string: 'legacy',
        trim_strings: [],
        source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: true, prompt: true },
        run_on_edit: true,
        min_depth: null,
        max_depth: null,
      } as TavernRegex,
      {
        id: THINKING_INTERLEAVING_STRIP_REGEX_ID,
        script_name: '系统·思考链与交错容器前置剥离',
        enabled: true,
        find_regex: '(<think>[\\s\\S]*?<\\/think>)',
        replace_string: '',
        trim_strings: [],
        source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: true, prompt: false },
        run_on_edit: true,
        min_depth: null,
        max_depth: null,
      } as TavernRegex,
      {
        id: 'b303973f-6319-4226-9eb8-99ac6d6a6613',
        script_name: LEGACY_STATUS_BAR_REGEX_NAME,
        enabled: false,
        find_regex: '<战况>[\\s\\S]*?<\\/战况>',
        replace_string: 'legacy-status-bar',
        trim_strings: [],
        source: { user_input: false, ai_output: true, slash_command: false, world_info: false, reasoning: false },
        destination: { display: true, prompt: false },
        run_on_edit: false,
        min_depth: null,
        max_depth: null,
      } as TavernRegex,
    ];
    const ensureRes = await ensureSystemRegexRegistry({
      getTavernRegexes: () => hostRegexes,
      updateTavernRegexesWith: async updater => {
        hostRegexes = await updater(hostRegexes);
        return hostRegexes;
      },
      isCharacterTavernRegexesEnabled: () => true,
    });
    expect(ensureRes.updatedCount).toBe(3);
    expect(hostRegexes.some(r => r.id === PROTOCOL_TAG_UNWRAP_REGEX_ID)).toBe(false);
    expect(hostRegexes.some(r => r.id === THINKING_INTERLEAVING_STRIP_REGEX_ID)).toBe(false);
    expect(hostRegexes.some(r => r.script_name === LEGACY_STATUS_BAR_REGEX_NAME)).toBe(false);

    // 场景 1：#50 楼真实案例——<SUOT>...</SUOT> 完整包裹 <摘要>/<timePast>/<态势>/<选项>
    const suotWrapped = [
      '正文结束。</Interleaving>',
      '<SUOT>',
      '<摘要>',
      '时间: 2042-06-15',
      '纪要: 巡视洞口并开始首班值守。',
      '</摘要>',
      '',
      '<timePast>0 D 0 H 30 M</timePast>',
      '',
      '<态势>',
      '日期: 2042-06-15',
      '</态势>',
      '',
      '<选项>',
      '- 文本: 安静值守',
      '</选项>',
      '</SUOT>',
      '<disclaimer>xxx</disclaimer>',
    ].join('\n');

    const outSuot = unwrapProtocolBlocksFromExternalTags(suotWrapped);
    expect(outSuot).not.toContain('<SUOT>');
    expect(outSuot).not.toContain('</SUOT>');
    expect(outSuot).toContain('<摘要>');
    expect(outSuot).toContain('</选项>\n<disclaimer>');

    // 场景 2：#26 楼真实案例——<Interleaving> 从正文开头一路包裹到 </选项> 之后
    const interleavingWrapped = [
      '<Interleaving>',
      '正文第一段。',
      '<摘要>',
      '纪要内容',
      '</摘要>',
      '<选项>',
      '- 文本: 出发探洞',
      '</选项>',
      '</Interleaving>',
    ].join('\n');

    const outInterleaving = unwrapProtocolBlocksFromExternalTags(interleavingWrapped);
    expect(outInterleaving.indexOf('</Interleaving>')).toBeLessThan(outInterleaving.indexOf('<摘要>'));
    expect(outInterleaving.trim().endsWith('</选项>')).toBe(true);
  });

  it('协议脱壳在大量正常/未闭合协议块上必须有界完成（独立 worker 硬超时）', async () => {
    const source = readFileSync(new URL('../worldbook/tavernRegexPipeline.ts', import.meta.url), 'utf8');
    const compiled = transpileModule(source, {
      compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS },
    }).outputText;
    const result = await new Promise<boolean[]>((resolve, reject) => {
      const worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const api = {};
        new Function('exports', workerData)(api);
        const blocks = Array.from({ length: 1000 }, (_, i) => '<事件>事件：' + i + '</事件>').join('\\n');
        const unwrap = api.unwrapProtocolBlocksFromExternalTags;
        const plain = unwrap(blocks);
        const open = unwrap('<SUOT>\\n' + blocks);
        const closed = unwrap('<SUOT>\\n' + blocks + '\\n</SUOT>');
        const malformed = '<SUOT>\\n' + '<事件>未闭合\\n'.repeat(1000);
        const prefix = '正文结束。</Interleaving>\\n<unclosed_wrapper>\\n' + blocks;
        const mixed = '<战况>未闭合\\n<事件>未闭合\\n<摘要>未闭合\\n'.repeat(1000);
        parentPort.postMessage([
          plain === blocks,
          open === '<SUOT>\\n' + blocks,
          !closed.includes('SUOT') && closed.includes(blocks),
          unwrap(malformed) === malformed,
          unwrap(prefix) === prefix,
          unwrap(mixed) === mixed,
          (api.normalizeFlatProtocolBlocks(blocks).match(/<事件>/g) || []).length === 1000,
        ]);
      `, { eval: true, workerData: compiled });
      // 普通测试超时不能打断同步 RegExp；必须从另一个线程终止旧实现。
      const timer = setTimeout(() => {
        void worker.terminate().then(() => reject(new Error('协议脱壳超过 3000ms，已终止隔离 worker')));
      }, 3000);
      worker.once('message', checks => {
        clearTimeout(timer);
        void worker.terminate().then(() => resolve(checks));
      });
      worker.once('error', error => {
        clearTimeout(timer);
        void worker.terminate().then(() => reject(error));
      });
    });
    expect(result).toEqual([true, true, true, true, true, true, true]);
  }, 10000);

  it.each([
    ['<SUOT>\n<事件 id="a">巡逻</事件>\n</SUOT>\n', '\n\n<事件 id="a">巡逻</事件>\n'],
    [
      '<Interleaving>正文\n<事件>巡逻</事件>\n<选项>留守</选项></Interleaving>',
      '<Interleaving>正文\n</Interleaving>\n\n<事件>巡逻</事件>\n<选项>留守</选项>',
    ],
    [
      '<Interleaving>正文<SUOT><摘要>记录</摘要><选项>留守</选项></SUOT></Interleaving>',
      '<Interleaving>正文</Interleaving>\n\n<摘要>记录</摘要><选项>留守</选项>',
    ],
    ['<SUOT><战况>报告<事件>巡逻</事件></战况></SUOT>', '\n\n<战况>报告<事件>巡逻</事件></战况>'],
  ])('内部扫描与兼容导出保留脱壳结果：%s', (input, expected) => {
    expect(unwrapProtocolBlocksFromExternalTags(input)).toBe(expected);
    expect(input.replace(new RegExp(PROTOCOL_TAG_UNWRAP_FIND_REGEX, 'g'), PROTOCOL_TAG_UNWRAP_REPLACE_STRING)).toBe(expected);
  });

  it('脱壳保留完整卡片壳、嵌套协议内容及无协议的普通容器', () => {
    const card = buildFloorCardIframeShell('tactical-event', '事件卷宗').replace('$1', '<事件>测试</事件>').trim();
    expect(unwrapProtocolBlocksFromExternalTags(`<SUOT>${card}</SUOT>`)).toContain(card);
    expect(unwrapProtocolBlocksFromExternalTags(`<SUOT>${card}</SUOT>`)).not.toContain('SUOT');
    const nested = '<战况>报告\n<事件>测试</事件>\n</战况>';
    expect(unwrapProtocolBlocksFromExternalTags(`<SUOT>${nested}</SUOT>`)).toContain(nested);
    expect(unwrapProtocolBlocksFromExternalTags(`<SUOT>${nested}</SUOT>`)).not.toContain('SUOT');
    for (const raw of ['<SUOT>仅正文</SUOT>', '<details><summary>标题</summary>正文</details>', '<事件>未闭合']) {
      expect(unwrapProtocolBlocksFromExternalTags(raw)).toBe(raw);
    }
  });

  it('#52 楼真机回归：当未包裹 <thinking> 的行内反引号提及 `<摘要>`、`<timePast>0 D 3 H 0 M</timePast>`、`<态势>` 时，绝不跨段吞噬第 3 段中文正文', () => {
    const floor52Sample = [
      '回到 Dramatron，继续。',
      'よし、第2幕の終わりから第3幕（最後のパート）へ繋げよう。',
      '4. 最後に各プロトコルタグ（`<摘要>`、`<timePast>0 D 3 H 0 M</timePast>`、`<态势>`、`<排产计划>`、`<选项>`）を閉じタグの直前（あるいはSUOT内）に正確に配置する。',
      '',
      '---',
      '',
      '他没有立刻回答，而是先将视线投向洞口外侧的灰白岩脊。这是第三段完整中文正文，绝不可被吞噬。',
      '</Interleaving>',
      '<SUOT>',
      '<摘要>',
      '时间: 2042-06-15 11:30',
      '纪要: 完成洞口警戒交接与周边地形初勘。',
      '关键词: [灰白岩脊, 警戒交接]',
      '</摘要>',
      '',
      '<timePast>0 D 3 H 0 M</timePast>',
      '',
      '<态势>',
      '日期: 2042-06-15 11:30',
      '位置: 恶土·灰白岩脊北侧裂隙',
      '</态势>',
      '',
      '<选项>',
      '- 文本: 安排首班轮休与水源清点',
      '  标签: 稳健内政',
      '</选项>',
      '</SUOT>',
    ].join('\n');

    let formatted = floor52Sample;
    for (const spec of SYSTEM_TAVERN_REGEX_REGISTRY) {
      if (spec.destination.display) {
        formatted = formatted.replace(new RegExp(spec.find_regex, 'g'), spec.replace_string);
      }
    }

    // 1. 行内反引号中的标签原样保留，绝不被替换为卡片壳
    expect(formatted).toContain(
      '4. 最後に各プロトコルタグ（`<摘要>`、`<timePast>0 D 3 H 0 M</timePast>`、`<态势>`、`<排产计划>`、`<选项>`）',
    );
    // 2. 第 3 段中文正文完整保留在卡片壳之前，绝不落入 script.tw-raw-payload 内部
    expect(formatted).toContain('他没有立刻回答，而是先将视线投向洞口外侧的灰白岩脊。这是第三段完整中文正文，绝不可被吞噬。');
    const proseIdx = formatted.indexOf('这是第三段完整中文正文，绝不可被吞噬。');
    const firstCardIdx = formatted.indexOf('class="tw-floor-card-host"');
    expect(proseIdx).toBeGreaterThan(0);
    expect(firstCardIdx).toBeGreaterThan(proseIdx);

    // 3. 底部真实协议块均被精准替换为 1 张卡片，总计 4 张卡片（无多余行内伪卡片）
    const hostMatches = formatted.match(/class="tw-floor-card-host"/g) ?? [];
    expect(hostMatches).toHaveLength(4);
  });

  it('floorProtocolIndex 与 floorCardSummary：支持三阶摘要（小/中/大摘要）、开标签属性保留与同楼多摘要合署展示', () => {
    expect(TAG_TO_CARD_TYPE['部署']).toBe('deployment-order');
    expect(TAG_TO_CARD_TYPE['展开']).toBe('deployment-order');
    expect(TAG_TO_CARD_TYPE['deploy']).toBe('deployment-order');
    expect(TAG_TO_CARD_TYPE['资金链']).toBe('economy-chains');
    expect(TAG_TO_CARD_TYPE['生产']).toBe('production-schedule');
    expect(TAG_TO_CARD_TYPE['发射中心']).toBe('aerospace-contract');
    expect(TAG_TO_CARD_TYPE['初始状态']).toBe('tactical-situation');
    expect(TAG_TO_CARD_TYPE['中摘要']).toBe('story-summary');
    expect(TAG_TO_CARD_TYPE['大摘要']).toBe('story-summary');

    const rawFloor = [
      '<摘要>',
      '时间: 2042-06-20 18:00',
      '纪要: 击退北坡装甲侦察连并加固防空阵地。',
      '关键词: [北坡, 防空阵地]',
      '</摘要>',
      '<中摘要 范围="2-20" 标题="第一幕·恶土破冰与主基地电网保卫战">',
      '内容: 指挥官率部在恶土站稳脚跟，建成首座发电厂与矿石精炼厂。',
      '关键词: [恶土破冰, 电网保卫战]',
      '</中摘要>',
      '<部署>',
      '载具: MCV（盟军）',
      '基地: 一号基地',
      '</部署>',
      '<资金链>',
      '- 名称: 灰岩矿脉',
      '</资金链>',
    ].join('\n');

    const indexed = indexFloorProtocols(rawFloor);
    expect(indexed).toHaveLength(4);
    expect(indexed[0].tag).toBe('摘要');
    expect(indexed[0].cardType).toBe('story-summary');
    expect(indexed[1].tag).toBe('中摘要');
    expect(indexed[1].cardType).toBe('story-summary');
    expect(indexed[1].openTagAttrs).toEqual({
      范围: '2-20',
      标题: '第一幕·恶土破冰与主基地电网保卫战',
    });
    expect(indexed[1].payload).toContain('阶次: 中摘要');
    expect(indexed[1].payload).toContain('范围: 2-20');
    expect(indexed[1].payload).toContain('标题: 第一幕·恶土破冰与主基地电网保卫战');
    expect(indexed[2].cardType).toBe('deployment-order');
    expect(indexed[3].cardType).toBe('economy-chains');

    // 单块中摘要与大摘要解析
    const mesoParsed = parseStorySummaryCardPayload(indexed[1].payload);
    expect(mesoParsed.tier).toBe('meso');
    expect(mesoParsed.tierLabel).toBe('阶段卷宗 · 中摘要');
    expect(mesoParsed.range).toBe('2-20');
    expect(mesoParsed.title).toBe('第一幕·恶土破冰与主基地电网保卫战');
    expect(mesoParsed.summary).toContain('指挥官率部在恶土站稳脚跟');
    expect(mesoParsed.keywords).toEqual(['恶土破冰', '电网保卫战']);

    const macroParsed = parseStorySummaryPayload(
      '<大摘要 范围="1-80" 标题="第一卷·北境极夜战役总纲">\n综述: 三大防区协同作战，彻底肃清极夜战区威胁。\n关键词: [北境极夜, 战役总纲]\n</大摘要>',
    )!;
    expect(macroParsed).not.toBeNull();
    expect(macroParsed.tier).toBe('macro');
    expect(macroParsed.tierLabel).toBe('战役总纲 · 大摘要');
    expect(macroParsed.range).toBe('1-80');
    expect(macroParsed.title).toBe('第一卷·北境极夜战役总纲');

    // 同楼合署（小摘要 + 中摘要通过 \n\n 合并传入同一个 story-summary 卡片）
    const combinedRaw = `${indexed[0].payload}\n\n${indexed[1].payload}`;
    const mergedParsed = parseStorySummaryCardPayload(combinedRaw);
    expect(mergedParsed.tier).toBe('micro');
    expect(mergedParsed.time).toBe('2042-06-20 18:00');
    expect(mergedParsed.summary).toBe('击退北坡装甲侦察连并加固防空阵地。');
    expect(mergedParsed.extraSections).toHaveLength(1);
    expect(mergedParsed.extraSections![0]).toMatchObject({
      tier: 'meso',
      title: '第一幕·恶土破冰与主基地电网保卫战',
      range: '2-20',
      summary: '指挥官率部在恶土站稳脚跟，建成首座发电厂与矿石精炼厂。',
      keywords: ['恶土破冰', '电网保卫战'],
    });

    const makeMiniEl = (tag: string): any => {
      const attrs = new Map<string, string>();
      const classes = new Set<string>();
      const listeners = new Map<string, Array<() => void>>();
      const children: any[] = [];
      let ownText = '';
      const el: any = {
        tagName: tag.toUpperCase(),
        id: '',
        get className() {
          return [...classes].join(' ');
        },
        set className(v: string) {
          classes.clear();
          v.split(/\s+/).filter(Boolean).forEach(c => classes.add(c));
        },
        classList: {
          toggle(c: string) {
            if (classes.has(c)) {
              classes.delete(c);
              return false;
            }
            classes.add(c);
            return true;
          },
          contains(c: string) {
            return classes.has(c);
          },
        },
        setAttribute(k: string, v: string) {
          attrs.set(k, v);
        },
        getAttribute(k: string) {
          return attrs.get(k) ?? null;
        },
        appendChild(child: any) {
          children.push(child);
          return child;
        },
        addEventListener(evt: string, cb: () => void) {
          const list = listeners.get(evt) ?? [];
          list.push(cb);
          listeners.set(evt, list);
        },
        click() {
          for (const cb of listeners.get('click') ?? []) cb();
        },
        get textContent(): string {
          return ownText + children.map(c => c.textContent).join(' ');
        },
        set textContent(v: string) {
          ownText = String(v ?? '');
          children.length = 0;
        },
        querySelectorAll(sel: string): any[] {
          const m = sel.match(/^\[([a-zA-Z0-9_-]+)="([^"]+)"\]$/);
          const out: any[] = [];
          const walk = (node: any) => {
            if (m && node.getAttribute(m[1]) === m[2]) out.push(node);
            for (const ch of node._children ?? []) walk(ch);
          };
          walk(el);
          return out;
        },
        _children: children,
      };
      return el;
    };
    const miniDoc: any = {
      head: makeMiniEl('head'),
      getElementById: () => null,
      createElement: (tag: string) => makeMiniEl(tag),
    };

    const dom = buildStorySummaryCardDom(miniDoc as Document, mergedParsed);
    expect(dom.getAttribute('data-tier')).toBe('micro');
    expect(dom.textContent).toContain('战地纪要 · 小摘要');
    expect(dom.textContent).toContain('阶段卷宗 · 中摘要');
    expect(dom.textContent).toContain('#2-20 楼');
    expect(dom.textContent).toContain('第一幕·恶土破冰与主基地电网保卫战');
    expect(dom.querySelectorAll('[data-test="story-summary-extra-section"]')).toHaveLength(1);
    const toggleHeader = dom.querySelectorAll('[data-test="story-summary-toggle"]')[0];
    toggleHeader.click();
    expect(dom.classList.contains('is-expanded')).toBe(true);
  });
});

