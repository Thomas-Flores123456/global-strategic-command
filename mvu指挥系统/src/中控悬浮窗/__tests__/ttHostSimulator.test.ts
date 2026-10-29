import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getTauriTavernBridge,
  waitForTauriTavernReady,
  type AgentProfileDefinition,
  type LayoutSnapshot,
} from '../host/ttHostBridge';
import {
  installTauriTavernSimulator,
  type TauriTavernSimulatorInstance,
} from '../host/ttHostSimulator';

describe('PKG-A · ttHostSimulator (TauriTavern ABI v1 Browser Simulator)', () => {
  let sim: TauriTavernSimulatorInstance | null = null;

  afterEach(() => {
    sim?.uninstall();
    sim = null;
    const g = globalThis as unknown as Record<string, unknown>;
    delete g.__TAURITAVERN__;
    delete g.__TAURITAVERN_MAIN_READY__;
    if (typeof document !== 'undefined' && document.body) {
      document.body.innerHTML = '';
    }
  });

  describe('1. 宿主挂载与防覆盖安全红线', () => {
    it('默认在目标 window 挂载 abiVersion=1 与全套五大 API 命名空间，并能通过 ttHostBridge 识别', async () => {
      sim = installTauriTavernSimulator();
      expect(sim.installed).toBe(true);

      const bridge = getTauriTavernBridge(window);
      expect(bridge.isTauriTavern).toBe(true);
      expect(bridge.abiVersion).toBe(1);
      expect(await waitForTauriTavernReady(window)).toBe(true);

      const diag = bridge.diagnose();
      expect(diag.isTauriTavern).toBe(true);
      expect(diag.abiVersion).toBe(1);
      expect(diag.chatSurfaceManaged).toBe(true);
      expect(diag.hasLayoutApi).toBe(true);
      expect(diag.hasExtensionStoreApi).toBe(true);
      expect(diag.hasWorldInfoApi).toBe(true);
      expect(diag.hasAgentApi).toBe(true);
      expect(diag.hasSkillApi).toBe(true);

      sim.uninstall();
      expect(getTauriTavernBridge(window).isTauriTavern).toBe(false);
    });

    it('当 window.__TAURITAVERN__ 已存在真实宿主对象且未传 force:true 时，拒绝覆盖且 uninstall 不破坏真实宿主', () => {
      const realHostGlobal = {
        abiVersion: 1,
        traceHeader: 'real-production-host',
        api: {},
      };
      (window as unknown as Record<string, unknown>).__TAURITAVERN__ = realHostGlobal;

      const attempt = installTauriTavernSimulator();
      expect(attempt.installed).toBe(false);
      expect(attempt.skippedReason).toBe('real-host-present');
      expect((window as unknown as Record<string, unknown>).__TAURITAVERN__).toBe(
        realHostGlobal,
      );

      attempt.uninstall();
      expect((window as unknown as Record<string, unknown>).__TAURITAVERN__).toBe(
        realHostGlobal,
      );

      // 显式传 force: true 时允许覆盖
      sim = installTauriTavernSimulator({ force: true });
      expect(sim.installed).toBe(true);
      expect((window as unknown as Record<string, unknown>).__TAURITAVERN__).toBe(
        sim.hostGlobal,
      );
    });
  });

  describe('2. ChatSurface 虚拟列表生命周期与 Runtime Claims 压测', () => {
    it('完整驱动 prepareContent -> didMount -> didCommitContent -> unmount(abort+dispose) -> remount 全流程', () => {
      sim = installTauriTavernSimulator();
      const { chatSurface } = sim.simControl;
      const steps: string[] = [];
      let lastSignal: AbortSignal | null = null;
      let runtimeActiveCount = 0;

      const unregister = chatSurface.api.registerParticipant({
        id: 'test/floor-card-participant',
        protocolVersion: 1,
        prepareContent(ctx, claims) {
          steps.push(`prepare:${ctx.mesid}`);
          const host = ctx.content.querySelector('.tw-floor-card-host');
          if (host) {
            host.setAttribute('data-prepared', '1');
            claims.claim(host, activateCtx => {
              runtimeActiveCount += 1;
              steps.push(`claim-activate:${activateCtx.mesid}`);
              return () => {
                runtimeActiveCount -= 1;
                steps.push(`claim-dispose:${activateCtx.mesid}`);
              };
            });
          }
        },
        didMount(ctx) {
          steps.push(`didMount:${ctx.mesid}`);
          return () => {
            steps.push(`disposeMount:${ctx.mesid}`);
          };
        },
        didCommitContent(ctx) {
          steps.push(`didCommit:${ctx.mesid}`);
          lastSignal = ctx.signal;
          const host = ctx.content.querySelector('.tw-floor-card-host');
          if (host) {
            const badge = document.createElement('span');
            badge.className = 'hydrated-badge';
            badge.textContent = `Hydrated#${ctx.mesid}`;
            host.appendChild(badge);
          }
          return {
            dispose() {
              steps.push(`disposeCommit:${ctx.mesid}`);
            },
          };
        },
      });

      const mounted1 = chatSurface.mountFloor(
        12,
        '<div class="tw-floor-card-host" data-card="intel">RawPayload</div>',
      );
      expect(mounted1.element.getAttribute('mesid')).toBe('12');
      expect(mounted1.content.querySelector('.hydrated-badge')?.textContent).toBe(
        'Hydrated#12',
      );
      expect(
        mounted1.content.querySelector('.tw-floor-card-host')?.getAttribute('data-prepared'),
      ).toBe('1');
      expect(lastSignal?.aborted).toBe(false);

      // 测试 runtime claim 授权与回收
      expect(chatSurface.grantRuntime(12)).toBe(1);
      expect(runtimeActiveCount).toBe(1);
      expect(chatSurface.revokeRuntime(12)).toBe(1);
      expect(runtimeActiveCount).toBe(0);

      // 再次授权后直接卸载楼层，应自动先回收 runtime claim、触发 AbortSignal 并调用 disposers
      chatSurface.grantRuntime(12);
      expect(runtimeActiveCount).toBe(1);
      const firstSignal = lastSignal!;
      expect(chatSurface.unmountFloor(12)).toBe(true);
      expect(firstSignal.aborted).toBe(true);
      expect(runtimeActiveCount).toBe(0);
      expect(document.querySelector('.mes[mesid="12"]')).toBeNull();

      // 模拟虚拟列表滚回视口 remountFloor：从原始 HTML 重建全新 DOM 并重新水合
      const mounted2 = chatSurface.remountFloor(12);
      expect(mounted2.element).not.toBe(mounted1.element);
      expect(mounted2.content).not.toBe(mounted1.content);
      expect(mounted2.content.querySelector('.hydrated-badge')?.textContent).toBe(
        'Hydrated#12',
      );

      expect(steps).toEqual([
        'prepare:12',
        'didMount:12',
        'didCommit:12',
        'claim-activate:12',
        'claim-dispose:12',
        'claim-activate:12',
        'claim-dispose:12',
        'disposeCommit:12',
        'disposeMount:12',
        'prepare:12',
        'didMount:12',
        'didCommit:12',
      ]);

      if (typeof unregister === 'function') unregister();
      expect(chatSurface.getParticipantCount()).toBe(0);
    });
  });

  describe('3. Layout 三套预设切换、CSS 变量同步与订阅契约', () => {
    it('支持 desktop / mobile-notch / android-ime 切换、CSS 变量写入及 subscribe 立即回调与幂等退订', () => {
      sim = installTauriTavernSimulator({ initialLayoutPreset: 'desktop' });
      const { layout } = sim.simControl;
      const received: LayoutSnapshot[] = [];

      const unsub = layout.api.subscribe(snap => {
        received.push(snap);
      }) as () => void;

      // 订阅时立即收到一次当前 desktop 快照
      expect(received).toHaveLength(1);
      expect(received[0].viewport.width).toBe(1920);
      expect(received[0].viewport.height).toBe(1080);
      expect(received[0].safeInsets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
      expect(document.documentElement.style.getPropertyValue('--tt-inset-top')).toBe('0px');

      // 切换至 mobile-notch
      const notchSnap = layout.setPreset('mobile-notch');
      expect(notchSnap.viewport.width).toBe(390);
      expect(notchSnap.viewport.height).toBe(844);
      expect(notchSnap.safeInsets).toEqual({ top: 47, right: 0, bottom: 34, left: 0 });
      expect(notchSnap.safeFrame.height).toBe(763);
      expect(document.documentElement.style.getPropertyValue('--tt-inset-top')).toBe('47px');
      expect(document.documentElement.style.getPropertyValue('--tt-inset-bottom')).toBe('34px');

      // 切换至 android-ime
      const dialogEl = document.createElement('div');
      const imeSnap = layout.setPreset('android-ime', dialogEl);
      expect(imeSnap.ime.bottom).toBe(320);
      expect(imeSnap.ime.keyboardOffset).toBe(286);
      expect(imeSnap.ime.viewportBottomInset).toBe(320);
      expect(
        document.documentElement.style.getPropertyValue('--tt-viewport-bottom-inset'),
      ).toBe('320px');
      expect(dialogEl.style.getPropertyValue('--tt-ime-bottom')).toBe('320px');

      // 测试 setCustomSnapshot
      const customSnap = layout.setCustomSnapshot({
        viewport: { width: 800, height: 600 },
        safeInsets: { top: 10, right: 10, bottom: 20, left: 10 },
      });
      expect(customSnap.safeFrame.width).toBe(780);

      expect(received).toHaveLength(4);

      // 幂等退订
      unsub();
      unsub();
      layout.setPreset('desktop');
      expect(received).toHaveLength(4);
    });
  });

  describe('4. ExtensionStore 内存 CRUD、对象深度合并、Blob 与非法命名拦截', () => {
    it('完整支持 JSON CRUD、updateJson 深度合并、renameKey、分表操作与 Blob 存取', async () => {
      sim = installTauriTavernSimulator();
      const store = sim.simControl.extensionStore.api;

      const miss = await store.tryGetJson({
        namespace: 'tavernweave-command',
        table: 'ui-state',
        key: 'dock',
      });
      expect(miss).toEqual({ found: false });

      await store.setJson({
        namespace: 'tavernweave-command',
        table: 'ui-state',
        key: 'dock',
        value: { side: 'right', offset: { x: 10, y: 20 }, pinned: true },
      });

      const hit = await store.tryGetJson<{
        side: string;
        offset: { x: number; y: number };
        pinned: boolean;
      }>({
        namespace: 'tavernweave-command',
        table: 'ui-state',
        key: 'dock',
      });
      expect(hit.found).toBe(true);
      expect(hit.value?.side).toBe('right');

      // updateJson 对象深度合并
      await store.updateJson({
        namespace: 'tavernweave-command',
        table: 'ui-state',
        key: 'dock',
        value: { offset: { y: 99 }, collapsed: false },
      });
      const merged = await store.getJson<Record<string, unknown>>({
        namespace: 'tavernweave-command',
        table: 'ui-state',
        key: 'dock',
      });
      expect(merged).toEqual({
        side: 'right',
        offset: { x: 10, y: 99 },
        pinned: true,
        collapsed: false,
      });

      // updateJson 非对象直接替换
      await store.updateJson({
        namespace: 'tavernweave-command',
        table: 'ui-state',
        key: 'dock',
        value: ['replaced-array'],
      });
      expect(
        await store.getJson({
          namespace: 'tavernweave-command',
          table: 'ui-state',
          key: 'dock',
        }),
      ).toEqual(['replaced-array']);

      // renameKey & listKeys & listTables
      await store.renameKey!({
        namespace: 'tavernweave-command',
        table: 'ui-state',
        key: 'dock',
        newKey: 'dock_v2',
      });
      expect(
        await store.listKeys({
          namespace: 'tavernweave-command',
          table: 'ui-state',
        }),
      ).toEqual(['dock_v2']);
      expect(await store.listTables({ namespace: 'tavernweave-command' })).toEqual([
        'ui-state',
      ]);

      // Blob 存取
      await store.setBlob!({
        namespace: 'tavernweave-command',
        table: 'dlc-cache',
        key: 'pack-01.bin',
        data: 'binary-payload-content',
      });
      expect(
        await store.listBlobKeys!({
          namespace: 'tavernweave-command',
          table: 'dlc-cache',
        }),
      ).toEqual(['pack-01.bin']);
      const blob = await store.getBlob!({
        namespace: 'tavernweave-command',
        table: 'dlc-cache',
        key: 'pack-01.bin',
      });
      expect(blob.size).toBeGreaterThan(0);
      await store.deleteBlob!({
        namespace: 'tavernweave-command',
        table: 'dlc-cache',
        key: 'pack-01.bin',
      });
      expect(
        await store.listBlobKeys!({
          namespace: 'tavernweave-command',
          table: 'dlc-cache',
        }),
      ).toEqual([]);

      // deleteJson & deleteTable
      await store.deleteJson({
        namespace: 'tavernweave-command',
        table: 'ui-state',
        key: 'dock_v2',
      });
      await store.deleteTable({
        namespace: 'tavernweave-command',
        table: 'ui-state',
      });
      expect(await store.listTables({ namespace: 'tavernweave-command' })).toEqual([]);
    });

    it('严格拦截空名称、点开头、包含 .. 或非法字符的 namespace/table/key', async () => {
      sim = installTauriTavernSimulator();
      const store = sim.simControl.extensionStore.api;

      await expect(
        store.setJson({ namespace: '', key: 'valid', value: 1 }),
      ).rejects.toThrow(/Invalid namespace/);
      await expect(
        store.setJson({ namespace: '.hidden', key: 'valid', value: 1 }),
      ).rejects.toThrow(/cannot start with "\."/);
      await expect(
        store.setJson({ namespace: 'valid', key: 'a..b', value: 1 }),
      ).rejects.toThrow(/cannot contain "\.\."/);
      await expect(
        store.setJson({ namespace: 'valid', table: 'bad/table', key: 'k', value: 1 }),
      ).rejects.toThrow(/only \[A-Za-z0-9_.-\] is allowed/);
    });
  });

  describe('5. WorldInfo、Agent 与 Skill 模拟器契约验证', () => {
    it('WorldInfo 支持激活批次广播、读取最后激活与词条打开记录', async () => {
      sim = installTauriTavernSimulator();
      const { worldInfo } = sim.simControl;
      const onBatch = vi.fn();

      const unsub = worldInfo.api.subscribeActivations(onBatch) as () => void;
      expect(await worldInfo.api.getLastActivation()).toBeNull();

      const batch = {
        timestampMs: 1700000000000,
        trigger: 'normal',
        entries: [
          {
            world: '00_核心条令卷',
            uid: 101,
            displayName: '【常驻】总纲',
            constant: true,
          },
        ],
      };
      worldInfo.emitActivation(batch);

      expect(onBatch).toHaveBeenCalledTimes(1);
      expect(await worldInfo.api.getLastActivation()).toEqual(batch);

      const openRes = await worldInfo.api.openEntry({
        world: '00_核心条令卷',
        uid: 101,
      });
      expect(openRes.opened).toBe(true);
      expect(worldInfo.getOpenedEntries()).toEqual([
        { world: '00_核心条令卷', uid: 101 },
      ]);

      unsub();
    });

    it('Agent 支持 Profile 增删改查、后台 Run 启动、事件流订阅与 Workspace 文件读写', async () => {
      sim = installTauriTavernSimulator();
      const { agent } = sim.simControl;

      const profileDef: AgentProfileDefinition = {
        schemaVersion: 1,
        kind: 'tauritavern.agentProfile',
        id: 'ghq-tactical-staff',
        displayName: '战区参谋部',
        preset: { mode: 'currentPromptSnapshot' },
        model: { mode: 'currentPromptSnapshot' },
        run: { presentation: 'background' },
        instructions: { agentSystemPrompt: 'Staff instructions' },
        tools: { allow: ['workspace.*'], deny: [], maxRounds: 4, maxCallsPerRun: 8 },
        skills: {
          visible: ['ghq-r20-audit-rules'],
          deny: [],
          maxReadCharsPerCall: 4000,
          maxReadCharsPerRun: 12000,
        },
        workspace: { visibleRoots: ['/'], writableRoots: ['/'] },
        plan: { mode: 'none' },
        output: { artifacts: [] },
      };

      await agent.api.profiles.save(profileDef);
      const listRes = await agent.api.profiles.list();
      expect(listRes.profiles).toHaveLength(1);
      expect((await agent.api.profiles.load('ghq-tactical-staff')).profile?.displayName).toBe(
        '战区参谋部',
      );

      const handle = await agent.api.startRunFromLegacyGenerate({
        profileId: 'ghq-tactical-staff',
        presentation: 'background',
      });
      expect(handle.status).toBe('running');

      const events: string[] = [];
      const unsub = agent.api.subscribe(handle.runId, ev => {
        events.push(ev.type);
      });

      agent.writeWorkspaceFile(
        handle.runId,
        'advisory/report.json',
        JSON.stringify({ summary: 'OK' }),
      );
      agent.emitRunEvent(handle.runId, {
        type: 'run_completed',
        payload: { artifact: 'advisory/report.json' },
      });

      expect(events).toEqual(['run_created', 'run_completed']);
      expect(agent.getRun(handle.runId)?.status).toBe('completed');

      const wsFile = await agent.api.readWorkspaceFile({
        runId: handle.runId,
        path: 'advisory/report.json',
      });
      expect(JSON.parse(wsFile.text)).toEqual({ summary: 'OK' });
      expect(wsFile.sha256).toHaveLength(64);

      if (typeof unsub === 'function') unsub();
      await agent.api.profiles.delete('ghq-tactical-staff');
      expect((await agent.api.profiles.list()).profiles).toHaveLength(0);
    });

    it('Skill 支持 installImport 冲突策略（skip / replace）、readFile 分片读取、export 与 delete', async () => {
      sim = installTauriTavernSimulator();
      const skillApi = sim.simControl.skill.api;

      const first = await skillApi.installImport({
        input: {
          name: 'ghq-r20-audit-rules',
          source: 'extension:tavernweave-command-system',
          files: [
            {
              path: 'SKILL.md',
              content: '---\ndescription: R20 核算守卫规范\n---\nLine 1\nLine 2\nLine 3',
            },
          ],
        },
        conflictStrategy: 'skip',
      });
      expect(first.action).toBe('installed');
      expect(first.skill?.description).toBe('R20 核算守卫规范');

      // 再次安装 conflictStrategy: 'skip'
      const skipped = await skillApi.installImport({
        input: {
          name: 'ghq-r20-audit-rules',
          files: [{ path: 'SKILL.md', content: 'Updated content' }],
        },
        conflictStrategy: 'skip',
      });
      expect(skipped.action).toBe('skipped');

      // conflictStrategy: 'replace'
      const replaced = await skillApi.installImport({
        input: {
          name: 'ghq-r20-audit-rules',
          files: [{ path: 'SKILL.md', content: 'Alpha\nBeta\nGamma\nDelta' }],
        },
        conflictStrategy: 'replace',
      });
      expect(replaced.action).toBe('replaced');

      const readRes = await skillApi.readFile({
        name: 'ghq-r20-audit-rules',
        path: 'SKILL.md',
        startLine: 2,
        lineCount: 2,
      });
      expect(readRes.content).toBe('Beta\nGamma');
      expect(readRes.totalLines).toBe(4);
      expect(readRes.resourceRef).toBe('ttskill://ghq-r20-audit-rules/SKILL.md');

      const exported = await skillApi.export!({ name: 'ghq-r20-audit-rules' });
      expect(exported.fileName).toBe('ghq-r20-audit-rules.ttskill');
      expect(exported.contentBase64.length).toBeGreaterThan(10);

      await skillApi.delete!({ name: 'ghq-r20-audit-rules' });
      const listAfter = await skillApi.list!();
      const items = Array.isArray(listAfter) ? listAfter : listAfter.skills;
      expect(items).toHaveLength(0);
    });
  });
});
