<template>
  <!--
    机娘入档 · Dossier Filing（自 PanelSystem 迁入中控台设置弹窗；CTRL-SETTINGS-MIGRATE-05 第五枪）
    pending_lore →《机娘·能力档案》+《剧情·北坡纪事》双书落地 + 自动入档开关 + 回执流水。
    逻辑复用 useGirlFiler.ts 的 filerState / setAutoFile / fileAllPending、store.ts 的
    useDataStore / in_tavern 与 systemCheck.ts 的 checkEnv。只搬 UI 壳、不重写入档逻辑，不改任何底层导出签名。

    ◆ 跨端观察者取舍（关键红线，对齐 D-CTRL-SETTINGS-NEXT-04，与楼层 PanelSystem 的差异）：
      楼层机娘入档区的「自动入档 watch 观察者」由 useGirlFiler.installAutoFiler() 安装，且只在楼层
      App.vue 挂载时装一次（installAutoFiler 内 `if (!in_tavern) return` + `watch pending_lore.length`）。
      本组件严禁 import 或调用 installAutoFiler，也不得自建任何监听 pending_lore 的 watch——否则
      中控台与楼层会同时监听 pending_lore 并各自触发 fileAllPending，造成 pending_lore 双写/重复入档。
      中控台组件只消费共享的模块级 filerState（reactive 单例，楼层已装的观察者会自动驱动它），提供
      「手动入档双书」按钮与「自动入档开关」UI，读同一份 filerState.receipts 回执。
      （与 MIGRATE-04 剔除 ran.value/refreshBooks、MIGRATE-02 不搬体检态联动同性质。）
  -->
  <section class="ra-girlfiling card ob-panel px-3 py-2.5">
    <div class="flex items-center justify-between">
      <span class="micro flex items-center gap-1.5 text-[12px] text-(--rac-hi)">
        <Icon name="gear" :size="12" />
        机娘档案入库
      </span>
      <button
        class="sysbtn"
        style="padding: 3px 10px"
        :style="{
          color: filerState.auto ? 'var(--ok)' : 'var(--t-faint)',
          borderColor: filerState.auto ? 'var(--ok)' : 'var(--line)',
        }"
        @click="setAutoFile(!filerState.auto)"
      >
        自动入档 {{ filerState.auto ? '开' : '关' }}
      </button>
    </div>
    <div v-if="!pending.length" class="mt-2" style="color: var(--rac-muted); font-size: 12px">
      暂无待入档档案 · 新机娘诞生后自动出现
    </div>
    <template v-for="d in pending" :key="d.name">
      <div
        class="mt-1.5 flex items-center justify-between gap-2 border-b pb-1.5 last:border-b-0"
        style="border-color: var(--rac-dim)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <span style="color: var(--rac-hi); font-size: 13px">{{ d.name }}</span>
          <span class="num flex-none" style="color: var(--rac-muted); font-size: 11px">{{ d.model || '型号待定' }}</span>
        </span>
        <button
          class="sysbtn"
          style="padding: 3px 10px"
          :disabled="filerState.busy || !env.inTavern"
          @click="runGirlFromFloating(floating)"
        >
          {{ filerState.busy ? '入档中…' : env.inTavern ? '入档双书' : '预览环境不可写' }}
        </button>
      </div>
    </template>
    <template v-for="r in filerState.receipts" :key="r.time + r.girl">
      <div class="mt-1 flex items-center gap-2" style="font-size: 12px">
        <span :style="{ color: r.ok ? 'var(--ok)' : 'var(--danger)' }">{{ r.ok ? '◆' : '×' }}</span>
        <span style="color: var(--rac-text)">{{ r.girl }}</span>
        <span class="num min-w-0 truncate" style="color: var(--rac-muted)">{{ r.note }}</span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { in_tavern, useDataStore } from '../../红警指挥系统/composables/store';
import { checkEnv } from '../../红警指挥系统/parse/systemCheck';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';
import { setAutoFile } from '../../红警指挥系统/composables/useGirlFiler';
import { isGirlDossierEntry } from '../../红警指挥系统/worldbook/girlFiler';
// 关键红线：只 import 消费型的 filerState / runGirlFromFloating（中控专属，经 updateFloorVars 写回楼层变量）；
// 严禁 import installGirlAutoFiler 或 installAutoFiler，本组件不重装观察者、不自建 pending_lore watch。
import { filerState, runGirlFromFloating } from '../host/girlAutoFiler';

const store = useDataStore();
const floating = useFloatingStore();
const env = checkEnv(in_tavern);
const pending = computed(() => (store.data.pending_lore ?? []).filter(isGirlDossierEntry));

/*
 * 本组件无任何本地状态与 watch：自动入档观察者由中控 index.ts 的 installGirlAutoFiler() 唯一安装，
 * 这里仅通过共享的模块级 filerState（reactive 单例）读态、通过 setAutoFile 改自动开关偏好、
 * 通过 runGirlFromFloating(floating) 触发手动入档并写回楼层变量。跨端不重装观察者，避免 pending_lore 双写/重复入档。
 */
</script>

<style scoped>
.ra-girlfiling .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  background: var(--rac-panel-2);
  color: var(--rac-text);
}
.ra-girlfiling .sysbtn:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}
.ra-girlfiling .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
