/**
 * ENG-SCHEMA-01 · projects[] MVU schema 挂载测试（工程玩法 MVP 任务包 §3.1；D1-C/D2-A/D21）
 * 覆盖：旧档零注入 / 完整条目默认值兑底 / zod 往返序列化无损 / theater bases≥2 校验 /
 *       非法 status·grade·id 拒绝 / QueueItem.type 扩「工程」 / migrateV1toV2 迁移链兼容。
 */
import { describe, expect, it } from 'vitest';
import { migrateV1toV2, PROJECT_SCHEMA_VERSION, Schema, type ProjectV1 } from '../core/schema';

/** 最小合法 base 工程 */
const baseProject = {
  id: 'proj:grizzly-01',
  ref: '灰熊坦克现代化改装工程',
  grade: '大改',
};

describe('ENG-SCHEMA-01 · projects[] 挂载', () => {
  it('旧档零迁移报错：无 projects 字段解析通过且输出零注入', () => {
    const legacy = Schema.parse({
      meta: { world_id: 'xiuzhen', date: '2042-03-14', day_count: 1 },
      queues: [{ type: '研究', item: '超时空位移工学' }],
    });
    expect(legacy.projects).toBeUndefined();
    expect(Object.keys(legacy)).not.toContain('projects');
    expect(JSON.stringify(legacy)).not.toContain('projects');
  });

  it('完整条目解析：默认值兑底（scope/lead_base/status/phases/outcome/schema_version）', () => {
    const data = Schema.parse({
      projects: [
        baseProject,
        {
          ...baseProject,
          id: 'proj:ptr-02',
          ref: '爱国者阵地改造工程',
          scope: 'theater',
          bases: ['beipo', 'huiya'],
          lead_base: 'beipo',
          grade: '中改',
          status: '在建',
          phases: [{ idx: 0, name: '方案与备料' }, { idx: 1, name: '施工', status: '进行中', queue_index: 2 }],
          outcome: { type: 'variant' },
          schema_version: 1,
        },
      ],
    });
    expect(data.projects).toHaveLength(2);
    // 默认值兑底
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
    // 阶段默认值：status '未启动' / queue_index null（V2-01 判别联合：断言目标不变，仅收窄接收者类型）
    expect((data.projects![1] as ProjectV1).phases[0]).toEqual({ idx: 0, name: '方案与备料', status: '未启动', queue_index: null });
    expect((data.projects![1] as ProjectV1).phases[1].queue_index).toBe(2);
  });

  it('zod 往返序列化无损：parse → JSON 序列化 → parse 输出逐键相等', () => {
    const input = {
      meta: { world_id: 'xiuzhen', date: '2042-03-14', day_count: 7 },
      projects: [
        {
          ...baseProject,
          bases: ['beipo'],
          lead_base: 'beipo',
          status: '在建',
          phases: [{ idx: 0, name: '方案与备料', status: '进行中', queue_index: 0 }],
        },
      ],
      queues: [{ type: '工程', item: '灰熊坦克现代化改装工程·阶段一', base: 'beipo' }],
    };
    const first = Schema.parse(input);
    const second = Schema.parse(JSON.parse(JSON.stringify(first)));
    expect(second).toEqual(first);
  });

  it('theater 校验：bases<2 拒绝，bases≥2 通过；base 工程单基地通过', () => {
    expect(
      Schema.safeParse({ projects: [{ ...baseProject, scope: 'theater', bases: ['beipo'] }] }).success,
    ).toBe(false);
    expect(
      Schema.safeParse({ projects: [{ ...baseProject, scope: 'theater', bases: ['beipo', 'huiya'] }] }).success,
    ).toBe(true);
    expect(Schema.safeParse({ projects: [{ ...baseProject, bases: ['beipo'] }] }).success).toBe(true);
  });

  it('非法枚举拒绝：status/grade/scope/id 前缀越界即拒', () => {
    expect(Schema.safeParse({ projects: [{ ...baseProject, status: '搁置' }] }).success).toBe(false);
    expect(Schema.safeParse({ projects: [{ ...baseProject, grade: '特改' }] }).success).toBe(false);
    expect(Schema.safeParse({ projects: [{ ...baseProject, scope: 'global' }] }).success).toBe(false);
    expect(Schema.safeParse({ projects: [{ ...baseProject, id: 'grizzly-01' }] }).success).toBe(false);
  });

  it("QueueItem.type 枚举扩「工程」：工程投影项可入队，旧五类不受影响", () => {
    const data = Schema.parse({
      queues: [
        { type: '工程', item: '灰熊坦克现代化改装工程·阶段一', base: 'beipo', lane: 'eng:main' },
        { type: '建造', item: '发电厂' },
      ],
    });
    expect(data.queues[0].type).toBe('工程');
    expect(data.queues[1].type).toBe('建造');
    expect(Schema.safeParse({ queues: [{ type: '维护', item: 'x' }] }).success).toBe(false);
  });

  it('迁移链兼容：v1 旧档经 migrateV1toV2 后解析通过；v2 带 projects 档原样通过迁移', () => {
    // v1 修真旧档（无 projects）：迁移后 schema_version 升格且解析成功、零注入
    const v1 = migrateV1toV2({ meta: { world_id: 'old' }, economy: { copper: 5 } });
    const migrated = Schema.parse(v1);
    expect(migrated.projects).toBeUndefined();
    // v2 档带 projects：迁移函数原样放行（非 v1 不动），解析无损
    const v2WithProjects = {
      schema_version: 2,
      projects: [{ ...baseProject, bases: ['beipo'], lead_base: 'beipo' }],
    };
    const passthrough = migrateV1toV2(v2WithProjects);
    expect(passthrough).toBe(v2WithProjects);
    const parsed = Schema.parse(passthrough);
    expect(parsed.projects![0].id).toBe('proj:grizzly-01');
  });
});
