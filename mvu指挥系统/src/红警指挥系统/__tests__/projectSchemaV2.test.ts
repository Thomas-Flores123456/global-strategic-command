/**
 * V2-01 · Project 判别联合 schema 测试（仓段化 V2 设计案 §3.2 / §8 冻结决策；任务包 §9.1）
 * 覆盖：V1 旧档解析零变化 / V2 模块实例解析与默认值兑底 / 判别联合误用拒收
 *       （V1 带 modules / V2 带 phases）/ grade「巨构」档（D-C2）/ theater bases≥2 对 V2 生效（D21）/
 *       schema_version 缺省=1 / 判别守卫 isProjectV2·isProjectV1 / projects[] 元素级 V1·V2 共存。
 */
import { describe, expect, it } from 'vitest';
import {
  isProjectV1,
  isProjectV2,
  PROJECT_SCHEMA_VERSION,
  PROJECT_SCHEMA_VERSION_V2,
  ProjectModule,
  Schema,
} from '../core/schema';

/** 最小合法 V1 工程（口径对齐 projectSchema.test.ts baseProject） */
const v1Project = {
  id: 'proj:grizzly-01',
  ref: '灰熊坦克现代化改装工程',
  grade: '大改',
};

/** 最小合法 V2 工程（模块拓扑；对齐设计案 §3.1 轨道船坞示例的最小实例） */
const v2Project = {
  id: 'proj:orbital-shipyard-01',
  ref: '轨道船坞',
  grade: '巨构',
  status: '在建',
  schema_version: PROJECT_SCHEMA_VERSION_V2,
  modules: [{ id: 'core' }],
};

describe('V2-01 · Project 判别联合 schema', () => {
  it('V1 旧档解析零变化：缺省兑底输出与 V1 单轴时代逐键相等', () => {
    const data = Schema.parse({ projects: [v1Project] });
    expect(data.projects).toHaveLength(1);
    expect(data.projects![0]).toEqual({
      id: 'proj:grizzly-01',
      ref: '灰熊坦克现代化改装工程',
      scope: 'base',
      bases: [],
      lead_base: '',
      grade: '大改',
      status: '规划中',
      phases: [],
      outcome: { type: 'mark' },
      schema_version: PROJECT_SCHEMA_VERSION,
    });
    // 显式 schema_version: 1 同样逐键相等（判别键显式声明不改 V1 输出）
    expect(Schema.parse({ projects: [{ ...v1Project, schema_version: 1 }] }).projects![0]).toEqual(
      data.projects![0],
    );
  });

  it('V2 模块实例解析：modules[].默认值兑底（name/status/base/queue_index）', () => {
    const data = Schema.parse({ projects: [v2Project] });
    expect(data.projects![0]).toEqual({
      id: 'proj:orbital-shipyard-01',
      ref: '轨道船坞',
      scope: 'base',
      bases: [],
      lead_base: '',
      grade: '巨构',
      status: '在建',
      modules: [{ id: 'core', name: '', status: '未启动', base: '', queue_index: null }],
      outcome: { type: 'mark' },
      schema_version: PROJECT_SCHEMA_VERSION_V2,
    });
    // 全字段显式实例（对齐设计案 §3.2 字段形状）
    const full = Schema.parse({
      projects: [
        {
          ...v2Project,
          scope: 'theater',
          bases: ['beipo', 'orbital'],
          lead_base: 'beipo',
          modules: [
            { id: 'core', name: '核心舱', status: '进行中', base: 'beipo', queue_index: 0 },
            { id: 'hab', name: '居住舱', status: '未启动', base: 'orbital', queue_index: null },
          ],
        },
      ],
    });
    const fullP = full.projects![0];
    if (!isProjectV2(fullP)) throw new Error('fixture 应为 V2 工程');
    expect(fullP.modules.map(m => m.name)).toEqual(['核心舱', '居住舱']);
  });

  it('ProjectModule 直解：status 五态枚举、queue_index 非负整数或 null', () => {
    expect(ProjectModule.parse({ id: 'core' })).toEqual({ id: 'core', name: '', status: '未启动', base: '', queue_index: null });
    expect(ProjectModule.safeParse({ id: 'x', status: '搁置' }).success).toBe(false);
    expect(ProjectModule.safeParse({ id: 'x', queue_index: -1 }).success).toBe(false);
    expect(ProjectModule.safeParse({ id: 'x', queue_index: 1.5 }).success).toBe(false);
    expect(ProjectModule.safeParse({ id: 'x', queue_index: null }).success).toBe(true);
    expect(ProjectModule.safeParse({ queue_index: null }).success).toBe(false); // id 必填
  });

  it('判别联合误用拒收：V1 带 modules / V2 带 phases 一律拒绝', () => {
    expect(
      Schema.safeParse({ projects: [{ ...v1Project, schema_version: 1, modules: [{ id: 'core' }] }] }).success,
    ).toBe(false);
    expect(
      Schema.safeParse({ projects: [{ ...v2Project, phases: [{ idx: 0 }] }] }).success,
    ).toBe(false);
    // 判别键越界（3）与 V2 modules 空数组同样拒收
    expect(Schema.safeParse({ projects: [{ ...v1Project, schema_version: 3 }] }).success).toBe(false);
    expect(Schema.safeParse({ projects: [{ ...v2Project, modules: [] }] }).success).toBe(false);
  });

  it('grade「巨构」档（D-C2）：V1/V2 均可声明；枚举外值仍拒', () => {
    expect(Schema.safeParse({ projects: [{ ...v2Project, grade: '巨构' }] }).success).toBe(true);
    expect(Schema.safeParse({ projects: [{ ...v1Project, grade: '巨构' }] }).success).toBe(true);
    expect(Schema.safeParse({ projects: [{ ...v1Project, grade: '特改' }] }).success).toBe(false);
  });

  it('theater bases≥2（D21）对 V2 生效：单基地 theater 拒、双基地过、单基地 base 过', () => {
    expect(Schema.safeParse({ projects: [{ ...v2Project, scope: 'theater', bases: ['beipo'] }] }).success).toBe(false);
    expect(
      Schema.safeParse({ projects: [{ ...v2Project, scope: 'theater', bases: ['beipo', 'orbital'] }] }).success,
    ).toBe(true);
    // D-C3 不强制多基地：V2 单基地 scope='base' 合法
    expect(Schema.safeParse({ projects: [{ ...v2Project, scope: 'base', bases: ['beipo'] }] }).success).toBe(true);
  });

  it('schema_version 缺省=1：无判别键输入解析为 V1（旧档零迁移口径延续）', () => {
    const r = Schema.safeParse({ projects: [v1Project] });
    expect(r.success).toBe(true);
    if (!r.success) return;
    const p = r.data.projects![0];
    expect(p.schema_version).toBe(1);
    expect(isProjectV1(p)).toBe(true);
    expect(isProjectV2(p)).toBe(false);
    expect('phases' in p && p.phases).toEqual([]);
  });

  it('判别守卫：isProjectV2/isProjectV1 互斥且与判别键一致', () => {
    const data = Schema.parse({ projects: [v1Project, v2Project] });
    const [p1, p2] = data.projects!;
    expect(isProjectV1(p1)).toBe(true);
    expect(isProjectV2(p1)).toBe(false);
    expect(isProjectV1(p2)).toBe(false);
    expect(isProjectV2(p2)).toBe(true);
    // 守卫收窄后字段可安全访问（V2 无 phases / V1 无 modules 为类型层事实，此处钉运行时同事实）
    if (isProjectV2(p2)) {
      expect(p2.modules).toHaveLength(1);
      expect('phases' in p2).toBe(false);
    }
    if (isProjectV1(p1)) {
      expect(p1.phases).toEqual([]);
      expect('modules' in p1).toBe(false);
    }
  });

  it('projects[] 元素级共存（P0-2 并入而非重构）：V1 与 V2 同根数组解析互不干扰', () => {
    const data = Schema.parse({ projects: [v1Project, v2Project] });
    expect(data.projects).toHaveLength(2);
    expect(data.projects!.map(p => p.schema_version)).toEqual([1, 2]);
    // zod 往返序列化无损
    const round = Schema.parse(JSON.parse(JSON.stringify(data)));
    expect(round).toEqual(data);
  });
});
