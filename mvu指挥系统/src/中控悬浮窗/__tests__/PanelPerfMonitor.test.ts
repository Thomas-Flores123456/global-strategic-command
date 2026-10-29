/**
 * PanelPerfMonitor.test.ts —— CTRL-PERF-MONITOR-01：中控悬浮窗运行时性能监测器与设置窗挂载验收单测
 *
 * 覆盖：
 * 1. perfMonitor 核心遥测能力：recordPerfSample（耗时/峰值/均值/缓存命中率/脏标记跳过）、
 *    measurePerfSync / measurePerfAsync、recordLongTaskSample（>50ms 门限）、evaluatePerfHealthGrade；
 * 2. 跨帧 DOM 拓扑盘点与 JS 堆内存快照（sampleDomTopology / sampleMemoryUsage）；
 * 3. 一键管线微基准自检（runPerfPipelineBenchmark）与结构化 JSON 诊断报告导出（exportPerfDiagnosticReport）；
 * 4. PanelPerfMonitor.vue SSR 首帧渲染与 ModalSettings.vue 左栏「性能监测」分组（#panel-perf）挂载契约；
 * 5. 只读安全红线：零 MVU 楼层变量写入、零世界书写入 API。
 */

/* eslint-disable import-x/no-nodejs-modules -- 测试即时编译 SFC 临时产物与读取源码 */
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
/* eslint-enable import-x/no-nodejs-modules */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createSSRApp, h, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import {
  evaluatePerfHealthGrade,
  exportPerfDiagnosticReport,
  measurePerfAsync,
  measurePerfSync,
  perfMonitorState,
  recordLongTaskSample,
  recordPerfSample,
  resetPerfMonitorStats,
  runPerfPipelineBenchmark,
  sampleDomTopology,
  sampleMemoryUsage,
} from '../models/perfMonitor';

const DIR = join(__dirname, '..');
const MODAL_SETTINGS_SFC = readFileSync(join(DIR, 'modals/ModalSettings.vue'), 'utf8');
const PERF_PANEL_SFC_PATH = join(DIR, 'panels/PanelPerfMonitor.vue');
const PERF_PANEL_SFC = readFileSync(PERF_PANEL_SFC_PATH, 'utf8');
const PERF_PANEL_COMPILED_PATH = join(DIR, 'panels/PanelPerfMonitor.__perf_ssr__.mts');

let panelCompPromise: Promise<Component> | undefined;

function loadPerfPanelComponent(): Promise<Component> {
  panelCompPromise ??= (async () => {
    const { descriptor, errors } = parse(PERF_PANEL_SFC, { filename: PERF_PANEL_SFC_PATH });
    if (errors.length > 0) {
      throw new Error(`PanelPerfMonitor.vue 解析失败：${errors.map(String).join('; ')}`);
    }
    const compiled = compileScript(descriptor, {
      id: 'panelperfmonitorssr',
      inlineTemplate: true,
      templateOptions: { id: 'panelperfmonitorssr', scoped: descriptor.styles.some(s => s.scoped) },
    });
    const js = compiled.content
      .replace(/^import\s+type\s[^;]*;?[\t ]*$/gm, '')
      .replace(/,\s*type\s+[A-Za-z0-9_$]+/g, '');
    writeFileSync(PERF_PANEL_COMPILED_PATH, js, 'utf8');
    const mod = (await import(pathToFileURL(PERF_PANEL_COMPILED_PATH).href)) as { default: Component };
    return mod.default;
  })();
  return panelCompPromise;
}

afterAll(() => {
  try {
    unlinkSync(PERF_PANEL_COMPILED_PATH);
  } catch {
    // ignore
  }
});

beforeEach(() => {
  resetPerfMonitorStats();
  perfMonitorState.currentFps = 60;
  perfMonitorState.avgFrameTimeMs = 16.67;
});

describe('CTRL-PERF-MONITOR-01 · perfMonitor 遥测内核与微基准引擎', () => {
  it('recordPerfSample 准确统计调用次数、最新/均值/最大耗时、缓存命中与脏标记跳过计数', () => {
    recordPerfSample('catalog.merge', 6.4, { cacheHit: false, detail: '首次合并' });
    recordPerfSample('catalog.merge', 0.2, { cacheHit: true, detail: '记忆化命中' });
    recordPerfSample('modal.styleSync', 0, { skipped: true });

    const catStat = perfMonitorState.metrics['catalog.merge'];
    expect(catStat.count).toBe(2);
    expect(catStat.lastMs).toBe(0.2);
    expect(catStat.maxMs).toBe(6.4);
    expect(catStat.avgMs).toBe(3.3);
    expect(catStat.cacheHits).toBe(1);
    expect(catStat.cacheMisses).toBe(1);

    const styleStat = perfMonitorState.metrics['modal.styleSync'];
    expect(styleStat.skippedCount).toBe(1);
    expect(styleStat.count).toBe(0);
  });

  it('measurePerfSync 与 measurePerfAsync 透明返回原函数结果并记录阶段耗时', async () => {
    const syncVal = measurePerfSync('model.tagDomains', () => 42, { detail: 'sync-test' });
    expect(syncVal).toBe(42);
    expect(perfMonitorState.metrics['model.tagDomains'].count).toBe(1);

    const asyncVal = await measurePerfAsync('floor.parseAndRefresh', async () => 'done', {
      detail: 'async-test',
    });
    expect(asyncVal).toBe('done');
    expect(perfMonitorState.metrics['floor.parseAndRefresh'].count).toBe(1);
  });

  it('recordLongTaskSample 过滤 <50ms 短任务，记录 >=50ms 长任务并联动 evaluatePerfHealthGrade 评级', () => {
    expect(evaluatePerfHealthGrade().grade).toBe('S');

    recordLongTaskSample(28, '短任务忽略');
    expect(perfMonitorState.longTaskCount).toBe(0);

    recordLongTaskSample(82.5, '重型 DOM 注入');
    expect(perfMonitorState.longTaskCount).toBe(1);
    expect(perfMonitorState.maxLongTaskMs).toBe(82.5);

    // 模拟多个阶段超出预算触发 B/C 级告警
    recordPerfSample('floor.parseAndRefresh', 120);
    recordPerfSample('card.hydrate', 65);
    recordPerfSample('model.buildingSystem', 45);
    expect(evaluatePerfHealthGrade().grade).toBe('C');
  });

  it('sampleDomTopology 与 sampleMemoryUsage 准确盘点跨帧节点与 JS 堆内存', () => {
    const fakeHostDoc = {
      getElementById: (id: string) => {
        if (id === 'tavernweave-tactical-modal-overlay') {
          return {
            style: { display: 'none' },
            contentDocument: {
              querySelectorAll: () => new Array(18),
            },
          };
        }
        if (id === 'tavernweave-hud-host') {
          return {
            contentDocument: {
              querySelectorAll: () => new Array(32),
            },
          };
        }
        return null;
      },
      querySelectorAll: (sel: string) => {
        if (sel === '.tw-floor-card-mount') return new Array(4);
        if (sel === 'iframe.tw-floor-card') return new Array(4);
        if (sel === '[data-tw-hydrated="true"]') return new Array(4);
        return [];
      },
    } as unknown as Document;

    const topo = sampleDomTopology(fakeHostDoc);
    expect(topo.modalOverlayNodes).toBe(18);
    expect(topo.modalOverlayVisible).toBe(false);
    expect(topo.hudHostNodes).toBe(32);
    expect(topo.hostFloorCardMounts).toBe(4);
    expect(topo.hostHydratedCards).toBe(4);

    const mem = sampleMemoryUsage({
      memory: {
        usedJSHeapSize: 40 * 1024 * 1024,
        totalJSHeapSize: 64 * 1024 * 1024,
        jsHeapSizeLimit: 200 * 1024 * 1024,
      },
    });
    expect(mem.supported).toBe(true);
    expect(mem.usedMB).toBe(40);
    expect(mem.usagePct).toBe(20);
  });

  it('runPerfPipelineBenchmark 执行四步微基准测试并生成结构化 JSON 诊断报告', async () => {
    const report = await runPerfPipelineBenchmark({});
    expect(report.steps).toHaveLength(4);
    expect(report.steps.map(s => s.id)).toEqual([
      'catalog.merge',
      'model.buildingSystem',
      'model.schedulePanel',
      'model.tagDomains',
    ]);
    expect(['S', 'A', 'B', 'C']).toContain(report.grade);

    const jsonStr = exportPerfDiagnosticReport();
    const parsed = JSON.parse(jsonStr);
    expect(parsed.health.grade).toBeDefined();
    expect(Array.isArray(parsed.metrics)).toBe(true);
    expect(parsed.lastBenchmark.steps).toHaveLength(4);
  });
});

describe('CTRL-PERF-MONITOR-01 · PanelPerfMonitor.vue SSR 渲染与 ModalSettings 挂载契约', () => {
  it('ModalSettings.vue 左栏声明 perf（「性能监测」）分组并通过 #panel-perf 挂载 PanelPerfMonitor', () => {
    expect(MODAL_SETTINGS_SFC).toMatch(
      /import\s+PanelPerfMonitor\s+from\s+['"]\.\.\/panels\/PanelPerfMonitor\.vue['"]/,
    );
    expect(MODAL_SETTINGS_SFC).toMatch(/key:\s*'perf',\s*\n?\s*label:\s*'性能监测'/);
    expect(MODAL_SETTINGS_SFC).toMatch(/#panel-perf[\s\S]*?<PanelPerfMonitor\s*\/>/);
  });

  it('PanelPerfMonitor.vue SSR 首帧渲染 KPI 四宫格、管线耗时矩阵、跨帧拓扑与压测报告', async () => {
    await runPerfPipelineBenchmark({});
    const Comp = await loadPerfPanelComponent();
    const html = await renderToString(createSSRApp({ render: () => h(Comp) }));

    expect(html).toContain('data-test="panel-perf-monitor"');
    expect(html).toContain('data-test="perf-health-grade"');
    expect(html).toContain('data-test="perf-kpi-grid"');
    expect(html).toContain('data-test="perf-metrics-table"');
    expect(html).toContain('data-test="perf-dom-topology"');
    expect(html).toContain('data-test="perf-benchmark-report"');
    expect(html).toContain('运行管线基准自检');
  });

  it('只读安全红线：PanelPerfMonitor.vue 与 perfMonitor.ts 零 MVU/世界书写入调用', () => {
    const perfModelSrc = readFileSync(join(DIR, 'models/perfMonitor.ts'), 'utf8');
    for (const src of [PERF_PANEL_SFC, perfModelSrc]) {
      expect(src).not.toMatch(/replaceVariables|insertOrAssignVariables|updateVariablesWith|updateFloorVars/);
      expect(src).not.toMatch(/replaceWorldbook|createWorldbookEntries|updateWorldbookWith/);
    }
  });
});
