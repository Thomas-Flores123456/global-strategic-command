<template>
  <Transition name="ra-modal">
    <div
      v-if="open"
      ref="backdropRef"
      class="ra-modal-mask fixed inset-0 z-10010 flex items-center justify-center p-3"
      @click.self="$emit('close')"
    >
      <section
        ref="panelRef"
        class="ra-modal-card ob-panel flex max-h-[88vh] w-full max-w-[820px] flex-col overflow-hidden rounded-[2px] select-none"
        role="dialog"
        aria-modal="true"
        aria-label="控制台设置"
      >
        <header
          class="ra-modal-header flex flex-none items-center justify-between border-b px-3.5 py-2.5"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="ra-modal-icon"><Icon name="gear" :size="14" /></span>
            <span class="ra-modal-title text-[15px] font-bold tracking-wide">控制台环境选项 · CONFIG</span>
            <span
              data-test="settings-header-faction-badge"
              class="ra-faction-badge rounded-[2px] px-1.5 py-0.5 font-mono text-[11px] font-bold tracking-wider"
            >
              ◆ {{ activeThemeTag }}
            </span>
          </div>
          <button
            class="ra-modal-close rounded-[2px] p-1 transition-colors"
            aria-label="关闭弹窗"
            @click="$emit('close')"
          >
            <Icon name="close" :size="12" />
          </button>
        </header>

        <!--
          VSCode/浏览器设置范式（CTRL-SETTINGS-SHELL-01 & FD-43）：左栏只放 6 大一级分组 + 右侧主内容区。
          「环境」组不声明 pages，右侧直接以紧凑双栏仪表台平铺配色/停靠/策略开关/预设守护/底栏遥测。
        -->
        <SettingsShell :groups="groups" :narrow="narrow">
          <!-- ── 环境组（不拆子页，紧凑一屏仪表台平铺配色/停靠/Auto-Apply/诊断四块） ── -->
          <template #panel-env>
            <div class="space-y-3">
              <!-- 上半区：2 列并排（左列阵营配色 THEME + 右列停靠模式 DOCK MODE） -->
              <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
                <!-- 外观（配色） -->
                <div class="rounded-[2px] border border-rac-dim bg-rac-panel p-2.5">
                  <div class="mb-2 flex items-center justify-between gap-1">
                    <span class="font-mono text-[11px] font-bold tracking-wider text-rac-muted uppercase">
                      阵营终端配色方案 (THEME)
                    </span>
                    <span class="text-[12px] text-rac-muted">切换界面主色调与金属光泽</span>
                  </div>
                  <div class="grid grid-cols-3 gap-1.5">
                    <button
                      v-for="t in themes"
                      :key="t.key"
                      type="button"
                      :data-theme-option="t.key"
                      class="ra-theme-card flex flex-col items-center rounded-[2px] border px-2 py-1.5 text-[12px] transition-all"
                      :class="[
                        t.cardClass,
                        ui.theme === t.key
                          ? 'ra-theme-card--active text-rac-hi'
                          : 'text-rac-muted hover:text-rac-hi',
                      ]"
                      @click="setTheme(t.key)"
                    >
                      <div
                        class="ra-theme-swatch-strip mb-1.5 grid w-full grid-cols-3 overflow-hidden rounded-[1px]"
                        aria-hidden="true"
                      >
                        <span class="ra-swatch-seg ra-swatch-seg--plate h-1.5" />
                        <span class="ra-swatch-seg ra-swatch-seg--mid h-1.5" />
                        <span class="ra-swatch-seg ra-swatch-seg--core h-1.5" />
                      </div>
                      <div class="flex items-center gap-1.5">
                        <span class="ra-theme-dot size-2 rounded-full" />
                        <span class="font-bold">{{ t.label }}</span>
                      </div>
                      <span class="font-mono text-[11px] opacity-80">{{ t.desc }}</span>
                    </button>
                  </div>
                </div>

                <!-- 布局（停靠） -->
                <div class="rounded-[2px] border border-rac-dim bg-rac-panel p-2.5">
                  <div class="mb-2 flex items-center justify-between gap-1">
                    <span class="font-mono text-[11px] font-bold tracking-wider text-rac-muted uppercase">
                      控制台停靠模式 (DOCK MODE)
                    </span>
                    <span class="text-[12px] text-rac-muted">贴边停靠或自由拖拽</span>
                  </div>
                  <div class="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      class="flex flex-col items-center justify-center gap-1 rounded-[2px] border px-2 py-1.5 text-[12px] transition-colors"
                      :class="
                        currentDock === 'right'
                          ? 'border-rac-focus bg-rac-focus-soft text-rac-hi'
                          : 'border-rac-dim bg-rac-bg text-rac-muted hover:border-rac-line hover:text-rac-hi'
                      "
                      title="常驻吸附至屏幕右侧 (红警经典建造栏)"
                      @click="$emit('dock-right')"
                    >
                      <span class="text-rac-focus"><Icon name="location" :size="12" /></span>
                      <span class="font-bold">右侧吸附</span>
                      <span class="font-mono text-[11px] opacity-80">贴右常驻</span>
                    </button>

                    <button
                      type="button"
                      class="flex flex-col items-center justify-center gap-1 rounded-[2px] border px-2 py-1.5 text-[12px] transition-colors"
                      :class="
                        currentDock === 'left'
                          ? 'border-rac-focus bg-rac-focus-soft text-rac-hi'
                          : 'border-rac-dim bg-rac-bg text-rac-muted hover:border-rac-line hover:text-rac-hi'
                      "
                      title="常驻吸附至屏幕左侧 (原生左侧栏)"
                      @click="$emit('dock-left')"
                    >
                      <span class="text-rac-focus"><Icon name="location" :size="12" /></span>
                      <span class="font-bold">左侧吸附</span>
                      <span class="font-mono text-[11px] opacity-80">贴左常驻</span>
                    </button>

                    <button
                      type="button"
                      class="flex flex-col items-center justify-center gap-1 rounded-[2px] border px-2 py-1.5 text-[12px] transition-colors"
                      :class="
                        !currentDock || currentDock === 'free'
                          ? 'border-rac-focus bg-rac-focus-soft text-rac-hi'
                          : 'border-rac-dim bg-rac-bg text-rac-muted hover:border-rac-line hover:text-rac-hi'
                      "
                      title="自由悬浮模式 (可自由拖拽)"
                      @click="$emit('dock-free')"
                    >
                      <span class="text-rac-muted"><Icon name="pin" :size="12" /></span>
                      <span class="font-bold">自由悬浮</span>
                      <span class="font-mono text-[11px] opacity-80">自由拖拽</span>
                    </button>
                  </div>
                </div>
              </div>

              <!-- 中间区：3 列紧凑策略开关条（Auto-Apply + 界面动效 + 楼层协议修补） -->
              <div class="grid grid-cols-1 gap-2 md:grid-cols-3">
                <!-- 数据策略（Auto-Apply） -->
                <label class="flex cursor-pointer items-start justify-between gap-2 rounded-[2px] border border-rac-dim bg-rac-panel p-2.5">
                  <div class="flex min-w-0 flex-col">
                    <span class="font-mono text-[11px] text-rac-muted uppercase">数据更新策略</span>
                    <span class="text-[12px] font-bold text-rac-hi">自动应用数据改动 (Auto-Apply)</span>
                    <span class="mt-0.5 text-[12px] leading-snug text-rac-muted">
                      AI 输出的 &lt;数据更新&gt; 自动写入世界书
                    </span>
                  </div>
                  <input
                    v-model="autoApply"
                    type="checkbox"
                    class="mt-1 size-4 flex-none cursor-pointer accent-rac-focus"
                    @change="onToggleAutoApply"
                  />
                </label>

                <!-- 界面动效（Tactical Motion） -->
                <label class="flex cursor-pointer items-start justify-between gap-2 rounded-[2px] border border-rac-dim bg-rac-panel p-2.5">
                  <div class="flex min-w-0 flex-col">
                    <span class="font-mono text-[11px] text-rac-muted uppercase">界面过渡动效</span>
                    <span class="text-[12px] font-bold text-rac-hi">启用界面动画效果</span>
                    <span class="mt-0.5 text-[12px] leading-snug text-rac-muted">
                      开启弹窗展开、卡片高亮与数字跳动过渡
                    </span>
                  </div>
                  <input
                    v-model="uiMotionEnabled"
                    type="checkbox"
                    data-test="toggle-ui-motion"
                    class="mt-1 size-4 flex-none cursor-pointer accent-rac-focus"
                    @change="onToggleUiMotion"
                  />
                </label>

                <!-- 楼层协议标签兼容修补 -->
                <label class="flex cursor-pointer items-start justify-between gap-2 rounded-[2px] border border-rac-dim bg-rac-panel p-2.5">
                  <div class="flex min-w-0 flex-col">
                    <span class="font-mono text-[11px] text-rac-muted uppercase">战报卡片兼容</span>
                    <span class="text-[12px] font-bold text-rac-hi">自动修复战报标签</span>
                    <span class="mt-0.5 text-[12px] leading-snug text-rac-muted">
                      修复被其他预设包裹或截断的楼层战报卡片
                    </span>
                  </div>
                  <input
                    v-model="floorTagRepairEnabled"
                    type="checkbox"
                    data-test="toggle-floor-tag-repair"
                    class="mt-1 size-4 flex-none cursor-pointer accent-rac-focus"
                    @change="onToggleFloorTagRepair"
                  />
                </label>
              </div>

              <!-- 下半区：预设提示词托管与跨卡全局守护（PRESET GUARD）紧凑 2×2 双列网格 -->
              <div class="rounded-[2px] border border-rac-dim bg-rac-panel p-2.5">
                <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span class="font-mono text-[11px] font-bold tracking-wider text-rac-muted uppercase">
                    预设提示词智能托管与跨卡守护 (PRESET GUARD)
                  </span>
                  <div class="flex items-center gap-1.5">
                    <button
                      type="button"
                      data-test="btn-sync-preset-now"
                      class="rounded-[2px] border border-rac-dim bg-rac-bg px-2.5 py-1 text-[12px] font-semibold text-rac-hi transition-colors hover:border-rac-focus hover:text-rac-focus"
                      @click="onSyncPresetNow"
                    >
                      立即同步
                    </button>
                    <button
                      type="button"
                      data-test="btn-restore-preset-now"
                      class="rounded-[2px] border border-rac-dim bg-rac-bg px-2.5 py-1 text-[12px] font-semibold text-rac-muted transition-colors hover:border-rac-line hover:text-rac-hi"
                      @click="onRestorePresetNow"
                    >
                      恢复预设原貌
                    </button>
                  </div>
                </div>

                <div class="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label class="flex cursor-pointer items-start justify-between gap-2 rounded-[2px] border border-rac-dim/60 bg-rac-bg p-2">
                    <div class="flex min-w-0 flex-col">
                      <span class="text-[12px] font-bold text-rac-hi">切换角色卡时自动还原预设</span>
                      <span class="text-[12px] leading-snug text-rac-muted">
                        游玩本卡时启用红警条目；切到其他角色卡时自动关闭并恢复原预设
                      </span>
                    </div>
                    <input
                      v-model="presetPrefs.enabled"
                      type="checkbox"
                      data-test="toggle-preset-manager-enabled"
                      class="mt-0.5 size-4 flex-none cursor-pointer accent-rac-focus"
                      @change="onPresetPrefsChange"
                    />
                  </label>

                  <label class="flex cursor-pointer items-start justify-between gap-2 rounded-[2px] border border-rac-dim/60 bg-rac-bg p-2">
                    <div class="flex min-w-0 flex-col">
                      <span class="text-[12px] font-bold text-rac-hi">自动关闭预设自带的“摘要/总结”条目</span>
                      <span class="text-[12px] leading-snug text-rac-muted">
                        避免预设自带总结与本卡战史摘要重复生成
                      </span>
                    </div>
                    <input
                      v-model="presetPrefs.autoDisableSummary"
                      type="checkbox"
                      :disabled="!presetPrefs.enabled"
                      data-test="toggle-preset-disable-summary"
                      class="mt-0.5 size-4 flex-none cursor-pointer accent-rac-focus disabled:opacity-40"
                      @change="onPresetPrefsChange"
                    />
                  </label>

                  <label class="flex cursor-pointer items-start justify-between gap-2 rounded-[2px] border border-rac-dim/60 bg-rac-bg p-2">
                    <div class="flex min-w-0 flex-col">
                      <span class="text-[12px] font-bold text-rac-hi">追加战区规则思维链提示（不覆盖原思维链）</span>
                      <span class="text-[12px] leading-snug text-rac-muted">
                        在预设思维链后补充战区产线与叙事防穿帮提醒，自动适配 &lt;正文&gt; / &lt;scenario&gt;
                      </span>
                    </div>
                    <input
                      v-model="presetPrefs.injectCotSupplement"
                      type="checkbox"
                      :disabled="!presetPrefs.enabled"
                      data-test="toggle-preset-inject-cot"
                      class="mt-0.5 size-4 flex-none cursor-pointer accent-rac-focus disabled:opacity-40"
                      @change="onPresetPrefsChange"
                    />
                  </label>

                  <label class="flex cursor-pointer items-start justify-between gap-2 rounded-[2px] border border-rac-dim/60 bg-rac-bg p-2">
                    <div class="flex min-w-0 flex-col">
                      <span class="text-[12px] font-bold text-rac-hi">TauriTavern Agent 模式自动适配</span>
                      <span class="text-[12px] leading-snug text-rac-muted">
                        检测到 TT Agent 开启时自动启用多步协同提示词，关闭时自动停用
                      </span>
                    </div>
                    <input
                      v-model="presetPrefs.autoManageTtAgentPrompt"
                      type="checkbox"
                      :disabled="!presetPrefs.enabled"
                      data-test="toggle-preset-tt-agent"
                      class="mt-0.5 size-4 flex-none cursor-pointer accent-rac-focus disabled:opacity-40"
                      @change="onPresetPrefsChange"
                    />
                  </label>
                </div>

                <div
                  v-if="presetReceipt"
                  class="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-[2px] border border-rac-dim/60 bg-rac-bg px-2.5 py-1.5 font-mono text-[11px] text-rac-muted"
                >
                  <span>当前预设: <strong class="text-rac-hi">{{ presetReceipt.presetName }}</strong></span>
                  <span>正文标签: <strong class="text-rac-focus">{{ presetReceipt.detectedTagSpec.openTag }}</strong></span>
                  <span>
                    战区思维链补充:
                    <strong :class="presetReceipt.cotPromptEnabled ? 'text-(--rac-ok)' : 'text-rac-muted'">
                      {{ presetReceipt.cotPromptEnabled ? `已启用 (#${presetReceipt.cotInsertIndex})` : '已关闭' }}
                    </strong>
                  </span>
                  <span>
                    TT-Agent 适配:
                    <strong :class="presetReceipt.ttAgentPromptEnabled ? 'text-(--rac-ok)' : 'text-rac-muted'">
                      {{ presetReceipt.ttAgentPromptEnabled ? 'Agent已激活·启用' : '待机·已关闭' }}
                    </strong>
                  </span>
                </div>
              </div>

              <!-- 底部单行遥测条：诊断（只读） -->
              <div
                class="flex flex-wrap items-center justify-between gap-2 rounded-[2px] border border-rac-dim bg-rac-panel px-3 py-2 font-mono text-[12px] text-rac-muted"
              >
                <div class="flex flex-wrap items-center gap-3">
                  <span class="ob-tag">
                    <b>有效楼层:</b>
                    <i class="ob-num text-rac-hi">#{{ floorId !== null ? floorId : '无有效楼层' }}</i>
                  </span>
                  <span class="ob-tag">
                    <b>存档格式:</b>
                    <i class="ob-num text-rac-focus">v{{ schemaVersion }}</i>
                  </span>
                  <span class="ob-tag">
                    <b>运行模式:</b>
                    <i class="text-(--rac-ok)">战况调度终端</i>
                  </span>
                </div>
                <div v-if="lastError" class="text-[12px] text-(--rac-alert)">警告: {{ lastError }}</div>
              </div>
            </div>
          </template>

          <!-- ── 世界演变组（FD-35：活跃暗流演进 L1 + 历史平息归档 L2·L3 双子页） ── -->
          <template #panel-world-evo-active>
            <PanelWorldEvolution page="active" />
          </template>
          <template #panel-world-evo-archived>
            <PanelWorldEvolution page="archived" />
          </template>

          <!-- ── 参谋前馈组（FD-31：前馈策略与门禁 + 实时报文预览双子页） ── -->
          <template #panel-feedforward-policy>
            <PanelFeedforwardSettings page="policy" />
          </template>
          <template #panel-feedforward-preview>
            <PanelFeedforwardSettings page="preview" />
          </template>

          <!-- ── 世界书组（不拆子页，右侧直接嵌 PanelWorldbookToggle；CTRL-SETTINGS-MIGRATE-02） ── -->
          <template #panel-books>
            <PanelWorldbookToggle />
          </template>

          <!-- ── 存档组（不拆子页，右侧直接嵌 PanelExportSave；CTRL-SETTINGS-MIGRATE-03） ── -->
          <template #panel-save>
            <PanelExportSave />
          </template>

          <!-- ── 归档组（不拆子页，右侧直接嵌 PanelArchive；CTRL-SETTINGS-MIGRATE-04，与「存档」独立成组） ── -->
          <template #panel-archive>
            <PanelArchive />
          </template>

          <!-- ── 机娘组（不拆子页，右侧直接嵌 PanelGirlFiling；CTRL-SETTINGS-MIGRATE-05，机娘入档双书 + 自动开关） ── -->
          <template #panel-girls>
            <PanelGirlFiling />
          </template>

          <!-- ── 扩展组（F1 · CTRL-CHATBOOK-02：扩展档案入档 + 聊天书条目提升；自动观察者由中控 index.ts 唯一安装） ── -->
          <template #panel-expansion>
            <PanelExpansionFiling />
          </template>

          <!-- ── 剧情摘要组（FIX-SUM-01：楼层区间摘要生成/入档/弃用与隐藏管理迁入中控设置窗） ── -->
          <template #panel-summaries>
            <PanelSummaries />
          </template>

          <!--
            ── 解析组（首次启用 SettingsShell 的 pages 子页机制；CTRL-SETTINGS-MIGRATE-06 第六枪）──
            该组声明 pages=[解析与修复, 别名词典]，右侧内容区顶部出现横向子页 tab 条；
            slot 命名遵循 SettingsShell.activePageSlot 规则 `panel-<组key>-<子页key>` → panel-parse-repair / panel-parse-alias。
          -->
          <template #panel-parse-repair>
            <PanelParseRepair />
          </template>
          <template #panel-parse-alias>
            <PanelAliasDict />
          </template>

          <!--
            ── DLC 组（SettingsShell pages 子页机制；CTRL-SETTINGS-MIGRATE-07 压轴末枪）──
            该组声明 pages=[已装/卸载, 导入]，右侧内容区顶部出现横向两子页 tab；两 slot 各 mount 一次
            PanelDlcManager 并以 page prop 分流（page="installed" / page="import"）。两实例共享同一 pinia
            单例 store（catalog / data），overlays / 事务读写天然一致。放在「解析」之后、「内容体检」之前。
          -->
          <template #panel-dlc-installed>
            <PanelDlcManager page="installed" />
          </template>
          <template #panel-dlc-import>
            <PanelDlcManager page="import" />
          </template>

          <!-- ── 改造 / 热更补丁组（D-BLD-01：世界书数据热更补丁审核门迁入设置窗） ── -->
          <template #panel-patches>
            <PanelDataPatches :embedded="true" :snapshot="floating.snapshot" />
          </template>

          <!-- ── 内容体检组（不拆子页，右侧直接嵌 PanelIntegrityCheck） ── -->
          <template #panel-integrity>
            <PanelIntegrityCheck />
          </template>

          <!-- ── 开发者沙盒调试组（DEV-SANDBOX-01 + DBG41-07：沙盒操控 + 四镜片数据流监控子页） ── -->
          <template #panel-debug>
            <PanelDebugSandbox />
          </template>
          <template #panel-debug-sandbox>
            <PanelDebugSandbox />
          </template>
          <template #panel-debug-waterfall>
            <PanelDataFlowInspector initial-tab="waterfall" />
          </template>
          <template #panel-debug-diff>
            <PanelDataFlowInspector initial-tab="diff" />
          </template>
          <template #panel-debug-flight>
            <PanelDataFlowInspector initial-tab="flight" />
          </template>
          <template #panel-debug-dryrun>
            <PanelDataFlowInspector initial-tab="dryrun" />
          </template>

          <!-- ── 运行时性能监测与遥测探针组（CTRL-PERF-MONITOR-01） ── -->
          <template #panel-perf>
            <PanelPerfMonitor />
          </template>
        </SettingsShell>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { setTheme as applyTheme, ui } from '../../红警指挥系统/ui/ui';
import { getAutoApplyPreference, setAutoApplyPreference } from '../../红警指挥系统/worldbook/worldbookDataFiler';
import { getHostViewportWidth, getHostWindow } from '../host/modalHost.ts';
import PanelAliasDict from '../panels/PanelAliasDict.vue';
import PanelArchive from '../panels/PanelArchive.vue';
import PanelDataPatches from '../panels/PanelDataPatches.vue';
import PanelDlcManager from '../panels/PanelDlcManager.vue';
import PanelExpansionFiling from '../panels/PanelExpansionFiling.vue';
import PanelExportSave from '../panels/PanelExportSave.vue';
import PanelFeedforwardSettings from '../panels/PanelFeedforwardSettings.vue';
import PanelGirlFiling from '../panels/PanelGirlFiling.vue';
import PanelIntegrityCheck from '../panels/PanelIntegrityCheck.vue';
import PanelDataFlowInspector from '../panels/PanelDataFlowInspector.vue';
import PanelDebugSandbox from '../panels/PanelDebugSandbox.vue';
import PanelPerfMonitor from '../panels/PanelPerfMonitor.vue';
import PanelParseRepair from '../panels/PanelParseRepair.vue';
import PanelWorldbookToggle from '../panels/PanelWorldbookToggle.vue';
import PanelWorldEvolution from '../panels/PanelWorldEvolution.vue';
import PanelSummaries from '../../红警指挥系统/ui/panels/PanelSummaries.vue';
import { debugState } from '../../红警指挥系统/composables/useDebugMode';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import SettingsShell, { type SettingsGroup } from '../panels/SettingsShell.vue';
import { NARROW_BREAKPOINT } from '../host/shell.ts';
import {
  getUiMotionEnabled,
  setUiMotionEnabled,
  useTacticalModalMotion,
} from '../../红警指挥系统/ui/motion/useGsapMotion';
import {
  getFloorTagRepairEnabled,
  setFloorTagRepairEnabled,
} from '../cards/floorCardHydrator';
import {
  getSharedPresetPromptManager,
  type PresetManagerPreferences,
  type PresetSyncReceipt,
} from '../host/presetPromptManager';

const props = defineProps<{
  open: boolean;
  floorId: number | null;
  schemaVersion: number;
  lastError: string | null;
  currentDock?: string;
}>();

const backdropRef = ref<HTMLElement | null>(null);
const panelRef = ref<HTMLElement | null>(null);
useTacticalModalMotion(panelRef, backdropRef, { open: () => props.open });

defineEmits<{
  (e: 'close'): void;
  (e: 'dock-left'): void;
  (e: 'dock-right'): void;
  (e: 'dock-free'): void;
}>();

/**
 * 左栏分组配置（VSCode/浏览器设置范式，CTRL-SETTINGS-SHELL-01）。左栏只放一级分组。
 * 「环境」内容本就不多（配色/停靠/Auto-Apply/诊断），不声明 pages —— 右侧不显示子页栏，直接平铺四块；
 * 「内容体检」组同样不拆子页，右侧直接渲染 PanelIntegrityCheck。
 * SettingsShell 的 pages（右侧内容区顶部横向子页 tab）机制自 CTRL-SETTINGS-MIGRATE-06 起首次启用：
 * 「解析」组声明 pages=[解析与修复, 别名词典]，右侧顶部出现横向两子页 tab；其余组仍不拆子页、直接平铺组级内容。
 * 后续逐区迁移只需在此追加一条 group + 一个 #panel-<key> slot（如需再拆子页则补 pages 与 #panel-<key>-<page> slot）。
 */
const floating = useFloatingStore();
const pendingPatchesCount = computed(() => {
  const list = floating.snapshot?.pending_data_patches ?? [];
  return list.filter(p => p.status !== 'deferred').length;
});

// 兼容锚点注释（勿删）：{ key: 'world-evo', label: '世界演变', icon: 'globe', pages: [{ key: 'active', label: '活跃暗流演进 (L1)' }, { key: 'archived', label: '历史平息归档 (L2·L3)' }] }
const groups = computed<Array<SettingsGroup & { badge?: string }>>(() => [
  { key: 'env', label: '环境', icon: 'gear' },
  {
    key: 'feedforward',
    label: '参谋前馈',
    icon: 'compass',
    pages: [
      { key: 'policy', label: '前馈策略与门禁', slot: 'panel-feedforward-policy' },
      { key: 'preview', label: '实时报文预览', slot: 'panel-feedforward-preview' },
      { key: 'summaries', label: '剧情摘要', slot: 'panel-summaries' },
    ],
  },
  {
    key: 'world-evo',
    label: '世界演变',
    icon: 'globe',
    pages: [
      { key: 'active', label: '活跃暗流演进 (L1)', slot: 'panel-world-evo-active' },
      { key: 'archived', label: '历史平息归档 (L2·L3)', slot: 'panel-world-evo-archived' },
    ],
  },
  {
    key: 'filing',
    label: '归档与补丁',
    icon: 'archive',
    badge: pendingPatchesCount.value > 0 ? String(pendingPatchesCount.value) : undefined,
    pages: [
      { key: 'archive', label: '归档', slot: 'panel-archive' },
      { key: 'girls', label: '机娘', slot: 'panel-girls' },
      { key: 'expansion', label: '扩展', slot: 'panel-expansion' },
      {
        key: 'patches',
        label: '改造 / 热更补丁',
        slot: 'panel-patches',
        badge: pendingPatchesCount.value > 0 ? String(pendingPatchesCount.value) : undefined,
      },
    ],
  },
  {
    key: 'parse',
    label: '解析',
    icon: 'wrench',
    pages: [
      { key: 'repair', label: '解析与修复', slot: 'panel-parse-repair' },
      { key: 'alias', label: '别名词典', slot: 'panel-parse-alias' },
    ],
  },
  {
    key: 'dlc',
    label: 'DLC',
    icon: 'book',
    pages: [
      { key: 'books', label: '世界书', slot: 'panel-books' },
      { key: 'save', label: '存档', slot: 'panel-save' },
      { key: 'installed', label: '已装/卸载', slot: 'panel-dlc-installed' },
      { key: 'import', label: '导入', slot: 'panel-dlc-import' },
    ],
  },
  {
    key: 'debug',
    label: '调试沙盒',
    icon: 'bug',
    badge: debugState.enabled ? 'DEV' : undefined,
    pages: [
      { key: 'integrity', label: '内容体检', slot: 'panel-integrity' },
      { key: 'sandbox', label: '沙盒操控', slot: 'panel-debug-sandbox' },
      { key: 'waterfall', label: '七阶数据流', slot: 'panel-debug-waterfall' },
      { key: 'diff', label: '状态Diff与溯源', slot: 'panel-debug-diff' },
      { key: 'flight', label: '异步飞行记录', slot: 'panel-debug-flight' },
      { key: 'dryrun', label: '干跑与排障包', slot: 'panel-debug-dryrun' },
      { key: 'perf', label: '性能监测', slot: 'panel-perf' },
    ],
  },
]);

/**
 * 窄屏形态：<640 时 SettingsShell 折叠左栏为顶部横向条（参考 shell.ts NARROW_BREAKPOINT）。
 *
 * 关键：本组件运行在角色脚本 iframe（停靠宽仅 340px）的 JS 上下文里，但弹窗本体经 modalHost
 * 被 Teleport 挂到宿主全屏 overlay iframe（宿主真实视口，真机可达 2560px）。若直接读脚本 iframe
 * 自身的 `window.innerWidth`（=340），`340 < 640` 恒为 true，会永远误判窄屏、左栏塌成顶部横条。
 * 因此宽度必须取「弹窗实际挂载的宿主视口宽度」（getHostViewportWidth），而非脚本 iframe 自身。
 *
 * 响应式：对宿主 window 挂 resize 监听（onMounted 加、onUnmounted 移除），驱动 hostViewportWidth，
 * narrow 由它 computed，使窗口缩放能实时重算。宿主 window 可能与组件 window 不同源，故监听须挂在
 * 宿主 window 上；拿不到宿主 window 时安全降级为不监听（宽度取一次初值，通常为宽宿主 → 非窄屏）。
 */
const hostViewportWidth = ref(getHostViewportWidth());
const narrow = computed(() => hostViewportWidth.value < NARROW_BREAKPOINT);

function syncHostViewportWidth() {
  hostViewportWidth.value = getHostViewportWidth();
}

let hostWindow: (Window & typeof globalThis) | null = null;
onMounted(() => {
  syncHostViewportWidth();
  hostWindow = getHostWindow();
  hostWindow?.addEventListener('resize', syncHostViewportWidth);
});
onUnmounted(() => {
  hostWindow?.removeEventListener('resize', syncHostViewportWidth);
  hostWindow = null;
});

const themes = [
  { key: 'allied', label: '盟军蓝', desc: 'Allies · 冰蓝', cardClass: 'ra-theme-card--allied' },
  { key: 'soviet', label: '苏联红', desc: 'Soviet · 铁红', cardClass: 'ra-theme-card--soviet' },
  { key: 'yuri', label: '尤里紫', desc: 'Yuri · 暗紫', cardClass: 'ra-theme-card--yuri' },
] as const;

const activeThemeTag = computed(() => {
  if (ui.theme === 'soviet') return 'SOVIET // KREMLIN';
  if (ui.theme === 'yuri') return 'PSICORPS // YURI';
  return 'ALLIED // EVA';
});

const autoApply = ref(getAutoApplyPreference());
const uiMotionEnabled = ref(getUiMotionEnabled());
const floorTagRepairEnabled = ref(getFloorTagRepairEnabled());
const presetManager = getSharedPresetPromptManager();
const presetPrefs = ref<PresetManagerPreferences>({
  ...presetManager.getPreferences(),
});
const presetReceipt = ref<PresetSyncReceipt | null>(
  presetManager.getLastReceipt(),
);

function onToggleAutoApply() {
  setAutoApplyPreference(autoApply.value);
}

function onToggleUiMotion() {
  setUiMotionEnabled(uiMotionEnabled.value);
}

function onToggleFloorTagRepair() {
  setFloorTagRepairEnabled(floorTagRepairEnabled.value);
}

async function onPresetPrefsChange() {
  presetReceipt.value = await presetManager.updatePreferences({
    ...presetPrefs.value,
  });
}

async function onSyncPresetNow() {
  presetReceipt.value = await presetManager.syncNow();
}

async function onRestorePresetNow() {
  await presetManager.restorePresetNow({ removeInjectedEntries: false });
  presetReceipt.value = presetManager.getLastReceipt();
}

function setTheme(theme: 'allied' | 'soviet' | 'yuri') {
  applyTheme(theme);
}
</script>

<style scoped>
.ra-modal-mask {
  z-index: 10010;
  background: color-mix(in srgb, var(--rac-bg) 82%, transparent);
}

.ra-modal-card {
  background: var(--rac-bg);
  border: 1px solid var(--rac-line);
  border-top: 2px solid var(--rac-accent);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.85),
    0 0 0 1px color-mix(in srgb, var(--rac-accent) 20%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--rac-accent) 26%, transparent);
}

.ra-modal-header {
  background-image:
    var(--rac-header-stripe, none),
    var(
      --rac-surface-tint,
      linear-gradient(
        180deg,
        color-mix(in srgb, var(--rac-accent) 12%, var(--rac-panel-2)) 0%,
        var(--rac-panel) 100%
      )
    );
  background-color: var(--rac-panel);
  border-color: color-mix(in srgb, var(--rac-accent) 32%, var(--rac-dim));
}

.ra-modal-icon { color: var(--rac-accent); }
.ra-modal-title { color: var(--rac-hi); }

.ra-faction-badge {
  color: var(--rac-accent);
  background: color-mix(in srgb, var(--rac-accent) 16%, var(--rac-panel-2));
  border: 1px solid color-mix(in srgb, var(--rac-accent) 45%, var(--rac-dim));
}

.ra-theme-card {
  position: relative;
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--card-swatch) 10%, var(--card-plate)) 0%,
    var(--rac-bg) 100%
  );
  border-color: color-mix(in srgb, var(--card-swatch) 35%, var(--rac-dim));
  border-top: 3px solid var(--card-swatch);
}
.ra-theme-card:hover {
  border-color: var(--card-swatch);
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--card-swatch) 18%, var(--card-plate)) 0%,
    var(--rac-panel) 100%
  );
}
.ra-theme-card--active {
  background: linear-gradient(
    180deg,
    color-mix(in srgb, var(--card-swatch) 26%, var(--card-plate)) 0%,
    color-mix(in srgb, var(--card-swatch) 10%, var(--rac-panel-2)) 100%
  );
  border-color: var(--card-swatch);
  border-top: 3px solid var(--card-swatch);
  box-shadow:
    0 0 12px color-mix(in srgb, var(--card-swatch) 28%, transparent),
    inset 0 1px 0 color-mix(in srgb, var(--card-swatch) 35%, transparent);
}
.ra-theme-card--allied {
  --card-swatch: hsl(199 92% 60%);
  --card-mid: hsl(201 70% 36%);
  --card-plate: hsl(204 38% 12%);
}
.ra-theme-card--soviet {
  --card-swatch: hsl(0 84% 60%);
  --card-mid: hsl(356 68% 36%);
  --card-plate: hsl(350 38% 13%);
}
.ra-theme-card--yuri {
  --card-swatch: hsl(270 95% 75%);
  --card-mid: hsl(268 65% 40%);
  --card-plate: hsl(268 42% 14%);
}
.ra-theme-swatch-strip {
  border: 1px solid color-mix(in srgb, var(--card-swatch) 38%, transparent);
}
.ra-swatch-seg--plate { background: var(--card-plate); }
.ra-swatch-seg--mid { background: var(--card-mid); }
.ra-swatch-seg--core { background: var(--card-swatch); }
.ra-theme-dot {
  background: var(--card-swatch);
  box-shadow: 0 0 6px var(--card-swatch);
}

.ra-modal-close {
  color: var(--rac-muted);
}
.ra-modal-close:hover {
  color: var(--rac-hi);
  background: var(--rac-panel-2);
}
.ra-modal-close:focus-visible {
  outline: 1px solid var(--rac-focus);
  outline-offset: 1px;
}

.ra-modal-enter-active,
.ra-modal-leave-active {
  transition:
    opacity 0.2s cubic-bezier(.3,0,.1,1),
    transform 0.2s cubic-bezier(.3,0,.1,1);
}

.ra-modal-enter-from,
.ra-modal-leave-to {
  opacity: 0;
  transform: scale(0.97);
}

.text-rac-muted{color:var(--rac-muted)} .text-rac-hi{color:var(--rac-hi)} .text-rac-text{color:var(--rac-text)} .text-rac-focus{color:var(--rac-focus)} .bg-rac-bg{background:var(--rac-bg)} .bg-rac-panel{background:var(--rac-panel)} .border-rac-dim{border-color:var(--rac-dim)} .hover\:border-rac-line:hover{border-color:var(--rac-line)} .via-rac-panel{--tw-gradient-to:var(--rac-panel)} .to-rac-bg{--tw-gradient-to:var(--rac-bg)} .accent-rac-focus{accent-color:var(--rac-focus)}
.border-rac-focus{border-color:var(--rac-focus)} .bg-rac-focus-soft{background:color-mix(in srgb,var(--rac-focus) 22%,transparent)}
</style>
