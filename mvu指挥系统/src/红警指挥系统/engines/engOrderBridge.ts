/**
 * engOrderBridge.ts —— <工程> 工程令接缝（CTRL-ENG-PROTO-01 · DIR-9 D-R9-c/D-R9-e；V2-05 起仓段化分流）
 *
 * 真源：docs/project/plans/工程玩法-脑暴决策记录-2026-10-10.md §10 DIR-9（2026-10-11）；
 *       docs/project/plans/工程玩法MVP任务包.md §6 ENG-PROTO-01 任务卡、§9.1 V2-05 卡、§9.2 D-TH-1/D-TH-2；
 *       docs/project/plans/仓段化V2设计案-草案.md §6（LLM 指令协议扩展）。
 *
 * 工程与科研观察者投影、指令校验与调度总线动词对齐辅助已拆至 ./engOrderHelpers，本入口保持完整 Re-export。
 */
import type { ProjectDef, RetrofitDef } from '../core/catalog';
import {
  buildEntityCredibilityIndex,
  evaluateEntityCredibility,
  type CatalogEntityLike,
} from '../core/entityCredibility';
import { isProjectV2, type Project, type ProjectV2 } from '../core/schema';
import { canon, type EngOrder, type ParseEvent, type QuarantineItem } from '../parse/parsePipeline';
import {
  fromEngineeringOrder,
  fromEngineeringOrders,
  toEngineeringCommandText,
  toEngineeringOrder,
  type EngineeringDispatchOrderInput,
  type UnifiedCommand,
  type UnifiedCommandType,
} from './dispatchBus';
import { projectEventToParseEvent } from './engOrderHelpers';
import {
  allocateProjectInstanceId,
  assignModuleBase,
  cancelProject,
  cancelProjectV2,
  findProjectIndex,
  investModule,
  pauseModule,
  pauseProject,
  pauseProjectV2,
  projectionItemName,
  resolveEngModuleIndex,
  resumeModule,
  resumeProject,
  resumeProjectV2,
  startPhase,
  startProject,
  startProjectV2,
  type AssignModuleBaseParams,
  type AssignModuleBaseResult,
  type ProjectCommandResult,
  type ProjectStateView,
} from './projectEngine';

export {
  allocateProjectInstanceId,
  assignModuleBase,
  fromEngineeringOrder,
  fromEngineeringOrders,
  toEngineeringCommandText,
  toEngineeringOrder,
  type AssignModuleBaseParams,
  type AssignModuleBaseResult,
  type EngineeringDispatchOrderInput,
  type UnifiedCommand,
  type UnifiedCommandType,
};
export * from './engOrderHelpers';

/** 接缝结转产物：新状态 + 留痕（事件入报告流水，拒收令入隔离区） */
export interface EngBridgeResult<S> {
  next: S;
  events: ParseEvent[];
  quarantine: QuarantineItem[];
}

/**
 * 模块定位（V2-05 · 设计案 §6）：载荷 module 键按 id 优先、name 兜底唯一匹配。
 * - id 唯一命中 → 模块 id；id 未命中 → name 唯一命中 → 模块 id；
 * - 任一通道多义 → null（调用方隔离）；两通道皆未命中 → undefined（调用方隔离）。
 */
export function resolveEngModuleId(project: ProjectV2, raw: string): string | null | undefined {
  const index = resolveEngModuleIndex(project, raw);
  return index === null || index === undefined ? index : project.modules[index].id;
}

/** 支持跨基地模块指派（指派 / allocate）的工程指令输入结构 */
export type BridgeEngOrderInput = Omit<EngOrder, 'verb'> & {
  verb?: EngOrder['verb'] | '指派' | '分配' | 'allocate' | 'Allocate';
  action?: 'allocate' | 'Allocate' | '指派' | '分配' | EngOrder['verb'];
  targetBase?: string;
  projectRef?: string;
  moduleId?: string;
};

/**
 * EngOrder[] 逐条结转 projectEngine（按声明序；每令基于上一令产物状态；V2-05 起按实例 schema_version 分流）。
 * retrofits/projects 缺席（空数组）时立项/注资因 def 解析失败拒收留痕，
 * 暂停/恢复/取消不受影响（V2 模块级经引擎 not_found 拒收；工程级免 def）。
 * projects 参数缺省空数组：既有三参调用点（V1-only 场景/旧测试）行为零变化。
 */
export function applyEngOrders<S extends ProjectStateView>(
  state: S,
  orders: readonly BridgeEngOrderInput[],
  retrofits: readonly RetrofitDef[],
  projects: readonly ProjectDef[] = [],
): EngBridgeResult<S> {
  let next = state;
  const events: ParseEvent[] = [];
  const quarantine: QuarantineItem[] = [];

  /** 接缝级拒收留痕（🟡 事件 + 🔴 隔离区元素；账本不动） */
  const rejectOrder = (order: BridgeEngOrderInput, error: string, detail: string): void => {
    const verbTag = order.verb ?? order.action ?? '未知';
    events.push({ light: '🟡', layer: 'instruction', path: 'projects', message: `[工程] ${detail}` });
    quarantine.push({ scope: 'element', tag: '工程', path: `工程.${verbTag}`, raw: JSON.stringify(order), error });
  };

  const credibilityIndex =
    retrofits.length > 0 || projects.length > 0
      ? buildEntityCredibilityIndex({
          retrofits: retrofits as unknown as readonly CatalogEntityLike[],
          projects: projects as unknown as readonly CatalogEntityLike[],
        })
      : null;

  const findExactDef = (name: string): RetrofitDef | undefined =>
    retrofits.find(r => canon(r.name) === canon(name));
  const findExactProjectDef = (name: string): ProjectDef | undefined =>
    projects.find(p => canon(p.name) === canon(name));

  const pushAlignEvent = (rawName: string, matchedName: string): void => {
    events.push({
      light: '🟢',
      layer: 'instruction',
      path: 'projects',
      message: `[工程] 名称对齐：「${rawName}」→「${matchedName}」`,
    });
  };

  const findDef = (name: string, emitEvent = true): RetrofitDef | undefined => {
    const exact = findExactDef(name);
    if (exact) return exact;
    if (!credibilityIndex || retrofits.length === 0) return undefined;
    if (findExactProjectDef(name)) return undefined;
    const cred = evaluateEntityCredibility(credibilityIndex, name, {
      domain: 'retrofit',
      highThreshold: 0.78,
    });
    if (cred.verdict === 'system_high' && cred.matchedName) {
      const matched = retrofits.find(r => r.name === cred.matchedName);
      if (matched) {
        if (emitEvent) pushAlignEvent(name, matched.name);
        return matched;
      }
    }
    return undefined;
  };

  const findProjectDef = (name: string, emitEvent = true): ProjectDef | undefined => {
    const exact = findExactProjectDef(name);
    if (exact) return exact;
    if (!credibilityIndex || projects.length === 0) return undefined;
    if (findExactDef(name)) return undefined;
    const cred = evaluateEntityCredibility(credibilityIndex, name, {
      domain: 'project',
      highThreshold: 0.78,
    });
    if (cred.verdict === 'system_high' && cred.matchedName) {
      const matched = projects.find(p => p.name === cred.matchedName);
      if (matched) {
        if (emitEvent) pushAlignEvent(name, matched.name);
        return matched;
      }
    }
    return undefined;
  };

  /** 实例定位（D-TH-1 修复口径）：复用引擎 findProjectIndex（id 优先/ref 兜底、非终态优先、最新在前）；未精确命中时支持可信度对齐 */
  const locateInstance = (id: string): Project | undefined => {
    const idx = findProjectIndex(next, id);
    if (idx >= 0) return (next.projects ?? [])[idx];
    if (id && !id.startsWith('proj:')) {
      const alignedDef = findProjectDef(id, false) ?? findDef(id, false);
      if (alignedDef) {
        const alignedIdx = findProjectIndex(next, alignedDef.name);
        if (alignedIdx >= 0) {
          pushAlignEvent(id, alignedDef.name);
          return (next.projects ?? [])[alignedIdx];
        }
      }
    }
    return undefined;
  };

  for (const rawOrder of orders) {
    const actionOrVerb = rawOrder.verb ?? rawOrder.action;
    const isAllocateOrder =
      actionOrVerb === '指派' ||
      actionOrVerb === '分配' ||
      actionOrVerb === 'allocate' ||
      actionOrVerb === 'Allocate' ||
      rawOrder.action === 'allocate' ||
      rawOrder.action === 'Allocate' ||
      rawOrder.action === '指派' ||
      rawOrder.action === '分配';

    if (isAllocateOrder) {
      const projectRef = (rawOrder.id ?? rawOrder.projectRef ?? rawOrder.name ?? '').trim();
      const rawModule = (rawOrder.module ?? rawOrder.moduleId ?? '').trim();
      const targetBase = (rawOrder.base ?? rawOrder.targetBase ?? '').trim();
      if (!rawModule) {
        rejectOrder(
          rawOrder,
          `指派令目标「${projectRef}」缺少 module 键（跨基地模块指派必须指定模块 id 或名称）`,
          `指派令拒收：工程「${projectRef}」跨基地指派缺少目标模块——不动账本`,
        );
        continue;
      }
      const existing = locateInstance(projectRef);
      let moduleId = rawModule;
      if (existing && isProjectV2(existing)) {
        const resolvedMod = resolveEngModuleId(existing, rawModule);
        if (resolvedMod === null) {
          rejectOrder(
            rawOrder,
            `指派令模块「${rawModule}」匹配多个模块，请改用模块 id`,
            `指派令拒收：「${existing.ref}」模块「${rawModule}」歧义——不动账本`,
          );
          continue;
        }
        if (resolvedMod === undefined) {
          rejectOrder(rawOrder, `工程「${existing.ref}」无模块「${rawModule}」`, '指派令模块不存在——不动账本');
          continue;
        }
        moduleId = resolvedMod;
        const targetMod = existing.modules.find(m => m.id === moduleId);
        const currentModBase = (targetMod?.base || existing.lead_base || '').trim();
        if (
          targetMod &&
          targetMod.status === '进行中' &&
          targetBase &&
          currentModBase &&
          canon(currentModBase) === canon(targetBase)
        ) {
          const updatedMod = { ...targetMod, base: currentModBase, assigned_base: currentModBase };
          const updatedProject: ProjectV2 = {
            ...existing,
            modules: existing.modules.map(m => (m.id === moduleId ? updatedMod : m)),
          };
          next = {
            ...next,
            projects: (next.projects ?? []).map(p => (p.id === existing.id ? updatedProject : p)),
          };
          events.push(
            projectEventToParseEvent({
              type: 'module_allocated',
              item: projectionItemName(existing.ref, targetMod.name || targetMod.id),
              detail: `模块「${targetMod.name}」（${targetMod.id}）承建基地确认指派为「${currentModBase}」${rawOrder.reason ? `（${rawOrder.reason}）` : ''}`,
            }),
          );
          continue;
        }
      }
      const allocResult = assignModuleBase(next, {
        projectRef: existing?.id ?? projectRef,
        moduleId,
        targetBase,
        reason: rawOrder.reason,
      });
      if (allocResult.ok && allocResult.next) {
        next = allocResult.next;
        for (const e of allocResult.events) events.push(projectEventToParseEvent(e));
      } else {
        const reasonCode = allocResult.reason ?? 'invalid_bases';
        const msg = allocResult.error ?? allocResult.message ?? '跨基地模块指派失败';
        events.push({
          light: '🟡',
          layer: 'instruction',
          path: 'projects',
          message: `[工程] 指派令被引擎拒收（${reasonCode}）：${msg}`,
        });
        quarantine.push({
          scope: 'element',
          tag: '工程',
          path: '工程.指派',
          raw: JSON.stringify(rawOrder),
          error: `指派令被引擎拒收（${reasonCode}）`,
          suggestion: msg,
        });
      }
      continue;
    }

    const order = rawOrder as EngOrder;
    // DIR-9 回执回路：驳回只有叙事、账本不动；理由已在解析层强制非空
    if (order.verb === '驳回') {
      events.push({
        light: '🟢',
        layer: 'instruction',
        path: 'projects',
        message: `[工程] 驳回回执${order.id !== undefined ? `「${order.id}」` : ''}：${order.reason}（账本不动）`,
      });
      continue;
    }

    let result: ProjectCommandResult<S> | undefined;
    switch (order.verb) {
      case '立项': {
        // def 合并池路由（V2-05 · 设计案 §6）：先 PROJECTS（仓段化 project def）→ startProjectV2；
        // 未命中 project def 再查 retrofits → startProject（V1 现状零变化）；跨池同名歧义 fail-closed 拒收。
        const rawOrderName = order.name ?? '';
        const projectDef = order.name !== undefined ? findProjectDef(order.name, false) : undefined;
        const retrofitDef = order.name !== undefined ? findDef(order.name, false) : undefined;
        if (projectDef && retrofitDef) {
          rejectOrder(
            order,
            `立项令「${rawOrderName}」在工程目录跨池同名（catalog.projects 与 catalog.retrofits 各有命中），拒收`,
            `立项令拒收：「${rawOrderName}」跨池同名定义（project/retrofit 各一）——不虚构路由，请世界书侧消歧`,
          );
          continue;
        }
        if (projectDef) {
          if (!findExactProjectDef(rawOrderName)) {
            pushAlignEvent(rawOrderName, projectDef.name);
          }
          result = startProjectV2(next, projectDef, { base: order.base ?? '' });
          break;
        }
        if (!retrofitDef) {
          rejectOrder(
            order,
            `立项令静态定义「${rawOrderName}」不在工程目录（catalog.retrofits/projects），拒收`,
            `立项令拒收：静态定义「${rawOrderName}」不在工程目录——不虚构资格、不动账本（D-R9-a）`,
          );
          continue;
        }
        if (!findExactDef(rawOrderName)) {
          pushAlignEvent(rawOrderName, retrofitDef.name);
        }
        result = startProject(next, retrofitDef, { base: order.base ?? '' });
        break;
      }
      case '注资': {
        // 实例定位统一走 findProjectIndex（D-TH-1：非终态优先）；实例缺席按 not_found 拒收
        const project = locateInstance(order.id ?? '');
        if (!project) {
          rejectOrder(
            order,
            `注资令目标实例「${order.id ?? ''}」不存在（fail-closed，同引擎 not_found）`,
            `注资令拒收：工程实例「${order.id ?? ''}」不存在——不动账本`,
          );
          continue;
        }
        if (isProjectV2(project)) {
          // V2 仓段化：只认 module 不认 phase（维度错配在本层裁决，解析层不知实例版本）
          if (order.phase !== undefined) {
            rejectOrder(
              order,
              `注资令目标「${project.id}」为仓段化 V2 工程，缺 module 键且不认 phase 键（与 module 互斥，V2 只认 module）`,
              `注资令拒收：「${project.ref}」是仓段化工程——阶段号 phase 是 V1 线性工程口径`,
            );
            continue;
          }
          const def = findProjectDef(project.ref);
          let moduleId: string | null | undefined;
          if (order.module === undefined) {
            const readyModules = (project.modules ?? []).filter(m => {
              if (m.status !== '未启动') return false;
              const defMod = def?.modules.find(dm => dm.id === m.id);
              const prereqs = defMod?.prereqs ?? [];
              return prereqs.every(pid => project.modules.some(pm => pm.id === pid && pm.status === '完工'));
            });
            if (readyModules.length !== 1) {
              rejectOrder(
                order,
                `注资令目标「${project.id}」为仓段化 V2 工程，缺 module 键（V2 只认 module，不认 phase）`,
                `注资令拒收：「${project.ref}」是仓段化工程——请携带模块定位，示例 注资: {id: ${project.id}, module: <模块 id 或名>}`,
              );
              continue;
            }
            moduleId = readyModules[0].id;
          } else {
            moduleId = resolveEngModuleId(project, order.module);
            if (moduleId === null) {
              rejectOrder(
                order,
                `注资令模块「${order.module}」匹配多个模块，请改用模块 id`,
                `注资令拒收：「${project.ref}」模块「${order.module}」歧义——不动账本`,
              );
              continue;
            }
            if (moduleId === undefined) {
              rejectOrder(
                order,
                `注资令工程「${project.ref}」无模块「${order.module}」（id/name 均未命中）`,
                `注资令拒收：模块「${order.module}」不存在——不动账本`,
              );
              continue;
            }
          }
          if (!def) {
            rejectOrder(
              order,
              `注资令静态定义「${project.ref}」不在工程目录（catalog.projects），拒收`,
              `注资令拒收：静态定义「${project.ref}」不在仓段化工程目录——不动账本`,
            );
            continue;
          }
          result = investModule(
            next,
            project.id,
            moduleId,
            def,
            order.base ? { base: order.base } : undefined,
          );
          break;
        }
        // V1 线性：只认 phase 不认 module
        if (order.module !== undefined) {
          rejectOrder(
            order,
            `注资令目标「${project.id}」为 V1 线性工程，不认 module 键（V1 只认 phase）`,
            `注资令拒收：「${project.ref}」是线性阶段工程——仓段 module 键不适用`,
          );
          continue;
        }
        const def = findDef(project.ref);
        if (!def) {
          rejectOrder(
            order,
            `注资令静态定义「${project.ref}」不在工程目录（catalog.retrofits），拒收`,
            `注资令拒收：静态定义「${project.ref}」不在工程目录——不动账本`,
          );
          continue;
        }
        let targetPhase = order.phase;
        if (targetPhase === undefined) {
          const phases = Array.isArray(project.phases) ? project.phases : [];
          const readyPhase = phases.find(
            (p, idx) => p.status === '未启动' && phases.slice(0, idx).every(prev => prev.status === '完工'),
          );
          const firstUnstarted = phases.find(p => p.status === '未启动');
          targetPhase = readyPhase?.idx ?? firstUnstarted?.idx ?? -1;
        }
        result = startPhase(next, project.id, targetPhase, def);
        break;
      }
      case '暂停':
      case '恢复': {
        const project = locateInstance(order.id ?? '');
        if (order.module !== undefined) {
          // 模块级令（V2 专用）：实例缺席直通引擎按 not_found 拒收（引擎是裁决点，对齐 V1 工程级先例）
          if (!project) {
            result =
              order.verb === '暂停'
                ? pauseModule(next, order.id ?? '', order.module)
                : resumeModule(next, order.id ?? '', order.module);
            break;
          }
          if (!isProjectV2(project)) {
            // V1 实例 + module：维度错配拒收（V1 无仓段模块，模块级暂停/恢复不适用）
            rejectOrder(
              order,
              `工程令目标「${project.id}」为 V1 线性工程，不认 module 键（模块级暂停/恢复仅仓段化 V2 适用）`,
              `${order.verb}令拒收：线性阶段工程无仓段模块——工程级令请省略 module 键`,
            );
            continue;
          }
          const moduleId = resolveEngModuleId(project, order.module);
          if (moduleId === null) {
            rejectOrder(
              order,
              `工程令模块「${order.module}」匹配多个模块，请改用模块 id`,
              `${order.verb}令拒收：「${project.ref}」模块「${order.module}」歧义——不动账本`,
            );
            continue;
          }
          if (moduleId === undefined) {
            rejectOrder(
              order,
              `工程令工程「${project.ref}」无模块「${order.module}」（id/name 均未命中）`,
              `${order.verb}令拒收：模块「${order.module}」不存在——不动账本`,
            );
            continue;
          }
          result =
            order.verb === '暂停' ? pauseModule(next, project.id, moduleId) : resumeModule(next, project.id, moduleId);
          break;
        }
        // 工程级令：V2 实例走 V2 工程级；V1/实例缺席走 V1 函数（引擎拒 not_found，现状零变化）
        if (project && isProjectV2(project)) {
          result = order.verb === '暂停' ? pauseProjectV2(next, project.id) : resumeProjectV2(next, project.id);
          break;
        }
        result = order.verb === '暂停' ? pauseProject(next, order.id ?? '') : resumeProject(next, order.id ?? '');
        break;
      }
      case '取消': {
        // 取消恒工程级：解析层已整令隔离 module 键；此处防御性再拒（EngOrder 为公开类型，直构直调亦不可越界）
        if (order.module !== undefined) {
          rejectOrder(
            order,
            '取消令不认 module 键（取消是工程级操作；模块级停工请用 暂停: {id, module: <模块>}）',
            `取消令拒收：模块级取消不存在——「${order.id ?? ''}」按工程级重发或改用暂停令`,
          );
          continue;
        }
        const project = locateInstance(order.id ?? '');
        if (project && isProjectV2(project)) {
          const def = findProjectDef(project.ref); // 结算金额点名用；缺席按无金额口径结算（引擎兼容）
          result = cancelProjectV2(next, project.id, def);
          break;
        }
        result = cancelProject(next, order.id ?? '');
        break;
      }
    }

    if (!result) continue;
    if (result.ok) {
      next = result.next;
      for (const e of result.events) events.push(projectEventToParseEvent(e));
    } else {
      // 引擎失败返回留痕（🟡/🔴 双通道），不得静默吞（ENG-PROTO-01 任务卡）
      events.push({
        light: '🟡',
        layer: 'instruction',
        path: 'projects',
        message: `[工程] ${order.verb}令被引擎拒收（${result.reason}）：${result.message}`,
      });
      quarantine.push({
        scope: 'element',
        tag: '工程',
        path: `工程.${order.verb}`,
        raw: JSON.stringify(order),
        error: `${order.verb}令被引擎拒收（${result.reason}）`,
        suggestion: result.message,
      });
    }
  }
  return { next, events, quarantine };
}
