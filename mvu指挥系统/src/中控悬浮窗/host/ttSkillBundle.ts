/**
 * ttSkillBundle.ts —— 战区条令 .ttskill 技能包管理器（PKG-D）
 *
 * 架构文档：docs/Architecture/TaruiTavern/README.md (§4.4)
 * 实施任务包：docs/Architecture/Future Developments/30-TauriTavern宿主适配与专属开发脚手架实施任务包.md (PKG-D)
 *
 * 核心职责：
 * 1. 基于 ttHostBridge 的 skill API 封装战区条令 `.ttskill` 技能包管理器；
 * 2. 内置核心战区条令技能包（世界书文风规范与 <数据> 块红线、R20 生产对账与六大战略资源双轨代偿规约），每个技能包均携带合规 YAML frontmatter 的 SKILL.md；
 * 3. 支持按需安装（skip / replace 冲突策略）、读取技能包文件与过滤已安装的战区条令技能列表；
 * 4. 在传统 SillyTavern 宿主或接口异常时安全降级，零未捕获异常。
 */

import {
  getTauriTavernBridge,
  ttHostBridge,
  type TauriTavernBridge,
  type TauriTavernSkillImportFile,
  type TauriTavernSkillIndexEntry,
} from './ttHostBridge';

export const GHQ_SKILL_SOURCE = 'extension:tavernweave-command-system';

export interface BundledTacticalSkillDefinition {
  name: string;
  description: string;
  source: string;
  files: TauriTavernSkillImportFile[];
}

export const BUNDLED_TACTICAL_SKILLS: readonly BundledTacticalSkillDefinition[] = [
  {
    name: 'ghq-worldbook-style-guide',
    description: '《世界书文风与受控质感编写规范》摘要与 <数据> 块结构红线',
    source: GHQ_SKILL_SOURCE,
    files: [
      {
        path: 'SKILL.md',
        content: [
          '---',
          'name: ghq-worldbook-style-guide',
          'description: "《世界书文风与受控质感编写规范》摘要与 <数据> 块结构红线"',
          '---',
          '',
          '# 世界书文风与受控质感编写规范（战区条令摘要）',
          '',
          '## 1. 叙事质感与行文准则',
          '- 采用干练、克制、具象的军事档案与战区技术简报口吻，避免空洞形容词堆砌与机器造词。',
          '- 设定正文聚焦战术定位、工程指标、战地表现与条令约束，保持段落层次清晰。',
          '',
          '## 2. `<数据>` 块红线契约',
          '- 每个机制词条末尾的 `<数据>...</数据>` 块为唯一机器可读真源，严禁破坏闭合标签或混入非协议注释。',
          '- 动态更新或归档补丁仅允许修改目标键名数值或受控字段，不得篡改既有词条的业务键结构。',
          '- 科技、建筑、单位、协议、机娘与扩展包词条必须严格遵守各自 Schema 字段定义与 R1-R27 校验规则。',
        ].join('\n'),
      },
    ],
  },
  {
    name: 'ghq-r20-production-audit',
    description: 'R20 生产对账、六大战略资源与双轨代偿核算规约',
    source: GHQ_SKILL_SOURCE,
    files: [
      {
        path: 'SKILL.md',
        content: [
          '---',
          'name: ghq-r20-production-audit',
          'description: "R20 生产对账、六大战略资源与双轨代偿核算规约"',
          '---',
          '',
          '# R20 生产对账与战略资源双轨代偿核算规约',
          '',
          '## 1. 六大战略资源分类',
          '- 战备物资核算覆盖六大基础与高阶战略资源类别，所有产线排产、建筑升级与单位列装均需经过资源平衡校验。',
          '',
          '## 2. 双轨代偿与 R20 生产对账规则',
          '- 当常规库存不足以覆盖当期排产消耗时，按照双轨代偿规约计算信用点折算或紧急调拨代偿差额。',
          '- 每轮工程日程推进与产线交割必须满足 R20 对账不变量：期初库存 + 本期产出 - 本期消耗 - 代偿折算 = 期末库存。',
          '- 严禁出现无账源的凭空增减或越过队列容量的超额排产。',
        ].join('\n'),
      },
    ],
  },
];

export interface TacticalSkillManagerDeps {
  hostWindow?: unknown;
}

export interface EnsureBundledSkillsResult {
  available: boolean;
  installed: string[];
  skipped: string[];
  failed: Array<{ name: string; reason: string }>;
}

export interface TacticalSkillManager {
  isAvailable(): boolean;
  ensureBundledSkillsInstalled(
    conflictStrategy?: 'skip' | 'replace',
  ): Promise<EnsureBundledSkillsResult>;
  /** 兼容别名 */
  ensureBundledTacticalSkills(
    conflictStrategy?: 'skip' | 'replace',
  ): Promise<EnsureBundledSkillsResult>;
  readTacticalSkillFile(
    name: string,
    path?: string,
    maxChars?: number,
  ): Promise<string | null>;
  listInstalledTacticalSkills(): Promise<TauriTavernSkillIndexEntry[]>;
}

const BUNDLED_SKILL_NAME_SET = new Set(
  BUNDLED_TACTICAL_SKILLS.map(skill => skill.name),
);

export function createTacticalSkillManager(
  deps?: TacticalSkillManagerDeps,
): TacticalSkillManager {
  function resolveBridge(): TauriTavernBridge {
    return deps && 'hostWindow' in deps
      ? getTauriTavernBridge(deps.hostWindow)
      : ttHostBridge;
  }

  function isAvailable(): boolean {
    return resolveBridge().skill !== null;
  }

  async function ensureBundledSkillsInstalled(
    conflictStrategy: 'skip' | 'replace' = 'skip',
  ): Promise<EnsureBundledSkillsResult> {
    const skillApi = resolveBridge().skill;
    if (!skillApi || typeof skillApi.installImport !== 'function') {
      return {
        available: false,
        installed: [],
        skipped: [],
        failed: [],
      };
    }

    const installed: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ name: string; reason: string }> = [];

    for (const def of BUNDLED_TACTICAL_SKILLS) {
      try {
        const filesPayload = def.files.map(f => ({ path: f.path, content: f.content }));
        let res;
        try {
          res = await skillApi.installImport({
            input: {
              kind: 'inlineFiles',
              name: def.name,
              source: def.source,
              files: filesPayload,
            },
            conflictStrategy,
          });
        } catch {
          res = await skillApi.installImport({
            input: {
              kind: 'inlineFiles',
              files: filesPayload,
            },
            conflictStrategy,
          });
        }

        const action = res?.action ?? 'installed';
        if (action === 'skipped' || action === 'already_installed') {
          skipped.push(def.name);
        } else {
          installed.push(def.name);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        failed.push({ name: def.name, reason });
      }
    }

    return {
      available: true,
      installed,
      skipped,
      failed,
    };
  }

  async function readTacticalSkillFile(
    name: string,
    path = 'SKILL.md',
    maxChars = 16000,
  ): Promise<string | null> {
    const skillApi = resolveBridge().skill;
    if (!skillApi || typeof skillApi.readFile !== 'function') {
      return null;
    }

    try {
      const res = await skillApi.readFile({
        name,
        path,
        maxChars,
      });
      return typeof res?.content === 'string' ? res.content : null;
    } catch {
      return null;
    }
  }

  async function listInstalledTacticalSkills(): Promise<TauriTavernSkillIndexEntry[]> {
    const skillApi = resolveBridge().skill;
    if (!skillApi || typeof skillApi.list !== 'function') {
      return [];
    }

    try {
      const raw = await skillApi.list();
      const entries: TauriTavernSkillIndexEntry[] = Array.isArray(raw)
        ? raw
        : Array.isArray(raw?.skills)
          ? raw.skills
          : [];

      return entries.filter(entry => {
        if (!entry || typeof entry.name !== 'string') return false;
        return (
          entry.source === GHQ_SKILL_SOURCE ||
          BUNDLED_SKILL_NAME_SET.has(entry.name) ||
          entry.name.startsWith('ghq-')
        );
      }).map(entry => ({
        ...entry,
        source: entry.source ?? GHQ_SKILL_SOURCE,
      }));
    } catch {
      return [];
    }
  }

  return {
    isAvailable,
    ensureBundledSkillsInstalled,
    ensureBundledTacticalSkills: ensureBundledSkillsInstalled,
    readTacticalSkillFile,
    listInstalledTacticalSkills,
  };
}
