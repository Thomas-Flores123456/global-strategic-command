<template>
  <!--
    别名词典 · Alias（自 PanelSystem 迁入中控台设置弹窗；CTRL-SETTINGS-MIGRATE-06 第六枪 · 子页②）
    实体对齐记忆：别名列表 + 添加（权威名校验，不在名单时首次 warn / 二次强加）+ 删除 +
    刷新世界书名缓存。逻辑复用 useParse.ts 的 loadAliases / addAlias / removeAlias / buildAuthority /
    refreshAuthorityBooks、systemCheck.ts 的 checkEnv、store.ts 的 in_tavern。
    只搬 UI 壳、不重写别名逻辑，不改任何底层导出签名。

    ◆ 跨端触发器取舍（关键红线，对齐 D-CTRL-SETTINGS-NEXT-05，同「解析与修复」子页）：
      本组件严禁 import 或调用 initParseRunner / parseRunner，也不得自建任何 eventOn / 酒馆事件监听；
      只做手动别名 CRUD，不触碰楼层自动解析触发器。

    ◆ 两子页联动：「解析与修复」子页「记为别名」写库（addAlias）后，用户切到本子页时 onMounted 的
      loadAliases 会重读到最新词典——两子页不强耦合，无需共享本地 map。
  -->
  <section class="ra-alias card px-3 py-2.5">
    <div class="flex items-center justify-between">
      <span class="micro flex items-center gap-1.5">
        <Icon name="hammer" :size="12" />
        名称别名词典（{{ aliasList.length }} 条）
      </span>
      <button
        class="sysbtn"
        :disabled="aliasBusy"
        title="重新读取当前绑定世界书中的标准单位、建筑与科技名称"
        @click="doRefreshBooks"
      >
        刷新标准名称库
      </button>
    </div>

    <div v-if="!aliasList.length" class="mt-1.5" style="color: var(--t-faint); font-size: 12px">
      暂无别名 · ◇ AI 简称或非标准译名可在「解析与修复」中一键添加，也可在下方手动绑定
    </div>
    <div v-for="a in aliasList" :key="a.variant" class="mt-1 flex items-center gap-2" style="font-size: 12px">
      <span style="color: var(--t-low)">{{ a.variant }}</span>
      <span style="color: var(--t-faint)">→</span>
      <span style="color: var(--t-hi)">{{ a.canonical }}</span>
      <span class="flex-1"></span>
      <button
        class="sysbtn flex-none"
        style="padding: 0 6px"
        :disabled="!env.inTavern || aliasBusy"
        @click="doRemoveAlias(a.variant)"
      >
        删除
      </button>
    </div>

    <div class="mt-1.5 flex items-center gap-2">
      <input
        v-model="aliasVar"
        class="systa"
        style="flex: 1; min-width: 0"
        placeholder="AI 常用别名（如 歐盟聯合防務學）"
        @input="aliasForce = false"
      />
      <span class="flex-none" style="color: var(--t-faint); font-size: 12px">→</span>
      <input
        v-model="aliasCanon"
        class="systa"
        style="flex: 1; min-width: 0"
        placeholder="标准名称（图鉴或世界书条目名）"
        @input="aliasForce = false"
      />
      <button
        class="sysbtn sysbtn--go flex-none"
        :disabled="!env.inTavern || aliasBusy || !aliasVar.trim() || !aliasCanon.trim()"
        @click="doAddAlias"
      >
        {{ aliasForce ? '强制添加' : '添加' }}
      </button>
    </div>

    <div v-if="!env.inTavern" class="mt-1.5" style="color: var(--t-faint); font-size: 12px">
      别名增删改 / 刷新世界书名缓存均需酒馆宿主；独立预览仅展示布局
    </div>

    <div v-if="aliasMsg" class="mt-1" style="color: var(--ok); font-size: 12px">{{ aliasMsg }}</div>
    <div v-if="aliasErr" class="mt-1" style="color: var(--warn); font-size: 12px">{{ aliasErr }}</div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import { in_tavern } from '../../红警指挥系统/composables/store';
import { checkEnv } from '../../红警指挥系统/parse/systemCheck';
// 关键红线：只 import 消费型的别名 CRUD / 权威名校验 / 世界书名缓存刷新 API；
// 严禁 import initParseRunner / parseRunner（楼层事件接线薄层），本组件不重装触发器、不自建 eventOn 监听。
import { addAlias, buildAuthority, loadAliases, refreshAuthorityBooks, removeAlias } from '../../红警指挥系统/composables/useParse';

const env = checkEnv(in_tavern);

/* ── 别名词典（实体对齐记忆，只从显式 UI 操作学；无 eventOn / watch，不重装楼层触发器）── */
const aliasMap = ref<Record<string, string>>({});
const aliasVar = ref('');
const aliasCanon = ref('');
const aliasForce = ref(false);
const aliasBusy = ref(false);
const aliasMsg = ref('');
const aliasErr = ref('');
const aliasList = computed(() =>
  Object.entries(aliasMap.value).map(([variant, canonical]) => ({ variant, canonical })),
);

async function refreshAliases() {
  aliasMap.value = await loadAliases();
}

/** 手动添加：权威名不存在时首次点击只 warn，二次点击强加 */
async function doAddAlias() {
  aliasMsg.value = '';
  aliasErr.value = '';
  const v = aliasVar.value.trim();
  const c = aliasCanon.value.trim();
  if (!v || !c) return;
  aliasBusy.value = true;
  try {
    if (!aliasForce.value) {
      const auth = await buildAuthority();
      if (!auth.names.includes(c)) {
        aliasForce.value = true;
        aliasErr.value = `标准图鉴中未找到「${c}」——确认无误可再次点击强制添加`;
        return;
      }
    }
    const ok = await addAlias(v, c);
    if (!ok) {
      aliasErr.value = '仅真机可用';
      return;
    }
    await refreshAliases();
    aliasMsg.value = `◆ 已添加别名「${v}」→「${c}」`;
    aliasVar.value = '';
    aliasCanon.value = '';
    aliasForce.value = false;
  } catch (e) {
    aliasErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    aliasBusy.value = false;
  }
}

async function doRemoveAlias(variant: string) {
  aliasMsg.value = '';
  aliasErr.value = '';
  aliasBusy.value = true;
  try {
    await removeAlias(variant);
    await refreshAliases();
    aliasMsg.value = `◆ 已删除别名「${variant}」`;
  } catch (e) {
    aliasErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    aliasBusy.value = false;
  }
}

async function doRefreshBooks() {
  aliasMsg.value = '';
  aliasErr.value = '';
  aliasBusy.value = true;
  try {
    const names = await refreshAuthorityBooks();
    aliasMsg.value = `◆ 世界书条目名缓存已刷新（${names.length} 条）`;
  } catch (e) {
    aliasErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    aliasBusy.value = false;
  }
}

onMounted(() => {
  // 激活/重建即重读别名词典：这样「解析与修复」子页「记为别名」写库后，切到本子页会重读到最新条目
  void refreshAliases();
});
</script>

<style scoped>
.ra-alias .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--t-low);
}
.ra-alias .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ra-alias .sysbtn--go {
  color: var(--ok);
  border-color: var(--ok);
}
</style>
