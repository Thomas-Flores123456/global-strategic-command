<template>
  <div
    class="pda-tab-intel flex h-full flex-1 flex-col overflow-y-auto px-2.5 py-2 font-mono text-xs text-(--text,#d9e5ed) select-none"
    :data-pending-lore-count="visiblePendingLore.length"
    :data-intel-count="intelList.length"
    :data-faction-count="factionsList.length"
    :data-testid="'pda-tab-intel'"
  >
    <!-- ══ 一、世界书落地暂存门 (Staging Gate) ══ -->
    <section
      class="mb-2.5 flex flex-col gap-1.5 rounded-sm border p-2"
      :class="
        visiblePendingLore.length > 0
          ? 'border-(--amber,#d2ad69)/55 bg-(--amber,#d2ad69)/8'
          : 'border-white/10 bg-black/30'
      "
      :data-testid="'pda-staging-gate'"
    >
      <header class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <span
            class="size-2 rounded-full"
            :class="
              visiblePendingLore.length > 0
                ? 'animate-pulse bg-(--amber,#d2ad69) shadow-[0_0_6px_var(--amber,#d2ad69)]'
                : 'bg-(--safe,#78b69b)'
            "
          />
          <span class="text-[11px] font-bold tracking-wide text-(--amber,#d2ad69)">
            STAGING // 待收录战区情报
          </span>
        </div>
        <span
          class="rounded-xs px-1.5 py-0.5 text-[10px] leading-none font-bold"
          :class="
            visiblePendingLore.length > 0
              ? 'bg-(--amber,#d2ad69)/25 text-(--amber,#d2ad69)'
              : 'bg-white/5 text-(--text-3,#7a8e9a)'
          "
          :data-testid="'pda-staging-count'"
        >
          待核准: {{ visiblePendingLore.length }}
        </span>
      </header>

      <div
        v-if="visiblePendingLore.length === 0"
        class="py-2 text-center text-[10px] text-(--text-3,#7a8e9a)"
        :data-testid="'pda-staging-empty'"
      >
        本轮没有新发现的势力、科技或角色记录
      </div>

      <div v-else class="flex flex-col gap-1.5" :data-testid="'pda-staging-list'">
        <article
          v-for="entry in visiblePendingLore"
          :key="entry.id"
          class="pda-staging-item flex flex-col gap-1 rounded-xs border border-(--amber,#d2ad69)/35 bg-black/45 p-2"
          :data-lore-id="entry.id"
          :data-lore-kind="entry.kind"
          :data-testid="'pda-staging-item'"
        >
          <div class="flex items-center justify-between gap-1.5">
            <div class="flex items-center gap-1.5 overflow-hidden">
              <span
                class="shrink-0 rounded-xs bg-(--amber,#d2ad69)/20 px-1 py-0.5 text-[10px] leading-none font-bold text-(--amber,#d2ad69)"
                :data-testid="'pda-lore-kind'"
              >
                [{{ entry.kind }}]
              </span>
              <span class="truncate text-[11px] font-bold text-(--text,#d9e5ed)" :data-testid="'pda-lore-name'">
                {{ entry.name }}
              </span>
            </div>

            <button
              type="button"
              class="shrink-0 cursor-pointer rounded-xs border border-(--safe,#78b69b)/55 bg-(--safe,#78b69b)/20 px-2 py-0.5 text-[10px] leading-none font-bold text-(--safe,#78b69b) transition-colors hover:bg-(--safe,#78b69b)/35 active:scale-95"
              :data-lore-id="entry.id"
              :data-testid="'pda-lore-adopt-btn'"
              @click="onAdoptLoreItem(entry)"
            >
              收录入档
            </button>
          </div>

          <p
            v-if="entry.summary"
            class="text-[10px] leading-relaxed text-(--text-2,#8fa3b1)"
            :data-testid="'pda-lore-summary'"
          >
            {{ entry.summary }}
          </p>
        </article>
      </div>
    </section>

    <!-- ══ 二、前线明牌战区情报流 (TACTICAL INTEL // FD-33 & FD-35 D-WEVO-STEALTH-03 职责分离) ══ -->
    <section
      class="mb-2.5 flex flex-col gap-1.5 rounded-sm border border-white/10 bg-black/30 p-2.5"
      data-test="pda-tactical-intel-section"
      :data-testid="'pda-tactical-intel-section'"
    >
      <header class="flex flex-wrap items-center justify-between gap-1.5">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] font-bold tracking-wide text-(--ice,#8bc3e7)">
            TACTICAL INTEL // 战区明牌情报
          </span>
          <span
            v-if="activeWorldEvoCount > 0"
            role="button"
            tabindex="0"
            class="cursor-pointer rounded-xs border border-(--amber,#d2ad69)/35 bg-(--amber,#d2ad69)/12 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--amber,#d2ad69) transition-colors hover:bg-(--amber,#d2ad69)/25"
            data-test="pda-world-evo-stealth-hint"
            :data-testid="'pda-world-evo-stealth-hint'"
            @click="showWorldEvoDrawer = !showWorldEvoDrawer"
          >
            🌐 幕后暗流×{{ activeWorldEvoCount }}（详见设置·世界演变）
          </span>
        </div>
        <div class="flex flex-wrap items-center gap-1 text-[10px]">
          <button
            v-for="tab in INTEL_FILTER_TABS"
            :key="tab.id"
            type="button"
            class="cursor-pointer rounded-xs border px-1.5 py-0.5 leading-none font-bold whitespace-nowrap transition-colors"
            :class="
              intelFilter === tab.id
                ? 'border-(--line-hot,rgba(145,201,239,0.5)) bg-white/12 text-(--ice,#8bc3e7)'
                : 'border-transparent bg-white/4 text-(--text-3,#7a8e9a) hover:text-(--text,#d9e5ed)'
            "
            :data-filter-id="tab.id"
            data-test="pda-intel-filter-tab"
            :data-testid="'pda-intel-filter-tab'"
            @click="intelFilter = tab.id"
          >
            {{ tab.label }} ({{ intelCountFor(tab.id) }})
          </button>
        </div>
      </header>

      <!-- 点击 pda-world-evo-stealth-hint 时展开的世界演变内联抽屉 -->
      <div
        v-if="showWorldEvoDrawer && worldEvolutionsList.length > 0"
        class="mb-1.5 flex flex-col gap-1.5 rounded-xs border border-(--amber,#d2ad69)/35 bg-black/50 p-2"
        data-test="pda-world-evo-drawer"
        :data-testid="'pda-world-evo-drawer'"
      >
        <article
          v-for="(evo, eIdx) in worldEvolutionsList"
          :key="intelKey(evo, eIdx)"
          class="flex flex-col gap-1 rounded-xs border border-white/10 bg-black/45 p-2"
          data-test="wevo-active-card"
          :data-testid="'wevo-active-card'"
          :data-evo-id="evo.id || intelKey(evo, eIdx)"
          :data-stage="evo.stage || '萌芽'"
        >
          <div class="flex flex-wrap items-center justify-between gap-1.5">
            <span class="truncate text-xs font-bold text-(--amber,#d2ad69)" data-test="wevo-card-title">
              {{ evo.title || evo.src || '世界演变暗流' }}
            </span>
            <span class="rounded-xs px-1.5 py-0.5 text-[10px] leading-none font-bold" :class="evoStageBadgeClass(evo.stage)">
              {{ evo.evo_domain || '远方地缘' }} · {{ evo.stage || '萌芽' }} · TTL {{ resolveEvoTtl(evo) }}
            </span>
          </div>
          <p class="text-[10.5px] leading-relaxed text-(--text-2,#8fa3b1)" data-test="wevo-summary">
            {{ evo.content }}
          </p>
          <div class="mt-0.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-white/6 pt-1">
            <button
              type="button"
              data-test="wevo-pin-btn"
              :data-testid="'wevo-pin-btn'"
              class="cursor-pointer rounded-xs border px-1.5 py-0.5 text-[10px] leading-none font-bold transition-colors"
              :class="
                isIntelPinned(evo)
                  ? 'border-(--amber,#d2ad69)/55 bg-(--amber,#d2ad69)/22 text-(--amber,#d2ad69)'
                  : 'border-white/15 bg-white/6 text-(--text-2,#8fa3b1) hover:text-(--text,#d9e5ed)'
              "
              @click="onTogglePinIntel(evo)"
            >
              {{ isIntelPinned(evo) ? '◆ 解除锁定' : '◇ 置顶锁 TTL' }}
            </button>
            <button
              type="button"
              data-test="wevo-archive-wb-btn"
              :data-testid="'wevo-archive-wb-btn'"
              class="cursor-pointer rounded-xs border border-(--safe,#78b69b)/45 bg-(--safe,#78b69b)/15 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--safe,#78b69b) transition-colors hover:bg-(--safe,#78b69b)/28"
              @click="onArchiveIntelToWorldbook(evo)"
            >
              ◆ 沉淀入世界书 L3
            </button>
            <button
              type="button"
              data-test="wevo-act-btn"
              :data-testid="'wevo-act-btn'"
              class="cursor-pointer rounded-xs border border-(--line-hot,rgba(145,201,239,0.45)) bg-(--ice,#8bc3e7)/12 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--ice,#8bc3e7) transition-colors hover:bg-(--ice,#8bc3e7)/25"
              @click="onActIntel(evo)"
            >
              → 转化为前线侦察指令
            </button>
          </div>
        </article>
      </div>

      <div
        v-if="filteredIntelList.length === 0"
        class="py-2 text-center text-[10px] text-(--text-3,#7a8e9a)"
        data-test="pda-intel-feed-empty"
        :data-testid="'pda-intel-feed-empty'"
      >
        当前筛选下暂无已截获的战区明牌情报
      </div>

      <div v-else class="flex flex-col gap-1.5" data-test="pda-intel-feed-list" :data-testid="'pda-intel-feed-list'">
        <article
          v-for="(item, idx) in filteredIntelList"
          :key="intelKey(item, idx)"
          class="flex flex-col gap-1 rounded-xs border border-white/10 bg-black/45 p-2 transition-colors"
          :data-intel-scope="'tactical'"
          :data-intel-pinned="isIntelPinned(item)"
          data-test="pda-intel-feed-card"
          :data-testid="'pda-intel-feed-card'"
        >
          <div class="flex flex-wrap items-center justify-between gap-1.5">
            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                class="shrink-0 rounded-xs border border-(--ice,#8bc3e7)/35 bg-(--ice,#8bc3e7)/15 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--ice,#8bc3e7)"
                data-test="pda-intel-src-kind"
                :data-testid="'pda-intel-src-kind'"
              >
                {{ formatIntelSourceBadge(item) }}
              </span>
              <span
                v-if="item.chain || item.chain_step"
                class="shrink-0 rounded-xs border border-(--amber,#d2ad69)/40 bg-(--amber,#d2ad69)/15 px-1.5 py-0.5 text-[11px] leading-none font-bold text-(--amber,#d2ad69)"
                :data-intel-chain="item.chain || '侦察案卷'"
                :data-intel-chain-step="item.chain_step || undefined"
                data-test="pda-intel-chain"
                :data-testid="'pda-intel-chain'"
              >
                [情报链: {{ item.chain || '侦察案卷' }}{{ item.chain_step ? ' · ' + item.chain_step : '' }}]
              </span>
              <span class="truncate text-xs font-bold text-(--text,#d9e5ed)" :data-testid="'pda-intel-title'">
                {{ item.title || item.src || '战区线报' }}
              </span>
            </div>
            <div class="flex shrink-0 items-center gap-1.5">
              <span v-if="item.date" class="text-[9px] text-(--text-3,#7a8e9a)">{{ item.date }}</span>
              <span
                class="rounded-xs px-1.5 py-0.5 text-[10px] leading-none font-bold"
                :class="intelCredBadgeClass(item)"
                data-test="pda-intel-cred"
                :data-testid="'pda-intel-cred'"
              >
                {{ formatIntelCredLabel(item) }}
              </span>
            </div>
          </div>

          <!-- 可信度条 -->
          <div
            class="flex items-center gap-1.5 pt-0.5"
            data-test="pda-intel-cred-bar"
            :data-testid="'pda-intel-cred-bar'"
          >
            <span class="shrink-0 text-[9px] text-(--text-3,#7a8e9a)">可信度</span>
            <div class="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="intelCredBarFillClass(item)"
                :style="{ width: `${intelCredPercent(item)}%` }"
              />
            </div>
            <span class="shrink-0 text-[9px] text-(--text-3,#7a8e9a)">{{ intelCredPercent(item) }}%</span>
          </div>

          <div
            v-if="item.evolves_from"
            class="text-[10px] text-(--ice,#8bc3e7)"
            data-test="pda-intel-evolves-from"
            :data-testid="'pda-intel-evolves-from'"
          >
            🔗 演进自: {{ item.evolves_from }}
          </div>

          <!-- 正文 -->
          <p class="text-[10.5px] leading-relaxed text-(--text-2,#8fa3b1)" :data-testid="'pda-intel-content'">
            {{ item.content }}
          </p>

          <div
            v-if="item.next_lead || item.hook"
            class="rounded-xs border-l-2 border-(--ice,#8bc3e7) bg-(--ice,#8bc3e7)/10 px-1.5 py-1 text-[11px] leading-snug text-(--ice,#8bc3e7)"
            :data-intel-next-lead="item.next_lead || item.hook"
            data-test="pda-intel-next-lead"
            :data-testid="'pda-intel-next-lead'"
          >
            ▸ 下一步核查线索: {{ item.next_lead || item.hook }}
          </div>

          <!-- 三合一战术操作栏 -->
          <div class="mt-0.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-white/6 pt-1">
            <button
              type="button"
              class="cursor-pointer rounded-xs border border-(--line-hot,rgba(145,201,239,0.45)) bg-(--ice,#8bc3e7)/12 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--ice,#8bc3e7) transition-colors hover:bg-(--ice,#8bc3e7)/25 active:scale-95"
              data-test="pda-intel-act-btn"
              :data-testid="'pda-intel-act-btn'"
              @click="onActIntel(item)"
            >
              {{ actedIntelKey === intelKey(item) ? '✓ 已填入指令' : '▶ 派遣侦察/介入' }}
            </button>

            <button
              type="button"
              class="cursor-pointer rounded-xs border px-1.5 py-0.5 text-[10px] leading-none font-bold transition-colors active:scale-95"
              :class="
                isIntelPinned(item)
                  ? 'border-(--amber,#d2ad69)/55 bg-(--amber,#d2ad69)/22 text-(--amber,#d2ad69)'
                  : 'border-white/15 bg-white/6 text-(--text-2,#8fa3b1) hover:text-(--text,#d9e5ed)'
              "
              data-test="pda-intel-pin-btn"
              :data-testid="'pda-intel-pin-btn'"
              @click="onTogglePinIntel(item)"
            >
              {{ isIntelPinned(item) ? '📌 取消置顶' : '📌 置顶锁定' }}
            </button>

            <button
              type="button"
              class="cursor-pointer rounded-xs border border-(--safe,#78b69b)/45 bg-(--safe,#78b69b)/15 px-1.5 py-0.5 text-[10px] leading-none font-bold text-(--safe,#78b69b) transition-colors hover:bg-(--safe,#78b69b)/28 active:scale-95"
              data-test="pda-intel-archive-wb-btn"
              :data-testid="'pda-intel-archive-wb-btn'"
              @click="onArchiveIntelToWorldbook(item)"
            >
              {{ archivedIntelKeys.has(intelKey(item)) ? '✓ 已转入收录' : '📥 沉淀入书' }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- ══ 三、在册人物与战区图鉴 (Personnel & Codex：展示重要 NPC 人物、随行人员与解锁图鉴) ══ -->
    <section
      class="mb-2.5 flex flex-col gap-1.5 rounded-sm border border-white/10 bg-black/30 p-2.5"
      :data-testid="'pda-codex-section'"
    >
      <header class="flex items-center justify-between gap-2">
        <span class="text-[11px] font-bold tracking-wide text-(--ice,#8bc3e7)">
          CODEX // 在册人员与战区图鉴
        </span>
        <div class="flex items-center gap-1 text-[10px]">
          <button
            v-for="cat in CODEX_FILTER_TABS"
            :key="cat.id"
            type="button"
            class="cursor-pointer rounded-xs border px-1.5 py-0.5 leading-none font-bold whitespace-nowrap transition-colors"
            :class="
              codexFilter === cat.id
                ? 'border-(--line-hot,rgba(145,201,239,0.5)) bg-white/12 text-(--ice,#8bc3e7)'
                : 'border-transparent bg-white/4 text-(--text-3,#7a8e9a) hover:text-(--text,#d9e5ed)'
            "
            :data-filter-id="cat.id"
            :data-test="`pda-codex-filter-${cat.id}`"
            :data-testid="`pda-codex-filter-${cat.id}`"
            @click="codexFilter = cat.id"
          >
            {{ cat.label }} ({{ codexCountFor(cat.id) }})
          </button>
        </div>
      </header>

      <div
        v-if="filteredCodexList.length === 0"
        class="py-2 text-center text-[10px] text-(--text-3,#7a8e9a)"
        :data-testid="'pda-codex-empty'"
      >
        当前分类下暂无在册人员或图鉴档案
      </div>

      <div v-else class="flex flex-col gap-1.5" :data-testid="'pda-codex-list'">
        <article
          v-for="entry in filteredCodexList"
          :key="entry.name"
          class="flex flex-col gap-1 rounded-xs border border-white/10 bg-black/45 p-2 transition-colors hover:border-white/20"
          :data-codex-name="entry.name"
          :data-codex-kind="entry.kind"
          :data-testid="'pda-codex-card'"
        >
          <div
            class="flex cursor-pointer flex-wrap items-center justify-between gap-1.5"
            @click="toggleCodexExpand(entry.name)"
          >
            <div class="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                class="shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] leading-none font-bold"
                :class="codexKindBadgeClass(entry.kind)"
                :data-testid="'pda-codex-kind'"
              >
                [{{ entry.kind || '档案' }}]
              </span>
              <span class="truncate text-xs font-bold text-(--text,#d9e5ed)">{{ entry.name }}</span>
              <span
                v-if="codexCallsign(entry)"
                class="shrink-0 text-[10px] text-(--ice,#8bc3e7)"
              >
                「{{ codexCallsign(entry) }}」
              </span>
              <span
                v-if="isPersonKind(entry.kind) && codexFaction(entry)"
                class="shrink-0 rounded-xs border border-white/15 bg-white/8 px-1.5 py-0.5 text-[10px] leading-none text-(--text-2,#8fa3b1)"
                data-test="pda-codex-faction"
                :data-testid="'pda-codex-faction'"
              >
                {{ codexFaction(entry) }}
              </span>
              <span
                v-if="isPersonKind(entry.kind) && codexAttitude(entry)"
                class="shrink-0 rounded-xs px-1.5 py-0.5 text-[10px] leading-none font-bold"
                :class="attitudeBadgeClass(codexAttitude(entry))"
                data-test="pda-codex-attitude"
                :data-testid="'pda-codex-attitude'"
              >
                {{ codexAttitude(entry) }}
              </span>
            </div>
            <div class="flex shrink-0 items-center gap-1.5 text-[10px] text-(--text-3,#7a8e9a)">
              <span v-if="codexRole(entry)">
                {{ codexRole(entry) }}
              </span>
              <span class="text-(--ice,#8bc3e7)">{{ expandedCodexName === entry.name ? '收起 ▲' : '详情 ▼' }}</span>
            </div>
          </div>

          <!-- 次行：人物/随行的信任度进度条 (0~100%) 与 当前状态/驻地 -->
          <div
            v-if="isPersonKind(entry.kind) && (codexTrustPercent(entry) !== null || codexStatus(entry))"
            class="flex flex-wrap items-center justify-between gap-2 pt-0.5 text-[10px]"
          >
            <div
              v-if="codexTrustPercent(entry) !== null"
              class="flex min-w-[120px] flex-1 items-center gap-1.5"
            >
              <span class="shrink-0 text-[9px] text-(--text-3,#7a8e9a)">信任度</span>
              <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                <div
                  class="h-full rounded-full transition-all duration-300"
                  :class="trustBarClass(codexTrustPercent(entry)!)"
                  :style="{ width: `${codexTrustPercent(entry)}%` }"
                  data-test="pda-codex-trust-bar"
                  :data-testid="'pda-codex-trust-bar'"
                />
              </div>
              <span class="shrink-0 text-[9px] font-bold text-(--text-2,#8fa3b1)">
                {{ codexTrustPercent(entry) }}%
              </span>
            </div>
            <span
              v-if="codexStatus(entry)"
              class="truncate text-[10px] text-(--text-2,#8fa3b1)"
              data-test="pda-codex-status"
              :data-testid="'pda-codex-status'"
            >
              {{ codexStatus(entry) }}
            </span>
          </div>

          <p class="text-[11px] leading-relaxed text-(--text-2,#8fa3b1)">
            {{ entry.desc }}
          </p>

          <!-- 展开态：展示随行渊源、外貌着装、性格与口吻等全部立体参数 -->
          <div
            v-if="expandedCodexName === entry.name && entry.params && Object.keys(entry.params).length > 0"
            class="mt-1 flex flex-col gap-1 border-t border-white/8 pt-1.5 text-[10.5px]"
          >
            <div
              v-for="(val, key) in entry.params"
              :key="String(key)"
              class="flex items-start gap-2 leading-snug"
            >
              <span class="w-16 shrink-0 font-bold text-(--text-3,#7a8e9a)">{{ key }}:</span>
              <span class="flex-1 text-(--text,#d9e5ed)">{{ val }}</span>
            </div>
          </div>

          <!-- 人物/随行卡底部（或展开区）：▶ 约谈/联络此人 快捷填入按钮 -->
          <div
            v-if="isPersonKind(entry.kind)"
            class="mt-0.5 flex items-center justify-end border-t border-white/6 pt-1"
          >
            <button
              type="button"
              class="cursor-pointer rounded-xs border border-(--line-hot,rgba(145,201,239,0.45)) bg-(--ice,#8bc3e7)/12 px-2 py-0.5 text-[10px] leading-none font-bold text-(--ice,#8bc3e7) transition-colors hover:bg-(--ice,#8bc3e7)/25 active:scale-95"
              :data-person-name="entry.name"
              data-test="pda-codex-contact-btn"
              :data-testid="'pda-codex-contact-btn'"
              @click.stop="onContactPerson(entry.name)"
            >
              {{ contactedPersonName === entry.name ? '✓ 已填入指令' : '▶ 约谈/联络此人' }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <!-- ══ 四、战区势力态势简表 (Faction Standings) ══ -->
    <section
      class="mb-2.5 flex flex-col gap-1.5 rounded-sm border border-white/10 bg-black/30 p-2"
      :data-testid="'pda-factions-section'"
    >
      <header class="flex items-center justify-between">
        <span class="text-[11px] font-bold tracking-wide text-(--ice,#8bc3e7)">
          FACTIONS // 战区势力态势简表
        </span>
        <span class="text-[10px] text-(--text-3,#7a8e9a)">已接触: {{ factionsList.length }}</span>
      </header>

      <div
        v-if="factionsList.length === 0"
        class="py-2 text-center text-[10px] text-(--text-3,#7a8e9a)"
        :data-testid="'pda-factions-empty'"
      >
        暂无已探明的战区外部势力记录
      </div>

      <div v-else class="flex flex-col gap-2" :data-testid="'pda-factions-list'">
        <article
          v-for="fac in factionsList"
          :key="fac.name"
          class="pda-faction-card flex flex-col gap-1 rounded-xs border border-white/10 bg-black/40 p-2"
          :data-faction-name="fac.name"
          :data-faction-attitude="fac.attitude"
          :data-testid="'pda-faction-card'"
        >
          <div class="flex items-center justify-between gap-1.5">
            <span class="truncate text-[11px] font-bold text-(--text,#d9e5ed)" :data-testid="'pda-faction-name'">
              {{ fac.name }}
            </span>
            <div class="flex shrink-0 items-center gap-1">
              <span
                v-if="fac.risk && fac.risk !== '未知'"
                class="rounded-xs bg-white/5 px-1 py-0.5 text-[9px] text-(--text-3,#7a8e9a)"
              >
                风险:{{ fac.risk }}
              </span>
              <span
                class="rounded-xs px-1.5 py-0.5 text-[10px] leading-none font-bold"
                :class="attitudeBadgeClass(fac.attitude)"
                :data-testid="'pda-faction-attitude'"
              >
                {{ fac.attitude }}
              </span>
            </div>
          </div>

          <!-- 好感 / 敌对关系条 -->
          <div class="flex items-center gap-2">
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="attitudeBarClass(fac.attitude)"
                :style="{ width: `${attitudePercent(fac.attitude)}%` }"
                :data-testid="'pda-faction-relation-bar'"
              />
            </div>
            <span class="w-8 text-right text-[10px] text-(--text-3,#7a8e9a)">
              {{ attitudePercent(fac.attitude) }}%
            </span>
          </div>

          <p v-if="fac.intel" class="text-[10px] leading-snug text-(--text-2,#8fa3b1)" :data-testid="'pda-faction-intel'">
            {{ fac.intel }}
          </p>
        </article>
      </div>
    </section>

    <!-- ══ 五、指挥官速记备忘录区 (Commander Memo) ══ -->
    <section
      class="flex flex-col gap-1.5 rounded-sm border border-white/10 bg-black/30 p-2"
      :data-testid="'pda-intel-memo-section'"
    >
      <header class="flex items-center justify-between">
        <span class="text-[11px] font-bold tracking-wide text-(--ice,#8bc3e7)">
          MEMO // 指挥官速记备忘录
        </span>
        <button
          type="button"
          class="cursor-pointer rounded-xs border border-(--line-hot,rgba(145,201,239,0.45)) bg-white/5 px-1.5 py-0.5 text-[10px] leading-none text-(--ice,#8bc3e7) transition-colors hover:bg-white/15 active:scale-95"
          :data-testid="'pda-intel-memo-save'"
          @click="onSaveMemo"
        >
          保存速记
        </button>
      </header>

      <textarea
        v-model="memoDraft"
        rows="3"
        placeholder="输入战区现场勘察备忘、敌情坐标或下一步作战意图..."
        class="w-full resize-none rounded-xs border border-white/10 bg-black/50 p-1.5 font-mono text-[11px] leading-relaxed text-(--text,#d9e5ed) select-text placeholder:text-(--text-4,#354957) focus:border-(--line-hot,rgba(145,201,239,0.54)) focus:outline-none"
        :data-testid="'pda-intel-memo-input'"
      />

      <div
        v-if="memoSavedNotice"
        class="text-right text-[10px] text-(--safe,#78b69b)"
        :data-testid="'pda-intel-memo-saved'"
      >
        ✓ 备忘录已同步至掌上缓存
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { getActivePinia } from 'pinia';
import { computed, getCurrentInstance, onUnmounted, ref, watch } from 'vue';
import { isGirlDossierEntry } from '../../红警指挥系统/worldbook/girlFiler';
import { fillHostSendInput } from '../../红警指挥系统/worldbook/hostSendInput';
import type { CodexEntry, Faction, Schema } from '../../红警指挥系统/core/schema';
import { useFloatingStore } from '../../红警指挥系统/composables/useFloatingStore';

export interface NormalizedPendingLoreItem {
  id: string;
  name: string;
  kind: string;
  summary: string;
  sourceFloor?: number;
  raw?: unknown;
}

export interface PdaIntelItemLike {
  id?: string;
  title?: string;
  src?: string;
  src_kind?: string;
  content: string;
  date?: string;
  cred?: '高' | '中' | '低' | string;
  status?: '待核实' | '已证实' | '已证伪' | '演进中' | string;
  evolves_from?: string;
  chain?: string;
  chain_step?: string;
  next_lead?: string;
  scope?: 'tactical' | 'world' | string;
  evo_domain?: '远方地缘' | '位面异象' | '暗流科技' | '社会黑市' | string;
  stage?: '萌芽' | '发酵' | '高潮' | '平息' | string;
  ttl_floors?: number;
  hook?: string;
  read?: boolean;
  pinned?: boolean;
}

export type PdaIntelFilterTabId = 'all' | 'tactical' | 'pinned';

export interface PdaTabIntelProps {
  factions?: Faction[];
  pendingLore?: readonly unknown[];
  intel?: readonly PdaIntelItemLike[];
  worldEvolutions?: readonly PdaIntelItemLike[];
  codex?: readonly CodexEntry[];
  snapshot?: (Partial<Schema> & {
    intel?: readonly PdaIntelItemLike[] | {
      items?: readonly PdaIntelItemLike[];
      tactical_intel?: readonly PdaIntelItemLike[];
      world_evolutions?: readonly PdaIntelItemLike[];
    };
    world_evolutions?: readonly PdaIntelItemLike[];
  }) | null;
  memo?: string;
  onAdoptLore?: (item: NormalizedPendingLoreItem) => void;
}

const props = withDefaults(defineProps<PdaTabIntelProps>(), {
  factions: undefined,
  pendingLore: undefined,
  intel: undefined,
  worldEvolutions: undefined,
  codex: undefined,
  snapshot: undefined,
  memo: '',
  onAdoptLore: undefined,
});

const emit = defineEmits<{
  (e: 'adopt-lore', item: NormalizedPendingLoreItem): void;
  (e: 'update:memo', text: string): void;
  (e: 'save-memo', text: string): void;
  (e: 'contact-person', name: string, commandText: string): void;
  (e: 'act-intel', item: PdaIntelItemLike, commandText: string): void;
  (e: 'toggle-pin-intel', item: PdaIntelItemLike, nextPinned: boolean): void;
  (e: 'archive-intel-lore', item: PdaIntelItemLike, loreEntry: NormalizedPendingLoreItem): void;
}>();

const memoDraft = ref<string>(props.memo);
const memoSavedNotice = ref(false);
const contactedPersonName = ref<string | null>(null);
const actedIntelKey = ref<string | null>(null);
const pinnedOverrides = ref<Record<string, boolean>>({});
const archivedIntelKeys = ref<Set<string>>(new Set());
const stagedFromIntelLore = ref<NormalizedPendingLoreItem[]>([]);
let contactFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let intelActFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

if (getCurrentInstance()) {
  onUnmounted(() => {
    if (contactFeedbackTimer !== null) {
      clearTimeout(contactFeedbackTimer);
      contactFeedbackTimer = null;
    }
    if (intelActFeedbackTimer !== null) {
      clearTimeout(intelActFeedbackTimer);
      intelActFeedbackTimer = null;
    }
  });
}

watch(
  () => props.memo,
  next => {
    if (next !== undefined) {
      memoDraft.value = next;
    }
  },
);

const storeSnapshot = computed<(Partial<Schema> & { intel?: readonly PdaIntelItemLike[] }) | null>(() => {
  if (props.snapshot !== undefined) return props.snapshot;
  try {
    const pinia = getActivePinia();
    if (!pinia) return null;
    const floating = useFloatingStore(pinia);
    return floating.snapshot as (Partial<Schema> & { intel?: readonly PdaIntelItemLike[] }) | null;
  } catch {
    return null;
  }
});

/* ── FD-33 & FD-35: TACTICAL INTEL // 战区明牌情报（幕后世界演变职责分离） ── */
const INTEL_FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: 'tactical', label: '战区情报' },
  { id: 'pinned', label: '📌已置顶' },
] as const;

const intelFilter = ref<PdaIntelFilterTabId>('all');
const showWorldEvoDrawer = ref(false);

const rawAllIntelList = computed<readonly PdaIntelItemLike[]>(() => {
  if (Array.isArray(props.intel)) return props.intel;
  const raw = storeSnapshot.value?.intel;
  if (Array.isArray(raw)) return raw as readonly PdaIntelItemLike[];
  if (raw && typeof raw === 'object') {
    const obj = raw as {
      items?: readonly PdaIntelItemLike[];
      tactical_intel?: readonly PdaIntelItemLike[];
      world_evolutions?: readonly PdaIntelItemLike[];
    };
    const tactical = Array.isArray(obj.tactical_intel)
      ? obj.tactical_intel
      : Array.isArray(obj.items)
        ? obj.items
        : [];
    const evos = Array.isArray(obj.world_evolutions)
      ? obj.world_evolutions.map(e => ({ ...e, scope: 'world' }))
      : [];
    return [...tactical, ...evos];
  }
  return [];
});

function intelKey(item: PdaIntelItemLike, idx?: number): string {
  const base = (item.id || item.title || `${item.src || ''}::${item.content || ''}`).trim();
  return base || `intel_${idx ?? 0}`;
}

function isWorldEvolutionItem(item: PdaIntelItemLike): boolean {
  return item.scope === 'world' || Boolean(item.evo_domain || item.stage);
}

/** FD-35 D-WEVO-STEALTH-03：前线 PDA 仅展示我方已真实截获的明牌战区情报 <情报> */
const intelList = computed<readonly PdaIntelItemLike[]>(() =>
  rawAllIntelList.value.filter(i => !isWorldEvolutionItem(i)),
);

/** 后台活跃的世界演变列表（仅用于统计加密角标数量，不在前线 PDA 剧透任何卡片标题） */
const worldEvolutionsList = computed<readonly PdaIntelItemLike[]>(() => {
  const map = new Map<string, PdaIntelItemLike>();
  for (const item of rawAllIntelList.value) {
    if (isWorldEvolutionItem(item)) {
      map.set(intelKey(item), item);
    }
  }
  const extraSources = [
    props.worldEvolutions,
    (storeSnapshot.value as { world_evolutions?: readonly PdaIntelItemLike[] } | null)?.world_evolutions,
  ];
  for (const list of extraSources) {
    if (Array.isArray(list)) {
      for (const item of list) {
        if (item && typeof item === 'object') {
          map.set(intelKey(item), { ...item, scope: 'world' });
        }
      }
    }
  }
  return [...map.values()];
});

const activeWorldEvoCount = computed<number>(() =>
  worldEvolutionsList.value.filter(i => i.stage !== '平息').length,
);

function isIntelPinned(item: PdaIntelItemLike): boolean {
  const key = intelKey(item);
  if (key in pinnedOverrides.value) {
    return pinnedOverrides.value[key];
  }
  return item.pinned === true;
}

const filteredIntelList = computed<readonly PdaIntelItemLike[]>(() => {
  if (intelFilter.value === 'all' || intelFilter.value === 'tactical') return intelList.value;
  return intelList.value.filter(i => isIntelPinned(i));
});

function intelCountFor(tabId: PdaIntelFilterTabId): number {
  if (tabId === 'all' || tabId === 'tactical') return intelList.value.length;
  return intelList.value.filter(i => isIntelPinned(i)).length;
}

function formatIntelSourceBadge(item: PdaIntelItemLike): string {
  const raw = (item.src_kind || item.src || '').trim();
  if (raw.includes('雷达') || raw.includes('卫星') || raw.includes('天基')) return '📡 雷达侦察';
  if (raw.includes('渗透') || raw.includes('内线') || raw.includes('间谍') || raw.includes('密报')) return '🕵️ 渗透内线';
  if (raw.includes('暗网') || raw.includes('黑市') || raw.includes('流言')) return '🕸️ 暗网流言';
  if (raw.includes('电讯') || raw.includes('截获') || raw.includes('监听') || raw.includes('破译')) return '📻 电讯截获';
  if (raw.includes('前线') || raw.includes('目视') || raw.includes('审讯')) return '🔭 前线目视';
  if (raw.includes('广播') || raw.includes('公报') || raw.includes('宏观')) return '🌍 宏观广播';
  return raw ? `📡 ${raw}` : '📡 战区线报';
}

function formatIntelCredLabel(item: PdaIntelItemLike): string {
  const cred = (item.cred || '中').trim();
  const status = (item.status || '').trim();
  return status ? `${cred} · ${status}` : cred;
}

function intelCredPercent(item: PdaIntelItemLike): number {
  if (item.status === '已证伪') return 10;
  if (item.status === '已证实' || item.cred === '高') return 100;
  if (item.cred === '低') return 35;
  return 65;
}

function intelCredBarFillClass(item: PdaIntelItemLike): string {
  if (item.status === '已证伪') return 'bg-(--alert-bright,#ff5a36)';
  if (item.status === '已证实' || item.cred === '高') return 'bg-(--safe,#78b69b)';
  if (item.cred === '低') return 'bg-(--amber,#d2ad69)';
  return 'bg-(--ice,#8bc3e7)';
}

function intelCredBadgeClass(item: PdaIntelItemLike): string {
  if (item.status === '已证伪') {
    return 'bg-(--alert-bright,#ff5a36)/25 text-(--alert-bright,#ff5a36)';
  }
  if (item.status === '已证实' || item.cred === '高') {
    return 'bg-(--safe,#78b69b)/25 text-(--safe,#78b69b)';
  }
  if (item.cred === '低') {
    return 'bg-(--amber,#d2ad69)/25 text-(--amber,#d2ad69)';
  }
  return 'bg-(--ice,#8bc3e7)/20 text-(--ice,#8bc3e7)';
}

function evoStageBadgeClass(stage?: string): string {
  switch (stage) {
    case '显化':
    case '高潮':
      return 'bg-(--alert-bright,#ff5a36)/25 text-(--alert-bright,#ff5a36)';
    case '发酵':
      return 'bg-(--amber,#d2ad69)/25 text-(--amber,#d2ad69)';
    case '平息':
      return 'bg-white/10 text-(--text-3,#7a8e9a)';
    case '萌芽':
    default:
      return 'bg-(--ice,#8bc3e7)/20 text-(--ice,#8bc3e7)';
  }
}

function resolveEvoTtl(item: PdaIntelItemLike): number {
  const n = typeof item.ttl_floors === 'number' && Number.isFinite(item.ttl_floors) ? Math.round(item.ttl_floors) : 5;
  return Math.max(0, Math.min(20, n));
}

function buildIntelActionCommand(item: PdaIntelItemLike): string {
  if (isWorldEvolutionItem(item)) {
    const title = (item.title || item.src || item.content.slice(0, 18)).trim();
    const domain = (item.evo_domain || '远方地缘').trim();
    const stage = (item.stage || '萌芽').trim();
    return `密切关注并派员介入远方动向【${title}】（${domain}·${stage}），评估我方切入时机。`;
  }
  const src = (item.src || item.src_kind || '战区线报').trim();
  const titleOrContent = (item.title || item.content).trim();
  if (item.chain || item.chain_step || item.next_lead) {
    const chainLabel = (item.chain || item.title || item.content).trim();
    const stepSuffix = item.chain_step ? `（当前阶数：${item.chain_step.trim()}）` : '';
    const leadText = (item.next_lead || item.hook || '').trim();
    const leadSuffix = leadText ? `，重点追查：${leadText}` : '，查明真伪与具体坐标';
    return `【深挖情报链：${chainLabel}】调遣侦察与情报部门核查【${src}】线报：「${titleOrContent}」${stepSuffix}${leadSuffix}。`;
  }
  return `调遣侦察与情报部门核查【${src}】线报：「${titleOrContent}」，查明真伪与具体坐标。`;
}

function onActIntel(item: PdaIntelItemLike): string {
  const commandText = buildIntelActionCommand(item);
  fillContactCommandToHostTextarea(commandText);
  const key = intelKey(item);
  actedIntelKey.value = key;
  if (intelActFeedbackTimer !== null) {
    clearTimeout(intelActFeedbackTimer);
  }
  intelActFeedbackTimer = setTimeout(() => {
    if (actedIntelKey.value === key) {
      actedIntelKey.value = null;
    }
    intelActFeedbackTimer = null;
  }, 2000);
  emit('act-intel', item, commandText);
  return commandText;
}

function syncStoreField(field: 'intel' | 'pending_lore', nextValue: unknown) {
  try {
    const pinia = getActivePinia() as (ReturnType<typeof getActivePinia> & { _s?: Map<string, Record<string, unknown>> }) | undefined;
    if (pinia?._s) {
      for (const storeInst of pinia._s.values()) {
        if (typeof storeInst.set === 'function') {
          (storeInst.set as (k: string, v: unknown) => void)(field, nextValue);
        } else if (storeInst.data && typeof storeInst.data === 'object') {
          (storeInst.data as Record<string, unknown>)[field] = nextValue;
        }
      }
    }
  } catch {
    /* ignore */
  }
}

function onTogglePinIntel(item: PdaIntelItemLike): boolean {
  const key = intelKey(item);
  const nextPinned = !isIntelPinned(item);
  pinnedOverrides.value = {
    ...pinnedOverrides.value,
    [key]: nextPinned,
  };
  try {
    (item as { pinned?: boolean }).pinned = nextPinned;
  } catch {
    /* readonly prop */
  }
  const nextIntel = rawAllIntelList.value.map(entry =>
    intelKey(entry) === key ? { ...entry, pinned: nextPinned } : entry,
  );
  syncStoreField('intel', nextIntel);
  emit('toggle-pin-intel', item, nextPinned);
  return nextPinned;
}

function onArchiveIntelToWorldbook(item: PdaIntelItemLike): NormalizedPendingLoreItem {
  const key = intelKey(item);
  const name = (item.title || item.src || item.content.slice(0, 18)).trim() || '战区情报条目';
  const kind = isWorldEvolutionItem(item)
    ? item.evo_domain === '暗流科技'
      ? '科技'
      : '其他'
    : '其他';
  const loreEntry: NormalizedPendingLoreItem = {
    id: `lore_intel_${name}`,
    name,
    kind,
    summary: item.content,
    raw: item,
  };
  const nextSet = new Set(archivedIntelKeys.value);
  nextSet.add(key);
  archivedIntelKeys.value = nextSet;

  if (!stagedFromIntelLore.value.some(e => e.id === loreEntry.id)) {
    stagedFromIntelLore.value = [...stagedFromIntelLore.value, loreEntry];
  }
  if (storeSnapshot.value && Array.isArray(storeSnapshot.value.pending_lore)) {
    const arr = storeSnapshot.value.pending_lore as unknown[];
    if (!arr.some(x => x && typeof x === 'object' && (x as { id?: string }).id === loreEntry.id)) {
      arr.push(loreEntry);
    }
  }
  syncStoreField('pending_lore', [...rawPendingLore.value, loreEntry]);
  emit('archive-intel-lore', item, loreEntry);
  return loreEntry;
}

const factionsList = computed<readonly Faction[]>(() => {
  if (props.factions !== undefined) {
    return props.factions;
  }
  return storeSnapshot.value?.factions ?? [];
});

const CODEX_FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: '人员', label: '人物/随行' },
  { id: 'other', label: '图鉴/其他' },
] as const;

const codexFilter = ref<'all' | '人员' | 'other'>('all');
const expandedCodexName = ref<string | null>(null);

function isPersonKind(kind?: string): boolean {
  return kind === '人物' || kind === '人员';
}

const codexList = computed<readonly CodexEntry[]>(() => {
  if (Array.isArray(props.codex)) return props.codex;
  const raw = storeSnapshot.value?.codex;
  return Array.isArray(raw) ? raw : [];
});

const filteredCodexList = computed<readonly CodexEntry[]>(() => {
  if (codexFilter.value === 'all') return codexList.value;
  if (codexFilter.value === '人员') return codexList.value.filter(c => isPersonKind(c.kind));
  return codexList.value.filter(c => !isPersonKind(c.kind));
});

function codexCountFor(catId: 'all' | '人员' | 'other'): number {
  if (catId === 'all') return codexList.value.length;
  if (catId === '人员') return codexList.value.filter(c => isPersonKind(c.kind)).length;
  return codexList.value.filter(c => !isPersonKind(c.kind)).length;
}

function toggleCodexExpand(name: string) {
  expandedCodexName.value = expandedCodexName.value === name ? null : name;
}

function codexKindBadgeClass(kind?: string): string {
  if (kind === '人物') {
    return 'border border-(--amber,#d2ad69)/40 bg-(--amber,#d2ad69)/20 text-(--amber,#d2ad69)';
  }
  if (kind === '人员') {
    return 'bg-(--ice,#8bc3e7)/20 text-(--ice,#8bc3e7)';
  }
  return 'bg-white/10 text-(--text-2,#8fa3b1)';
}

function codexCallsign(entry: CodexEntry): string {
  return (
    entry.params?.['代号'] ||
    entry.params?.['头衔'] ||
    entry.params?.['称号'] ||
    ''
  ).trim();
}

function codexRole(entry: CodexEntry): string {
  return (
    entry.params?.['身份'] ||
    entry.params?.['职务'] ||
    entry.params?.['开局职务'] ||
    entry.params?.['席位任命'] ||
    ''
  ).trim();
}

function codexFaction(entry: CodexEntry): string {
  return (
    entry.params?.['所属势力'] ||
    entry.params?.['势力'] ||
    entry.params?.['所属阵营'] ||
    entry.params?.['阵营'] ||
    ''
  ).trim();
}

function codexAttitude(entry: CodexEntry): string {
  return (
    entry.params?.['态度'] ||
    entry.params?.['立场'] ||
    entry.params?.['关系'] ||
    ''
  ).trim();
}

function codexStatus(entry: CodexEntry): string {
  return (
    entry.params?.['状态'] ||
    entry.params?.['当前状态'] ||
    entry.params?.['驻地'] ||
    entry.params?.['所在地'] ||
    ''
  ).trim();
}

function codexTrustPercent(entry: CodexEntry): number | null {
  const raw = entry.params?.['信任度'] ?? entry.params?.['好感'] ?? entry.params?.['好感度'];
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const matched = String(raw).match(/-?\d+(?:\.\d+)?/);
  if (!matched) return null;
  const num = Number(matched[0]);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function trustBarClass(pct: number): string {
  if (pct >= 70) return 'bg-(--safe,#78b69b)';
  if (pct >= 40) return 'bg-(--ice,#8bc3e7)';
  if (pct >= 25) return 'bg-(--amber,#d2ad69)';
  return 'bg-(--alert-bright,#ff5a36)';
}

function buildContactPersonCommand(name: string): string {
  return `联络并约谈【${name}】，就当前战区局势交换意见。`;
}

function fillContactCommandToHostTextarea(commandText: string): boolean {
  let filled = false;
  try {
    const parentDoc = typeof window !== 'undefined' ? window.parent?.document : undefined;
    const selfDoc = typeof document !== 'undefined' ? document : undefined;
    const frameDoc =
      typeof window !== 'undefined'
        ? (window.frameElement as HTMLElement | null | undefined)?.ownerDocument
        : undefined;
    const candidates = [
      parentDoc?.querySelector?.('#send_textarea'),
      selfDoc?.querySelector?.('#send_textarea'),
      frameDoc?.querySelector?.('#send_textarea'),
    ].filter((el, idx, arr): el is HTMLTextAreaElement => Boolean(el) && arr.indexOf(el) === idx);

    for (const textarea of candidates) {
      textarea.value = commandText;
      if (typeof Event !== 'undefined' && typeof textarea.dispatchEvent === 'function') {
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
      textarea.focus?.();
      filled = true;
    }
  } catch {
    // 忽略跨域或非浏览器异常
  }

  if (!filled) {
    try {
      filled = fillHostSendInput(commandText) !== 'failed';
    } catch {
      filled = false;
    }
  }
  return filled;
}

function onContactPerson(name: string): string {
  const commandText = buildContactPersonCommand(name);
  fillContactCommandToHostTextarea(commandText);
  contactedPersonName.value = name;
  if (contactFeedbackTimer !== null) {
    clearTimeout(contactFeedbackTimer);
  }
  contactFeedbackTimer = setTimeout(() => {
    if (contactedPersonName.value === name) {
      contactedPersonName.value = null;
    }
    contactFeedbackTimer = null;
  }, 2000);
  emit('contact-person', name, commandText);
  return commandText;
}

const rawPendingLore = computed<readonly unknown[]>(() => {
  if (props.pendingLore !== undefined) {
    return props.pendingLore;
  }
  return storeSnapshot.value?.pending_lore ?? [];
});

/** 宽容归一化 pending_lore 条目（跳过机娘初诞档案 GirlDossier，仅陈列待确认新势力/实体，合并本组件内沉淀的情报） */
const normalizedPendingLore = computed<NormalizedPendingLoreItem[]>(() => {
  const out: NormalizedPendingLoreItem[] = [];
  rawPendingLore.value.forEach((raw, idx) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    if (isGirlDossierEntry(raw)) return;
    const rec = raw as Record<string, unknown>;
    const name = typeof rec.name === 'string' ? rec.name.trim() : '';
    if (!name) return;

    const id = typeof rec.id === 'string' && rec.id.trim() !== '' ? rec.id.trim() : `lore_${name}_${idx}`;
    const kind =
      typeof rec.kind === 'string' && rec.kind.trim() !== ''
        ? rec.kind.trim()
        : typeof rec.model === 'string' && rec.model.trim() !== ''
          ? '角色'
          : '其他';
    const summary =
      (typeof rec.summary === 'string' && rec.summary) ||
      (typeof rec.desc === 'string' && rec.desc) ||
      (typeof rec.intel === 'string' && rec.intel) ||
      (typeof rec.model === 'string' && rec.model) ||
      '待确认录入世界书的新探明实体';
    const sourceFloor = typeof rec.source_floor === 'number' ? rec.source_floor : undefined;

    out.push({
      id,
      name,
      kind,
      summary,
      sourceFloor,
      raw,
    });
  });

  for (const staged of stagedFromIntelLore.value) {
    if (!out.some(item => item.id === staged.id || item.name === staged.name)) {
      out.push(staged);
    }
  }
  return out;
});

const visiblePendingLore = normalizedPendingLore;

function onAdoptLoreItem(item: NormalizedPendingLoreItem) {
  props.onAdoptLore?.(item);
  emit('adopt-lore', item);
}

function onSaveMemo() {
  memoSavedNotice.value = true;
  emit('update:memo', memoDraft.value);
  emit('save-memo', memoDraft.value);
}

function attitudePercent(attitude: Faction['attitude'] | string): number {
  switch (attitude) {
    case '敌意':
    case '敌对':
      return 15;
    case '警觉':
      return 35;
    case '未接触':
      return 50;
    case '中立':
      return 60;
    case '合作':
      return 75;
    case '友善':
      return 85;
    case '效忠':
      return 95;
    default:
      return 50;
  }
}

function attitudeBadgeClass(attitude: Faction['attitude'] | string): string {
  switch (attitude) {
    case '敌意':
    case '敌对':
      return 'bg-(--alert-bright,#ff5a36)/25 text-(--alert-bright,#ff5a36)';
    case '警觉':
      return 'bg-(--amber,#d2ad69)/25 text-(--amber,#d2ad69)';
    case '友善':
    case '合作':
    case '效忠':
      return 'bg-(--safe,#78b69b)/25 text-(--safe,#78b69b)';
    case '中立':
      return 'bg-(--ice,#8bc3e7)/20 text-(--ice,#8bc3e7)';
    case '未接触':
    default:
      return 'bg-white/10 text-(--text-3,#7a8e9a)';
  }
}

function attitudeBarClass(attitude: Faction['attitude'] | string): string {
  switch (attitude) {
    case '敌意':
    case '敌对':
      return 'bg-(--alert-bright,#ff5a36)';
    case '警觉':
      return 'bg-(--amber,#d2ad69)';
    case '友善':
    case '合作':
    case '效忠':
      return 'bg-(--safe,#78b69b)';
    case '中立':
      return 'bg-(--ice,#8bc3e7)';
    case '未接触':
    default:
      return 'bg-white/30';
  }
}

defineExpose({
  factionsList,
  visiblePendingLore,
  intelList,
  filteredIntelList,
  worldEvolutionsList,
  activeWorldEvoCount,
  intelFilter,
  actedIntelKey,
  pinnedOverrides,
  archivedIntelKeys,
  codexList,
  filteredCodexList,
  codexFilter,
  expandedCodexName,
  contactedPersonName,
  memoDraft,
  isIntelPinned,
  onActIntel,
  onTogglePinIntel,
  onArchiveIntelToWorldbook,
  toggleCodexExpand,
  onContactPerson,
  onAdoptLoreItem,
  onSaveMemo,
});
</script>

<style scoped>
.pda-tab-intel {
  box-sizing: border-box;
}
</style>
