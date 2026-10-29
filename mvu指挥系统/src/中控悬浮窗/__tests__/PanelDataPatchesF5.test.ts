/**
 * PanelDataPatchesF5.test.ts —— F5 回归：数据补丁审核弹窗崩溃 + 全屏覆盖层卡死防御
 *
 * 1. buildPatchDiffList 按 EffectiveCatalog 真实形状（buildings/researches）取值，缺省目录不抛；
 * 2. PanelDataPatches 源码不再读取不存在的 catalogEffective / cat.tech；
 * 3. useModalErrorGuard：弹窗子树 render 抛错 → 回退弹窗态并止住上抛；非弹窗子树错误不拦截；
 * 4. FloatingApp 已注册守卫，覆盖全部 Teleport 弹窗组件，并经 isAnyModalOpen → setModalHostVisible 收起覆盖层。
 */
/* eslint-disable import-x/no-nodejs-modules -- 仅测试中读源码文本 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/* eslint-enable import-x/no-nodejs-modules */
/* eslint-disable vue/one-component-per-file -- 测试夹具需在同文件内定义多个最小组件 */
import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { findOwningModal, useModalErrorGuard } from '../host/modalErrorGuard';
import { buildPatchDiffList } from '../models/patchDiff';

const DIR = join(__dirname, '..');
const PANEL_SFC = readFileSync(join(DIR, 'panels/PanelDataPatches.vue'), 'utf8');
const APP_SFC = readFileSync(join(DIR, 'console/FloatingApp.vue'), 'utf8');

describe('F5 · buildPatchDiffList（EffectiveCatalog 真实形状）', () => {
  const catalog = {
    buildings: [{ name: '战车工厂', cost: 2000, power: 25, tags: ['生产'] }],
    researches: [{ name: '磁能科技', cost: 1500 }],
  };

  it('命中建筑：变更字段标 modified，相同字段不列出（未在载荷中的字段沿用既有 calculateDataDiff 语义）', () => {
    const list = buildPatchDiffList(catalog as never, { target: '战车工厂', patch: { cost: 1800, power: 25 } });
    expect(list).toContainEqual({ path: 'cost', type: 'modified', oldValue: 2000, newValue: 1800 });
    expect(list.find(c => c.path === 'power')).toBeUndefined();
  });

  it('命中科技（researches，而非不存在的 tech 字段）', () => {
    const list = buildPatchDiffList(catalog as never, { target: '磁能科技', patch: { cost: 1200 } });
    expect(list.find(c => c.path === 'cost')).toMatchObject({ type: 'modified', oldValue: 1500, newValue: 1200 });
  });

  it('未命中（如机娘白凌补丁）：载荷字段全部展示为 added', () => {
    const list = buildPatchDiffList(catalog as never, { target: '白凌', patch: { 现场修复距离: 15 } });
    expect(list).toEqual([{ path: '现场修复距离', type: 'added', newValue: 15 }]);
  });

  it('目录缺省（undefined / null / 空对象）不抛错', () => {
    for (const cat of [undefined, null, {}]) {
      expect(() => buildPatchDiffList(cat as never, { target: 'X', patch: { a: 1 } })).not.toThrow();
    }
  });

  it('PanelDataPatches 源码不再读取 catalogEffective / cat.tech', () => {
    expect(PANEL_SFC).not.toMatch(/catalogEffective/);
    expect(PANEL_SFC).not.toMatch(/cat\.tech/);
    expect(PANEL_SFC).toMatch(/catalogStore\.effectiveCatalog/);
  });
});

describe('F5 · useModalErrorGuard（渲染失败不留可交互空覆盖层）', () => {
  const Broken = defineComponent({
    name: 'BrokenModal',
    setup() {
      return () => {
        const cat = undefined as unknown as { buildings: unknown[] };
        return h('div', String(cat.buildings.length)); // 复刻 reading 'buildings'
      };
    },
  });
  const Healthy = defineComponent({ name: 'HealthyModal', setup: () => () => h('div', 'ok') });

  function makeHost(child: unknown, modalComponents: unknown[], onModalFailure: (e: unknown, s: string) => void) {
    return defineComponent({
      setup() {
        useModalErrorGuard({ modalComponents, onModalFailure });
        return () => h('div', [h(child as never)]);
      },
    });
  }

  it('弹窗子树抛错：回调回退弹窗态，错误不再上抛（页面不被卡死）', async () => {
    const active = ref<string | null>('patches');
    const onFail = vi.fn(() => {
      active.value = null;
    });
    const appErr = vi.fn();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = createSSRApp(makeHost(Broken, [Broken, Healthy], onFail));
    app.config.errorHandler = appErr;
    await renderToString(app);
    spy.mockRestore();
    expect(onFail).toHaveBeenCalledTimes(1);
    expect(onFail.mock.calls[0]?.[1]).toBe('BrokenModal');
    expect(active.value).toBeNull();
    expect(appErr).not.toHaveBeenCalled();
  });

  it('非弹窗子树抛错：不拦截，照常上抛', async () => {
    const onFail = vi.fn();
    const appErr = vi.fn();
    const app = createSSRApp(makeHost(Broken, [Healthy], onFail));
    app.config.errorHandler = appErr;
    await renderToString(app);
    expect(onFail).not.toHaveBeenCalled();
    expect(appErr).toHaveBeenCalledTimes(1);
  });

  it('findOwningModal：空实例返回 null', () => {
    expect(findOwningModal(null, [Broken])).toBeNull();
  });

  it('FloatingApp 注册守卫并覆盖全部 Teleport 弹窗组件，回退后由 isAnyModalOpen 收起覆盖层', () => {
    expect(APP_SFC).toMatch(/useModalErrorGuard\(\{/);
    const m = APP_SFC.match(/modalComponents:\s*\[([^\]]+)\]/);
    expect(m).not.toBeNull();
    for (const name of [
      'DetailDrawer',
      'ModalTechTree',
      'ModalMechaGirl',
      'ModalArchive',
      'PanelDataPatches',
      'ModalSettings',
    ]) {
      expect(m![1]).toContain(name);
    }
    expect(APP_SFC).toMatch(/onModalFailure:[\s\S]{0,80}activeModal\.value = null/);
    expect(APP_SFC).toMatch(/setModalHostVisible\(open\)/);
  });
});

describe('FIX-P0-01 · PanelDataPatches 接入 updateFloorVars 与 autoRunning 互斥锁', () => {
  const script = PANEL_SFC.slice(PANEL_SFC.indexOf('<script setup'), PANEL_SFC.indexOf('</script>'));
  const fnBody = (name: string) => {
    const start = script.indexOf(`function ${name}(`);
    const next = script.indexOf('\nfunction ', start + 1);
    const nextAsync = script.indexOf('\nasync function ', start + 1);
    const ends = [next, nextAsync].filter(i => i > 0);
    return script.slice(start, ends.length ? Math.min(...ends) : undefined);
  };

  it('引入 updateFloorVars 与 useFloatingStore', () => {
    expect(script).toMatch(/import\s*\{\s*updateFloorVars\s*\}\s*from\s*['"](?:\.\.|\.)(?:\/host)?\/floorVarWrite['"]/);
    expect(script).toMatch(/import\s*\{\s*useFloatingStore\s*\}\s*from\s*['"](?:\.\.\/)?\.\.\/红警指挥系统\/composables\/useFloatingStore['"]/);
    expect(script).toMatch(/const\s+floating\s*=\s*useFloatingStore\(\)/);
  });

  it('applyPatch 手动调用受 autoRunning 互斥锁守卫，并在写入成功后调用 updateFloorVars + floating.refresh()', () => {
    const body = fnBody('applyPatch');
    expect(body).toMatch(/mode === 'manual' && autoRunning/);
    expect(body).toMatch(/await updateFloorVars\(floating\.floorId/);
    expect(body).toMatch(/raw\.filter\(p => p\.id !== patch\.id\)/);
    expect(body).toMatch(/await floating\.refresh\(\)/);
  });

  it('deferPatch 与 rejectPatch 均持久化写回楼层变量并刷新 floating', () => {
    const deferBody = fnBody('deferPatch');
    expect(deferBody).toMatch(/await updateFloorVars\(floating\.floorId/);
    expect(deferBody).toMatch(/status:\s*'deferred'/);
    expect(deferBody).toMatch(/await floating\.refresh\(\)/);

    const rejectBody = fnBody('rejectPatch');
    expect(rejectBody).toMatch(/await updateFloorVars\(floating\.floorId/);
    expect(rejectBody).toMatch(/raw\.filter\(p => p\.id !== patch\.id\)/);
    expect(rejectBody).toMatch(/await floating\.refresh\(\)/);
  });
});

