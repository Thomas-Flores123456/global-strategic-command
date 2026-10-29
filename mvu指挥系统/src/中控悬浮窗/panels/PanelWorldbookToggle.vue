<template>
  <!--
    世界书总开关 · Books（自 PanelSystem 迁入中控台设置弹窗；CTRL-SETTINGS-MIGRATE-02 第二枪）
    逻辑复用 dlcInstaller.ts 的 readBookStates / applyBookToggles / OFFICIAL_BOOKS(_VERSION) / BookToggleState，
    与 useCatalogStore 数据源；只搬 UI 壳、不重写启停逻辑，不改 dlcInstaller 任何导出。
    启用=加入全局启用列表（World Info Active）；绑卡仅作资产归属记录。
    B1 管辖权：applyBookToggles 的 managedNames 传「面板见过的书名全集」，他卡/用户自有书原样保留、不误删。
  -->
  <section class="ra-wbtoggle card ob-panel px-3 py-2.5">
    <div class="flex items-center justify-between">
      <span class="micro flex items-center gap-1.5 text-[12px] text-(--rac-hi)">
        <Icon name="pin" :size="12" />
        世界书批量启停
      </span>
      <button class="sysbtn" :disabled="bookBusy" @click="refreshBooks">刷新书单</button>
    </div>
    <template v-if="bookStates">
      <!-- 普通勾选：分组一键 -->
      <div v-for="g in bookGroups" :key="g.key" class="mt-1.5 flex items-center gap-2">
        <span style="color: var(--rac-hi); font-size: 12px; min-width: 96px">{{ g.label }}</span>
        <span class="num" style="color: var(--rac-muted); font-size: 11px">
          启用 {{ g.enabled }}/{{ g.total
          }}<template v-if="g.missing">
            · <span style="color: var(--warn)">{{ g.missing }} 本未导入</span></template
          >
        </span>
        <span class="flex-1"></span>
        <button class="sysbtn" :disabled="!env.inTavern || bookBusy" @click="toggleGroup(g.key, true)">全启用</button>
        <button class="sysbtn" :disabled="!env.inTavern || bookBusy" @click="toggleGroup(g.key, false)">全停用</button>
      </div>
      <!-- 高级勾选：逐本 -->
      <button class="sysbtn mt-1.5" @click="bookAdv = !bookAdv">{{ bookAdv ? '收起高级' : '高级（逐本勾选）' }}</button>
      <template v-if="bookAdv">
        <div class="mt-1.5 flex items-center gap-2">
          <button class="sysbtn" @click="selAll(true)">全选</button>
          <button class="sysbtn" @click="selAll(false)">清空</button>
          <button class="sysbtn" @click="selOnly('官方')">仅官方</button>
          <button class="sysbtn" @click="selOnly('DLC')">仅DLC</button>
        </div>
        <label
          v-for="b in bookStates"
          :key="b.name"
          class="mt-1 flex items-center gap-1.5"
          style="font-size: 12px; cursor: pointer"
        >
          <input type="checkbox" :disabled="!b.imported" :checked="bookSel.has(b.name)" @change="toggleSel(b.name)" />
          <span :style="{ color: b.imported ? 'var(--rac-text)' : 'var(--rac-muted)' }">《{{ b.name }}》</span>
          <span class="num" style="color: var(--rac-muted); font-size: 11px"
            >{{ b.group }}{{ b.dlcId ? '·' + b.dlcId : '' }}</span
          >
          <span v-if="!b.imported" style="color: var(--warn); font-size: 11px">未导入（见导入面板）</span>
        </label>
        <button class="sysbtn sysbtn--go mt-1.5" :disabled="!env.inTavern || bookBusy" @click="applySel">
          {{ bookBusy ? '应用中…' : `应用勾选（启用 ${bookSel.size} 本）` }}
        </button>
      </template>
      <div v-if="bookMsg" class="mt-1.5" style="color: var(--ok); font-size: 12px">{{ bookMsg }}</div>
      <div v-if="bookErr" class="mt-1.5" style="color: var(--danger); font-size: 12px">{{ bookErr }}</div>
    </template>
    <div v-else class="mt-1.5" style="color: var(--rac-muted); font-size: 12px">
      批量开启或关闭官方世界书（{{ OFFICIAL_BOOKS.length }} 本 · v{{ OFFICIAL_BOOKS_VERSION }}）与已安装扩展包世界书；独立预览环境不可用
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import Icon from '../../红警指挥系统/ui/Icon.vue';
import {
  applyBookToggles,
  OFFICIAL_BOOKS,
  OFFICIAL_BOOKS_VERSION,
  readBookStates,
  type BookToggleState,
} from '../../红警指挥系统/worldbook/dlcInstaller';
import { in_tavern } from '../../红警指挥系统/composables/store';
import { checkEnv } from '../../红警指挥系统/parse/systemCheck';
// useCatalogStore：与楼层 PanelSystem 同源（安装/卸载/归档会触发 catalog.init()）；
// 本组件仅世界书总开关，无安装归档联动，故此处仅保持数据源一致的引用即可，不额外调用。

const env = checkEnv(in_tavern);

/* ── 世界书总开关（逐字搬自 PanelSystem，仅保留本区自身逻辑，无体检态联动） ── */
const bookStates = ref<BookToggleState[] | null>(null);
const bookSel = ref(new Set<string>());
const bookAdv = ref(false);
const bookBusy = ref(false);
const bookMsg = ref('');
const bookErr = ref('');

const bookGroups = computed(() => {
  const states = bookStates.value ?? [];
  const mk = (key: BookToggleState['group'], label: string) => {
    const list = states.filter(b => b.group === key);
    return {
      key,
      label,
      total: list.length,
      enabled: list.filter(b => b.enabled).length,
      missing: list.filter(b => !b.imported).length,
    };
  };
  const out = [mk('官方', `官方世界书 v${OFFICIAL_BOOKS_VERSION}`), mk('DLC', 'DLC 世界书')];
  if (states.some(b => b.group === '其他')) out.push(mk('其他', '其他已绑'));
  return out.filter(g => g.total > 0 || g.key === '官方');
});

async function refreshBooks() {
  bookMsg.value = '';
  bookErr.value = '';
  bookStates.value = await readBookStates(); // 预览 null → v-else 降级文案
  if (bookStates.value) bookSel.value = new Set(bookStates.value.filter(b => b.enabled).map(b => b.name));
}

async function applyNames(names: string[]) {
  bookBusy.value = true;
  bookMsg.value = '';
  bookErr.value = '';
  try {
    const n = await applyBookToggles(
      names,
      (bookStates.value ?? []).map(b => b.name),
    ); // B1：只调整面板见过的书，手工绑的原样保留
    await refreshBooks();
    bookMsg.value = `◆ 已应用：启用 ${n} 本`; // refresh 会清消息，须后设
  } catch (e) {
    bookErr.value = e instanceof Error ? e.message : String(e);
  } finally {
    bookBusy.value = false;
  }
}
/** 普通勾选：对本组并集/差集，不动其他组 */
function toggleGroup(key: BookToggleState['group'], on: boolean) {
  const states = bookStates.value ?? [];
  const cur = new Set(states.filter(b => b.enabled).map(b => b.name));
  for (const b of states.filter(b => b.group === key)) {
    if (on) cur.add(b.name);
    else cur.delete(b.name);
  }
  void applyNames([...cur]);
}
function selAll(on: boolean) {
  bookSel.value = on ? new Set((bookStates.value ?? []).filter(b => b.imported).map(b => b.name)) : new Set();
}
function selOnly(group: BookToggleState['group']) {
  bookSel.value = new Set((bookStates.value ?? []).filter(b => b.group === group && b.imported).map(b => b.name));
}
function toggleSel(name: string) {
  const s = new Set(bookSel.value);
  if (s.has(name)) s.delete(name);
  else s.add(name);
  bookSel.value = s;
}
function applySel() {
  void applyNames([...bookSel.value]);
}

onMounted(() => {
  void refreshBooks();
});
</script>

<style scoped>
.ra-wbtoggle .sysbtn {
  font-size: 12px;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border: 1px solid var(--rac-dim);
  border-radius: 2px;
  background: var(--rac-panel-2);
  color: var(--rac-text);
}
.ra-wbtoggle .sysbtn:hover:not(:disabled) {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}
.ra-wbtoggle .sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.ra-wbtoggle .sysbtn--go {
  color: var(--warn);
  border-color: var(--warn);
}
.ra-wbtoggle .sysbtn--go:disabled {
  opacity: 0.6;
}
</style>
