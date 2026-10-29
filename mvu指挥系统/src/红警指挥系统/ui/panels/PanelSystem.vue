<template>
  <div class="flex flex-col gap-2 p-2">
    <!-- ── 环境状态 ── -->
    <section class="card px-3 py-2.5">
      <div class="micro flex items-center gap-1.5">
        <Icon name="signal" :size="11" />
        环境状态 · Runtime
      </div>
      <div class="mt-2 flex items-center justify-between">
        <span style="color: var(--t-low); font-size: 12px">运行模式</span>
        <span :style="{ color: env.inTavern ? 'var(--ok)' : 'var(--warn)', fontSize: '12px' }">
          {{ env.inTavern ? '酒馆宿主 · 全功能' : '独立预览 · 写操作与世界书体检不可用' }}
        </span>
      </div>
      <div class="mt-2 flex flex-wrap gap-1">
        <span
          v-for="api in env.apis"
          :key="api.name"
          class="num"
          :style="{
            color: api.ok ? 'var(--ok)' : 'var(--t-faint)',
            border: '1px solid var(--line)',
            borderRadius: '3px',
            padding: '1px 5px',
            fontSize: '9px',
          }"
          >{{ api.ok ? '✓' : '✗' }} {{ api.name }}</span
        >
      </div>
    </section>

    <!-- ── 机娘入档：pending_lore →《机娘·能力档案》+《剧情·北坡纪事》双书落地 ── -->
    <section class="card px-3 py-2.5">
      <div class="flex items-center justify-between">
        <span class="micro flex items-center gap-1.5">
          <Icon name="gear" :size="11" />
          机娘入档 · Dossier Filing
        </span>
        <button
          class="sysbtn"
          style="padding: 2px 8px"
          :style="{
            color: filerState.auto ? 'var(--ok)' : 'var(--t-faint)',
            borderColor: filerState.auto ? 'var(--ok)' : 'var(--line)',
          }"
          @click="setAutoFile(!filerState.auto)"
        >
          自动入档 {{ filerState.auto ? '开' : '关' }}
        </button>
      </div>
      <div v-if="!store.data.pending_lore.length" class="mt-2" style="color: var(--t-faint); font-size: 11.5px">
        暂无待入档档案 · 新机娘诞生后自动出现
      </div>
      <template v-for="d in store.data.pending_lore" :key="d.name">
        <div
          class="mt-1.5 flex items-center justify-between gap-2 border-b pb-1.5 last:border-b-0"
          style="border-color: var(--line)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span style="color: var(--t-hi); font-size: 12.5px">{{ d.name }}</span>
            <span class="num flex-none" style="color: var(--t-faint); font-size: 9.5px">{{
              d.model || '型号待定'
            }}</span>
          </span>
          <button
            class="sysbtn"
            style="padding: 2px 8px"
            :disabled="filerState.busy || !env.inTavern"
            @click="fileAllPending()"
          >
            {{ filerState.busy ? '入档中…' : env.inTavern ? '入档双书' : '预览环境不可写' }}
          </button>
        </div>
      </template>
      <template v-for="r in filerState.receipts" :key="r.time + r.girl">
        <div class="mt-1 flex items-center gap-2" style="font-size: 10px">
          <span :style="{ color: r.ok ? 'var(--ok)' : 'var(--danger)' }">{{ r.ok ? '✓' : '✗' }}</span>
          <span style="color: var(--t-low)">{{ r.girl }}</span>
          <span class="num min-w-0 truncate" style="color: var(--t-faint)">{{ r.note }}</span>
        </div>
      </template>
    </section>

    <!-- ── 剧情摘要压缩：pending_summaries → 聊天档案书《摘要·...》落地 + 原始楼层隐藏成对操作 ── -->
    <PanelSummaries />

    <!-- ── DLC 管理（批2 只读，写操作批3 开放） ── -->
    <section class="card px-3 py-2.5">
      <div class="flex items-center justify-between">
        <span class="micro flex items-center gap-1.5">
          <Icon name="gear" :size="11" />
          DLC 管理 · Packages
        </span>
        <span class="num micro">{{ overlays.length }} 已装</span>
      </div>
      <div v-if="!overlays.length" class="mt-2" style="color: var(--t-faint); font-size: 11.5px">
        尚未安装 DLC 内容包 · 原生内容运行中
      </div>
      <template v-for="o in overlays" :key="o.id">
        <div
          class="mt-1.5 flex items-center justify-between gap-2 border-b pb-1.5 last:border-b-0"
          style="border-color: var(--line)"
        >
          <span class="flex min-w-0 items-center gap-2">
            <span style="color: var(--t-hi); font-size: 12.5px">{{ o.faction?.name ?? o.id }}</span>
            <span class="num flex-none" style="color: var(--t-faint); font-size: 9.5px">{{ o.id }}</span>
          </span>
          <span class="flex flex-none items-center gap-2">
            <span class="num" style="color: var(--t-faint); font-size: 10px">
              研究{{ (o.researches ?? []).length }} · 建筑{{ (o.buildings ?? []).length }} · 生产{{
                (o.productions ?? []).length
              }}
            </span>
            <button
              v-if="seedMissingOf(o).length"
              class="sysbtn"
              style="padding: 2px 8px; color: var(--warn); border-color: var(--warn)"
              :disabled="seedBusy"
              :title="`楼层回滚导致 ${seedMissingOf(o).length} 条种子丢失，从注册表重放`"
              @click="doReplaySeeds(o.id)"
            >
              补种子 {{ seedMissingOf(o).length }}
            </button>
            <button class="sysbtn" style="padding: 2px 8px" @click="askUninstall(o.id)">卸载</button>
            <span v-if="seedErr" style="color: var(--danger); font-size: 9.5px">{{ seedErr }}</span>
          </span>
        </div>
        <!-- 卸载确认门 -->
        <div
          v-if="uninstallTarget === o.id"
          class="mt-1.5 rounded-sm border px-2.5 py-2"
          style="border-color: var(--danger)"
        >
          <template v-if="uninstallPlan">
            <div style="color: var(--t-low); font-size: 10.5px; line-height: 1.6">
              将删除世界书：{{ uninstallPlan.books.join('、') || '（无）' }}<br />
              回滚 takeover 备份 {{ uninstallPlan.backupCount }} 条 · 清理 codex 种子
              {{ uninstallPlan.codexSeeds.length }} 条 · 解除角色卡绑定
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button class="sysbtn sysbtn--danger" :disabled="uninstalling" @click="doUninstall(o.id)">
                {{ uninstalling ? '卸载中…' : '确认卸载' }}
              </button>
              <button class="sysbtn" @click="uninstallTarget = null">取消</button>
              <span v-if="uninstallError" style="color: var(--danger); font-size: 10px">{{ uninstallError }}</span>
            </div>
          </template>
          <div v-else style="color: var(--warn); font-size: 10.5px">
            无法读取 $dlc 注册表（独立预览环境仅酒馆内可卸载，或注册表已损坏）
          </div>
        </div>
      </template>

      <div class="mt-2.5 flex gap-2">
        <button class="sysbtn" @click="importOpen = !importOpen">
          {{ importOpen ? '收起导入面板' : '导入 DLC / 世界书' }}
        </button>
      </div>

      <!-- 导入流水线（万能口）：选文件/拖拽可多选 → 嗅探分流（DLC 包→预检确认门；裸世界书→直接导书队列） -->
      <div v-if="importOpen" class="mt-2 border-t pt-2" style="border-color: var(--line)">
        <div class="flex items-center gap-2">
          <button class="sysbtn sysbtn--go" @click="fileInput?.click()">选择文件（可多选）…</button>
          <input
            ref="fileInput"
            type="file"
            accept=".json,application/json"
            multiple
            class="hidden"
            @change="onFileChange"
          />
          <span v-if="pickedFileName" class="num" style="color: var(--t-low); font-size: 10px">{{
            pickedFileName
          }}</span>
          <span v-else style="color: var(--t-faint); font-size: 10px"
            >DLC 包与 ST 原生世界书 .json 混选均可，自动识别分流；或拖拽/粘贴到下方</span
          >
        </div>
        <textarea
          v-model="manifestText"
          class="systa mt-1.5"
          rows="5"
          placeholder='拖拽 .json 文件（可多个：DLC 包 / ST 原生世界书）到这里，或粘贴 DLC manifest JSON：{"dlc":{...},"data":{...},"worldbooks":[...]}'
          @dragover.prevent
          @drop.prevent="onDrop"
        />
        <div class="mt-1.5 flex items-center gap-2">
          <button class="sysbtn sysbtn--go" :disabled="!manifestText.trim()" @click="doPrecheck">解析并预检</button>
          <span v-if="parseError" style="color: var(--danger); font-size: 10.5px">{{ parseError }}</span>
        </div>

        <!-- 裸世界书直接导入队列（第二通道） -->
        <div
          v-if="rawBooks.length || rawReceipt.length"
          class="mt-2 rounded-sm border px-2.5 py-2"
          style="border-color: var(--line)"
        >
          <div class="micro">世界书直接导入 · Raw Worldbooks</div>
          <div v-for="b in rawBooks" :key="b.name" class="mt-1 flex items-start gap-1.5">
            <span class="min-w-0 flex-1" style="font-size: 10.5px; line-height: 1.5">
              <span style="color: var(--t-hi)">《{{ b.name }}》</span>
              <span class="num" style="color: var(--t-faint)"> {{ b.entryCount }} 条</span>
              <span v-if="b.issues.length" style="color: var(--warn)">
                · lint {{ b.issues.length }} 项：{{ b.issues[0].rule }} {{ b.issues[0].message
                }}{{ b.issues.length > 1 ? ' 等' : '' }}</span
              >
              <span v-else style="color: var(--ok)"> · lint 通过</span>
            </span>
            <button
              class="sysbtn flex-none"
              style="padding: 0 6px"
              @click="rawBooks = rawBooks.filter(x => x.name !== b.name)"
            >
              移除
            </button>
          </div>
          <template v-if="rawBooks.length">
            <label
              class="mt-1.5 flex items-center gap-1.5"
              style="color: var(--t-low); font-size: 10.5px; cursor: pointer"
            >
              <input v-model="rawBind" type="checkbox" />
              导入后绑定到当前角色卡（additional 去重追加）
            </label>
            <div class="mt-1" style="color: var(--warn); font-size: 10px">同名世界书将被整本覆盖（重拖即更新）</div>
            <div class="mt-1.5 flex items-center gap-2">
              <button
                class="sysbtn sysbtn--danger"
                :disabled="!env.inTavern || rawBusy"
                :title="env.inTavern ? '执行导入（写操作）' : '仅酒馆内可执行；独立预览只展示清单'"
                @click="doInstallRaw"
              >
                {{ rawBusy ? '导入中…' : `确认导入 ${rawBooks.length} 本` }}
              </button>
              <span v-if="!env.inTavern" style="color: var(--t-faint); font-size: 10px">独立预览：止步于清单</span>
            </div>
          </template>
          <div v-if="rawError" class="mt-1.5" style="color: var(--danger); font-size: 10.5px">
            导入失败：{{ rawError }}
          </div>
          <div v-if="rawReceipt.length" class="mt-1.5" style="color: var(--ok); font-size: 10.5px">
            ✓ 导入完成：{{ rawReceipt.join('、') }}{{ rawBindDone ? ' · 已绑定角色卡' : '' }} — 建议重新体检
          </div>
        </div>

        <template v-if="parsed && precheckRan">
          <div class="mt-2 flex items-center gap-3">
            <span style="color: var(--t-hi); font-size: 11.5px">{{ parsed.dlc.name }}</span>
            <span class="num" style="color: var(--t-faint); font-size: 9.5px"
              >{{ parsed.dlc.id }} · v{{ parsed.dlc.version }} · {{ parsed.dlc.kind }}</span
            >
          </div>
          <div class="mt-1 flex items-center gap-3">
            <span class="num" :style="{ color: preCounts.error ? 'var(--danger)' : 'var(--t-faint)', fontSize: '11px' }"
              >错误 {{ preCounts.error }}</span
            >
            <span class="num" :style="{ color: preCounts.warn ? 'var(--warn)' : 'var(--t-faint)', fontSize: '11px' }"
              >警告 {{ preCounts.warn }}</span
            >
            <span class="num" style="color: var(--t-faint); font-size: 11px">提示 {{ preCounts.info }}</span>
            <span v-if="!preCounts.error" class="num" style="color: var(--ok); font-size: 11px">✓ 预检可行</span>
          </div>
          <div v-for="(issue, i) in precheckIssues" :key="i" class="mt-1 flex items-start gap-1.5">
            <span
              class="num flex-none"
              :style="{
                color: lvColor(issue.level),
                border: `1px solid ${lvColor(issue.level)}`,
                borderRadius: '3px',
                padding: '0 3px',
                fontSize: '8.5px',
                marginTop: '1px',
              }"
              >{{ issue.rule }}</span
            >
            <span class="min-w-0" style="font-size: 10.5px; line-height: 1.5">
              <span style="color: var(--t-low)">{{ issue.target }}</span>
              <span style="color: var(--t-faint)"> — {{ issue.message }}</span>
            </span>
          </div>

          <!-- 确认门：动作预览 -->
          <div v-if="!preCounts.error" class="mt-2 rounded-sm border px-2.5 py-2" style="border-color: var(--warn)">
            <div class="micro">安装动作预览 · Confirm</div>
            <div class="mt-1" style="color: var(--t-low); font-size: 10.5px; line-height: 1.7">
              创建世界书 {{ (parsed.worldbooks ?? []).length }} 本：{{
                (parsed.worldbooks ?? []).map(w => w.name).join('、') || '（无）'
              }}<br />
              绑定角色卡 additional · takeover 改写 {{ takeoverEntryCount }} 条（含备份） · codex 种子
              {{ (parsed.data?.codex ?? []).length }} 条 · 写入 $dlc 注册表<br />
              <template v-if="dataCardPreview"
                >生成数据卡 1 条→《{{ dataCardPreview.book }}》（触发词 {{ dataCardPreview.keys }} 个，AI
                可读精确数值）</template
              >
              <template v-else>数据卡：已关闭或无 data 内容</template>
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button
                class="sysbtn sysbtn--danger"
                :disabled="!env.inTavern || installing"
                :title="env.inTavern ? '执行安装（写操作）' : '仅酒馆内可执行；独立预览只能预检'"
                @click="doInstall"
              >
                {{ installing ? '安装中…' : '确认执行安装' }}
              </button>
              <span v-if="!env.inTavern" style="color: var(--t-faint); font-size: 10px">独立预览：止步于预检</span>
            </div>
          </div>
          <div v-if="installError" class="mt-1.5" style="color: var(--danger); font-size: 10.5px">
            安装失败：{{ installError }}
          </div>
          <div v-if="receipt" class="mt-1.5" style="color: var(--ok); font-size: 10.5px">
            ✓ 安装完成：{{ receipt.books.join('、') || '（无书）' }} · takeover {{ receipt.takeoverCount }} 条 · 种子
            {{ receipt.codexSeeds.length }} 条 — 建议重新体检
          </div>
        </template>
      </div>
    </section>

    <!-- ── 世界书总开关：启用=加入全局启用列表（World Info Active）；绑卡仅作资产归属记录 ── -->
    <section class="card px-3 py-2.5">
      <div class="flex items-center justify-between">
        <span class="micro flex items-center gap-1.5">
          <Icon name="pin" :size="11" />
          世界书 · Books
        </span>
        <button class="sysbtn" :disabled="bookBusy" @click="refreshBooks">刷新书单</button>
      </div>
      <template v-if="bookStates">
        <!-- 普通勾选：分组一键 -->
        <div v-for="g in bookGroups" :key="g.key" class="mt-1.5 flex items-center gap-2">
          <span style="color: var(--t-hi); font-size: 11px; min-width: 92px">{{ g.label }}</span>
          <span class="num" style="color: var(--t-faint); font-size: 9.5px">
            启用 {{ g.enabled }}/{{ g.total
            }}<template v-if="g.missing">
              · <span style="color: var(--warn)">{{ g.missing }} 本未导入</span></template
            >
          </span>
          <span class="flex-1"></span>
          <button class="sysbtn" :disabled="!env.inTavern || bookBusy" @click="toggleGroup(g.key, true)">全启用</button>
          <button class="sysbtn" :disabled="!env.inTavern || bookBusy" @click="toggleGroup(g.key, false)">
            全停用
          </button>
        </div>
        <!-- 高级勾选：逐本 -->
        <button class="sysbtn mt-1.5" @click="bookAdv = !bookAdv">
          {{ bookAdv ? '收起高级' : '高级（逐本勾选）' }}
        </button>
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
            style="font-size: 10.5px; cursor: pointer"
          >
            <input type="checkbox" :disabled="!b.imported" :checked="bookSel.has(b.name)" @change="toggleSel(b.name)" />
            <span :style="{ color: b.imported ? 'var(--t-low)' : 'var(--t-faint)' }">《{{ b.name }}》</span>
            <span class="num" style="color: var(--t-faint); font-size: 9px"
              >{{ b.group }}{{ b.dlcId ? '·' + b.dlcId : '' }}</span
            >
            <span v-if="!b.imported" style="color: var(--warn); font-size: 9px">未导入（见导入面板）</span>
          </label>
          <button class="sysbtn sysbtn--go mt-1.5" :disabled="!env.inTavern || bookBusy" @click="applySel">
            {{ bookBusy ? '应用中…' : `应用勾选（启用 ${bookSel.size} 本）` }}
          </button>
        </template>
        <div v-if="bookMsg" class="mt-1.5" style="color: var(--ok); font-size: 10.5px">{{ bookMsg }}</div>
        <div v-if="bookErr" class="mt-1.5" style="color: var(--danger); font-size: 10.5px">{{ bookErr }}</div>
      </template>
      <div v-else class="mt-1.5" style="color: var(--t-faint); font-size: 10.5px">
        官方 {{ OFFICIAL_BOOKS.length }} 本（v{{ OFFICIAL_BOOKS_VERSION }}）+ DLC
        书批量启停；启用=加入全局启用列表（World Info Active）。独立预览环境不可用
      </div>
    </section>

    <!-- ── 动态归档：codex（草稿态）→《EVA·动态档案》（正史）── -->
    <section class="card px-3 py-2.5">
      <div class="flex items-center justify-between">
        <span class="micro flex items-center gap-1.5">
          <Icon name="archive" :size="11" />
          动态归档 · Archive
        </span>
        <button class="sysbtn" :disabled="archBusy" @click="refreshArchive">刷新</button>
      </div>
      <template v-if="archReady">
        <div v-if="archCandidates.length" class="mt-1.5">
          <div style="color: var(--t-low); font-size: 10.5px">
            待归档（codex 未入正史）{{ archCandidates.length }} 条——楼层定格后再归档：
          </div>
          <label
            v-for="c in archCandidates"
            :key="c.name"
            class="mt-1 flex items-center gap-1.5"
            style="font-size: 10.5px; cursor: pointer"
          >
            <input type="checkbox" :checked="archSel.has(c.name)" @change="toggleArchSel(c.name)" />
            <span style="color: var(--t-hi)">{{ c.kind }}·{{ c.name }}</span>
            <span style="color: var(--t-faint)">{{ (c.desc ?? '').slice(0, 26) }}</span>
          </label>
          <button
            class="sysbtn sysbtn--danger mt-1.5"
            :disabled="!env.inTavern || !archSel.size || archBusy"
            @click="doArchive"
          >
            {{ archBusy ? '归档中…' : `归档 ${archSel.size} 条 →《EVA·动态档案》` }}
          </button>
        </div>
        <div v-else class="mt-1.5" style="color: var(--t-faint); font-size: 10.5px">
          无待归档动态内容（AI 创造新事物后此处出现候选）
        </div>
        <div v-if="archOrphans.length" class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
          <div style="color: var(--warn); font-size: 10.5px">
            回溯孤儿 {{ archOrphans.length }} 条（正史有、变量无——楼层回滚所致）：
          </div>
          <div v-for="o in archOrphans" :key="o" class="mt-1 flex items-center gap-2" style="font-size: 10.5px">
            <span style="color: var(--t-hi)">{{ o }}</span>
            <span class="flex-1"></span>
            <button class="sysbtn" :disabled="archBusy" @click="doOrphan(o, 'restore')">补录变量</button>
            <button class="sysbtn sysbtn--danger" :disabled="archBusy" @click="doOrphan(o, 'delete')">删除条目</button>
          </div>
        </div>
        <div v-if="archMsg" class="mt-1.5" style="color: var(--ok); font-size: 10.5px">{{ archMsg }}</div>
        <div v-if="archErr" class="mt-1.5" style="color: var(--danger); font-size: 10.5px">{{ archErr }}</div>
      </template>
      <div v-else class="mt-1.5" style="color: var(--t-faint); font-size: 10.5px">
        变量→世界书晋升管道（MVU 定格后驾驶员确认归档；不自动双向同步）；独立预览环境不可用
      </div>

      <!-- G1 · 导出存档：当前楼 stat_data → 剪贴板 JSON（开场启动器「导入存档」可粘贴回填） -->
      <div class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
        <div class="flex items-center gap-2">
          <button
            class="sysbtn"
            :disabled="!env.inTavern || expBusy"
            :title="env.inTavern ? '读当前楼 stat_data，复制存档 JSON 到剪贴板' : '仅酒馆内可导出；独立预览不可用'"
            @click="doExportSave"
          >
            {{ expBusy ? '导出中…' : '导出存档到剪贴板' }}
          </button>
          <span style="color: var(--t-faint); font-size: 10px">新聊天楼 0 开场启动器→导入存档→粘贴即可继承进度</span>
        </div>
        <div v-if="expMsg" class="mt-1.5" style="color: var(--ok); font-size: 10.5px">{{ expMsg }}</div>
        <div v-if="expErr" class="mt-1.5" style="color: var(--danger); font-size: 10.5px">{{ expErr }}</div>
        <textarea v-if="expJson" class="systa mt-1.5" rows="4" readonly :value="expJson" @focus="selectAllText" />
      </div>
    </section>

    <!-- ── 解析与修复：楼层传承解析报告流水 + 隔离区两条出路（改原文重试 / 编辑后提交）── -->
    <section class="card px-3 py-2.5">
      <div class="flex items-center justify-between">
        <span class="micro flex items-center gap-1.5">
          <Icon name="hammer" :size="11" />
          解析与修复 · Parse
        </span>
        <button
          class="sysbtn sysbtn--go"
          :disabled="!env.inTavern || parse.busy"
          :title="env.inTavern ? '强制重解析当前楼层（跳过幂等）' : '仅酒馆内可执行；独立预览不可用'"
          @click="doReparse"
        >
          {{ parse.busy ? '解析中…' : '重解析本楼' }}
        </button>
      </div>

      <div v-if="!env.inTavern" class="mt-1.5" style="color: var(--t-faint); font-size: 10.5px">
        事件解析 / 隔离区 / 撤销均需酒馆宿主；独立预览仅展示布局
      </div>

      <!-- R20 隔离对账 -->
      <div v-for="(issue, i) in parseR20" :key="'r20' + i" class="mt-1.5 flex items-start gap-1.5">
        <span
          class="num flex-none"
          :style="{
            color: lvColor(issue.level),
            border: `1px solid ${lvColor(issue.level)}`,
            borderRadius: '3px',
            padding: '0 3px',
            fontSize: '8.5px',
            marginTop: '1px',
          }"
          >{{ issue.rule }}</span
        >
        <span class="min-w-0 flex-1" style="font-size: 10.5px; line-height: 1.5">
          <span style="color: var(--t-low)">{{ issue.target }}</span>
          <span style="color: var(--t-faint)"> — {{ issue.message }}</span>
        </span>
        <button
          v-if="issue.level === 'info' && issue.target.startsWith('#')"
          class="sysbtn flex-none"
          style="padding: 0 6px"
          :disabled="!env.inTavern || parse.busy"
          @click="doClearQuarantine(Number(issue.target.slice(1)))"
        >
          清理
        </button>
      </div>

      <!-- 报告流水（内存态，本会话有效） -->
      <div v-if="parse.reports.length" class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
        <div style="color: var(--t-hi); font-size: 11.5px; letter-spacing: 0.04em">报告流水（本会话）</div>
        <template v-for="(r, i) in parse.reports.slice(0, 10)" :key="r.message_id + '@' + r.time + i">
          <div
            class="mt-1 flex items-center gap-2"
            style="font-size: 10.5px; cursor: pointer"
            @click="repOpen = repOpen === i ? null : i"
          >
            <span class="num flex-none" style="color: var(--t-hi)">#{{ r.message_id }}</span>
            <span class="num flex-none" :style="{ color: greens(r) ? 'var(--ok)' : 'var(--t-faint)' }"
              >🟢{{ greens(r) }}</span
            >
            <span class="num flex-none" :style="{ color: yellows(r) ? 'var(--warn)' : 'var(--t-faint)' }"
              >🟡{{ yellows(r) }}</span
            >
            <span class="num flex-none" :style="{ color: r.quarantineCount ? 'var(--danger)' : 'var(--t-faint)' }"
              >🔴{{ r.quarantineCount }}</span
            >
            <span class="num flex-none" style="color: var(--t-faint); font-size: 9.5px">{{ r.time }}</span>
            <span v-if="r.note" class="flex-none" style="color: var(--t-faint); font-size: 9.5px">{{ r.note }}</span>
            <span v-if="r.downstreamWarning" class="flex-none" style="color: var(--warn); font-size: 9.5px"
              >下游楼层可能失真</span
            >
            <span class="flex-1"></span>
            <span v-if="r.undone" class="flex-none" style="color: var(--t-faint); font-size: 9.5px">已撤销</span>
            <button
              v-else-if="r.undoable"
              class="sysbtn sysbtn--danger flex-none"
              style="padding: 0 6px"
              :disabled="!env.inTavern || parse.busy"
              @click.stop="undoTarget = undoTarget === i ? null : i"
            >
              撤销
            </button>
          </div>
          <!-- 撤销二段确认门 -->
          <div
            v-if="undoTarget === i && !r.undone"
            class="mt-1 rounded-sm border px-2.5 py-2"
            style="border-color: var(--danger)"
          >
            <div style="color: var(--t-low); font-size: 10.5px; line-height: 1.6">
              将把 #{{ r.message_id }} 楼 stat_data 回滚到本次🟡入库前，并清除幂等登记（允许重新解析）。
            </div>
            <div class="mt-1.5 flex items-center gap-2">
              <button class="sysbtn sysbtn--danger" :disabled="!env.inTavern || parse.busy" @click="doUndo(r)">
                确认撤销
              </button>
              <button class="sysbtn" @click="undoTarget = null">取消</button>
            </div>
          </div>
          <!-- 展开明细：events 修复留痕 -->
          <div v-if="repOpen === i" class="mt-1 border-l pl-2" style="border-color: var(--line)">
            <div v-if="!r.events.length" style="color: var(--t-faint); font-size: 10px">
              无修复动作（原样解析或无 tag）
            </div>
            <div v-for="(ev, j) in r.events" :key="j" style="font-size: 10px; line-height: 1.6">
              <span class="num" style="color: var(--t-faint)">{{ ev.light }} {{ ev.layer }}</span>
              <span style="color: var(--t-low)"> {{ ev.message }}</span>
              <span v-if="ev.before !== undefined || ev.after !== undefined" class="num" style="color: var(--t-faint)">
                （{{ fmtVal(ev.before) }} → {{ fmtVal(ev.after) }}）
              </span>
              <button
                v-if="ev.align"
                class="sysbtn"
                style="padding: 0 6px; margin-left: 6px"
                :disabled="!env.inTavern || aliasBusy"
                title="将此低置信对齐写入别名词典，下次解析🟢直达"
                @click="doLearnAlias(ev.align)"
              >
                记为别名
              </button>
            </div>
          </div>
        </template>
      </div>
      <div v-else-if="env.inTavern" class="mt-2" style="color: var(--t-faint); font-size: 10.5px">
        本会话尚无解析记录（新楼生成 / swipe 换页 / 编辑楼层将自动解析）
      </div>

      <!-- 隔离区：🔴未入库项，两条出路 -->
      <div v-if="quarantineFloors.length" class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
        <div style="color: var(--danger); font-size: 11.5px; letter-spacing: 0.04em">
          隔离区 · {{ quarantineTotal }} 项未决
        </div>
        <template v-for="f in quarantineFloors" :key="f.mid">
          <div
            v-for="(q, qi) in f.items"
            :key="f.mid + ':' + qi"
            class="mt-1.5 rounded-sm border px-2.5 py-2"
            style="border-color: var(--line)"
          >
            <div class="flex items-center gap-2" style="font-size: 10.5px">
              <span class="num flex-none" style="color: var(--t-hi)">#{{ f.mid }}</span>
              <span
                v-if="q.tag"
                class="num flex-none"
                style="
                  color: var(--warn);
                  border: 1px solid var(--warn);
                  border-radius: 3px;
                  padding: 0 3px;
                  font-size: 8.5px;
                "
                >{{ q.tag }}</span
              >
              <span class="num min-w-0" style="color: var(--t-faint); font-size: 9.5px">{{ q.path ?? q.scope }}</span>
            </div>
            <div class="mt-1" style="color: var(--danger); font-size: 10.5px">{{ q.error }}</div>
            <div v-if="q.suggestion" style="color: var(--t-low); font-size: 10px">建议：{{ q.suggestion }}</div>
            <pre
              class="systa mt-1"
              style="max-height: 96px; overflow: auto; white-space: pre-wrap; user-select: text"
              >{{ q.raw }}</pre>
            <div class="mt-1.5 flex items-center gap-2">
              <button
                class="sysbtn"
                :disabled="!env.inTavern || parse.busy"
                title="先到楼层里改好消息原文，再点此重跑解析（幂等已跳过）"
                @click="doRetry(f.mid)"
              >
                重试解析
              </button>
              <button class="sysbtn" :disabled="!env.inTavern" @click="openFix(f.mid, qi, q)">
                {{ fixKey === f.mid + ':' + qi ? '收起编辑' : '编辑后提交' }}
              </button>
            </div>
            <!-- 编辑后提交：写操作，红框二段确认 -->
            <div
              v-if="fixKey === f.mid + ':' + qi"
              class="mt-1.5 rounded-sm border px-2.5 py-2"
              style="border-color: var(--danger)"
            >
              <textarea v-model="fixText" class="systa" rows="5" />
              <div class="mt-1" style="color: var(--t-low); font-size: 10px">
                提交将走同一解析管道校验入库（不绕过校验）；未含 tag 时自动按‹{{ wrapTag(q) }}›包裹；楼层原文不会被改写
              </div>
              <div class="mt-1.5 flex items-center gap-2">
                <button
                  class="sysbtn sysbtn--danger"
                  :disabled="!env.inTavern || parse.busy || !fixText.trim()"
                  @click="doSubmitFix(f.mid, q)"
                >
                  {{ parse.busy ? '提交中…' : '确认提交入库' }}
                </button>
                <button class="sysbtn" @click="fixKey = null">取消</button>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- 别名词典：实体对齐记忆（低危可逆：删除单击；添加校验权威名，不存在可二次点击强加） -->
      <div class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
        <div class="flex items-center gap-2">
          <button class="sysbtn" @click="toggleAliasOpen">
            {{ aliasOpen ? '收起别名词典' : `别名词典（${aliasList.length} 条）` }}
          </button>
          <button
            v-if="aliasOpen"
            class="sysbtn"
            :disabled="aliasBusy"
            title="重拉角色卡绑定世界书的条目名缓存（权威名单 async 源）"
            @click="doRefreshBooks"
          >
            刷新世界书名缓存
          </button>
        </div>
        <template v-if="aliasOpen">
          <div v-if="!aliasList.length" class="mt-1.5" style="color: var(--t-faint); font-size: 10.5px">
            暂无别名 · 🟡低置信对齐可在报告明细「记为别名」，或在下方手动添加
          </div>
          <div v-for="a in aliasList" :key="a.variant" class="mt-1 flex items-center gap-2" style="font-size: 10.5px">
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
              placeholder="变体名（如 歐盟聯合防務學）"
              @input="aliasForce = false"
            />
            <span class="flex-none" style="color: var(--t-faint); font-size: 10.5px">→</span>
            <input
              v-model="aliasCanon"
              class="systa"
              style="flex: 1; min-width: 0"
              placeholder="权威名（目录/图鉴/世界书条目名）"
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
          <div v-if="aliasMsg" class="mt-1" style="color: var(--ok); font-size: 10.5px">{{ aliasMsg }}</div>
          <div v-if="aliasErr" class="mt-1" style="color: var(--warn); font-size: 10.5px">{{ aliasErr }}</div>
        </template>
      </div>

      <div v-if="parseMsg" class="mt-1.5" style="color: var(--ok); font-size: 10.5px">{{ parseMsg }}</div>
      <div v-if="parseErr" class="mt-1.5" style="color: var(--danger); font-size: 10.5px">{{ parseErr }}</div>
    </section>

    <!-- ── 内容体检 ── -->
    <section class="card px-3 py-2.5">
      <div class="flex items-center justify-between">
        <span class="micro flex items-center gap-1.5">
          <Icon name="flask" :size="11" />
          内容体检 · Integrity
        </span>
        <button class="sysbtn sysbtn--go" :disabled="running" @click="runCheck">
          {{ running ? '体检中…' : ran ? '重新体检' : '开始体检' }}
        </button>
      </div>

      <template v-if="ran">
        <!-- 汇总 -->
        <div class="mt-2 flex items-center gap-3">
          <span class="num" :style="{ color: counts.error ? 'var(--danger)' : 'var(--t-faint)', fontSize: '11px' }"
            >错误 {{ counts.error }}</span
          >
          <span class="num" :style="{ color: counts.warn ? 'var(--warn)' : 'var(--t-faint)', fontSize: '11px' }"
            >警告 {{ counts.warn }}</span
          >
          <span class="num" style="color: var(--t-faint); font-size: 11px">提示 {{ counts.info }}</span>
          <span v-if="!counts.error && !counts.warn" class="num" style="color: var(--ok); font-size: 11px"
            >✓ 无阻断问题</span
          >
        </div>
        <!-- 分维度 -->
        <div v-for="dim in dims" :key="dim.label" class="mt-2 border-t pt-1.5" style="border-color: var(--line)">
          <div class="flex items-center justify-between">
            <span style="color: var(--t-hi); font-size: 11.5px; letter-spacing: 0.04em">{{ dim.label }}</span>
            <span class="num" style="color: var(--t-faint); font-size: 9.5px">{{ dim.sub }}</span>
          </div>
          <div v-if="!dim.issues.length" class="mt-1" style="color: var(--ok); font-size: 10.5px">通过 · 无问题</div>
          <div v-for="(issue, i) in dim.issues" :key="i" class="mt-1 flex items-start gap-1.5">
            <span
              class="num flex-none"
              :style="{
                color: lvColor(issue.level),
                border: `1px solid ${lvColor(issue.level)}`,
                borderRadius: '3px',
                padding: '0 3px',
                fontSize: '8.5px',
                marginTop: '1px',
              }"
              >{{ issue.rule }}</span
            >
            <span class="min-w-0" style="font-size: 10.5px; line-height: 1.5">
              <span style="color: var(--t-low)">{{ issue.target }}</span>
              <span style="color: var(--t-faint)"> — {{ issue.message }}</span>
            </span>
          </div>
        </div>
      </template>
      <div v-else class="mt-2" style="color: var(--t-faint); font-size: 11px">
        三维扫描：世界书（体例/预告/常驻预算）· 变量（codex/孤儿名/DLC 硬键）· 对账（世界书↔注册表）
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import Icon from '../Icon.vue';
import PanelSummaries from './PanelSummaries.vue';
import { usePanelSystem } from './usePanelSystem';

const fileInput = ref<HTMLInputElement | null>(null);
const {
  OFFICIAL_BOOKS,
  OFFICIAL_BOOKS_VERSION,
  aliasBusy,
  aliasCanon,
  aliasErr,
  aliasForce,
  aliasList,
  aliasMap,
  aliasMsg,
  aliasOpen,
  aliasVar,
  applySel,
  archBusy,
  archCandidates,
  archErr,
  archMsg,
  archOrphans,
  archReady,
  archSel,
  askUninstall,
  bookAdv,
  bookBusy,
  bookErr,
  bookGroups,
  bookMsg,
  bookSel,
  bookStates,
  counts,
  dataCardPreview,
  dims,
  doAddAlias,
  doArchive,
  doClearQuarantine,
  doExportSave,
  doInstall,
  doInstallRaw,
  doLearnAlias,
  doOrphan,
  doPrecheck,
  doRefreshBooks,
  doRemoveAlias,
  doReparse,
  doReplaySeeds,
  doRetry,
  doSubmitFix,
  doUndo,
  doUninstall,
  env,
  expBusy,
  expErr,
  expJson,
  expMsg,
  fileAllPending,
  filerState,
  fixKey,
  fixText,
  fmtVal,
  greens,
  importOpen,
  installError,
  installing,
  lvColor,
  manifestText,
  onDrop,
  onFileChange,
  openFix,
  overlays,
  parse,
  parseErr,
  parseError,
  parseMsg,
  parseR20,
  parsed,
  pickedFileName,
  preCounts,
  precheckIssues,
  precheckRan,
  quarantineFloors,
  quarantineTotal,
  ran,
  rawBind,
  rawBindDone,
  rawBooks,
  rawBusy,
  rawError,
  rawReceipt,
  receipt,
  refreshArchive,
  refreshBooks,
  repOpen,
  runCheck,
  running,
  seedBusy,
  seedErr,
  seedMissingOf,
  selAll,
  selOnly,
  selectAllText,
  setAutoFile,
  store,
  takeoverEntryCount,
  toggleAliasOpen,
  toggleArchSel,
  toggleGroup,
  toggleSel,
  undoTarget,
  uninstallError,
  uninstallPlan,
  uninstallTarget,
  uninstalling,
  wrapTag,
  yellows,
} = usePanelSystem();
</script>

<style scoped>
.sysbtn {
  font-size: 10.5px;
  letter-spacing: 0.04em;
  padding: 4px 12px;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--t-low);
}
.sysbtn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sysbtn--go {
  color: var(--warn);
  border-color: var(--warn);
}
.sysbtn--go:disabled {
  opacity: 0.6;
}
.sysbtn--danger {
  color: var(--danger);
  border-color: var(--danger);
}
.systa {
  width: 100%;
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 3px;
  color: var(--t-low);
  font-size: 10.5px;
  font-family: inherit;
  padding: 6px 8px;
  resize: vertical;
}
.systa:focus {
  outline: none;
  border-color: var(--warn);
}
</style>
