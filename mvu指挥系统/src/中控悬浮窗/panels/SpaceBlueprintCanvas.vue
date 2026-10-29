<template>
  <div
    class="sbc-root flex flex-col gap-2.5"
    data-test="space-blueprint-canvas"
    :data-domain="domain"
    :data-selected-base="selectedBaseName || ''"
  >
    <!-- ══ 1. 顶部：天基总成实时平衡账本与羁绊横幅 ══ -->
    <section
      class="sbc-ledger rounded-[3px] border p-2.5"
      data-test="space-canvas-ledger"
      aria-label="天基总成实时平衡账本与组网羁绊"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span
            class="sbc-metric-pill"
            :class="{ 'sbc-metric-pill--danger': ledgerView.powerDeficit }"
            data-test="ledger-power-pill"
          >
            ⚡ 电力收支 (+{{ ledgerView.powerGenKw }} / -{{ ledgerView.powerLoadKw }} =
            <b>{{ formatSigned(ledgerView.netPowerKw) }} kW</b>)
            <strong v-if="ledgerView.powerDeficit" class="sbc-alert-tag sbc-alert-tag--danger">⚠️ 电网赤字</strong>
          </span>

          <span
            class="sbc-metric-pill"
            :class="{ 'sbc-metric-pill--warn': ledgerView.lifeDeficit }"
            data-test="ledger-life-pill"
          >
            🫧 维生热控 (+{{ ledgerView.lifeGen }} / -{{ ledgerView.lifeLoad }} =
            <b>{{ formatSigned(ledgerView.netLife) }}</b>)
            <strong v-if="ledgerView.lifeDeficit" class="sbc-alert-tag sbc-alert-tag--warn">⚠️ 热控/维生赤字</strong>
          </span>

          <span class="sbc-metric-pill" data-test="ledger-budget-pill">
            💰 蓝图总预算 (<b>${{ ledgerView.totalCredits }}</b> · 纳米 <b>{{ ledgerView.totalNanites }}</b> · 总重
            <b>{{ ledgerView.totalMassTons.toFixed(1) }}t</b>)
          </span>

          <span class="sbc-metric-pill" data-test="ledger-progress-pill">
            🧩 节点进度 (已规划 <b>{{ ledgerView.plannedCount }}</b> / 已解锁 <b>{{ ledgerView.unlockedCount }}</b> 槽 ·
            外延生长 <b>{{ ledgerView.expandedCount }}</b> 槽)
          </span>
        </div>

        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="sbc-btn sbc-btn--ghost font-mono text-[11px]"
            data-test="btn-reset-canvas-draft"
            @click="handleResetDraft"
          >
            🔄 重置蓝图草稿
          </button>
          <button
            type="button"
            class="sbc-btn sbc-btn--primary font-mono text-[11px]"
            data-test="btn-commit-canvas-blueprint"
            @click="handleCommitBlueprint"
          >
            📋 锁定总体建造蓝图
          </button>
        </div>
      </div>

      <!-- 星座组网羁绊芯片栏 -->
      <div
        v-if="domain === 'constellation' || synergyChipList.length > 0"
        class="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-700/60 pt-2"
        data-test="space-canvas-synergies"
      >
        <span class="font-mono text-[10px] text-slate-400">🔗 组网羁绊：</span>
        <div
          v-for="syn in synergyChipList"
          :key="syn.id"
          class="sbc-synergy-chip font-mono text-[10px]"
          :class="{ 'sbc-synergy-chip--active': syn.active }"
          :data-test="`synergy-chip-${syn.id}`"
          :data-synergy-active="syn.active ? 'true' : 'false'"
          :title="`${syn.requirementText} · ${syn.bonusSummary}`"
        >
          <span>{{ syn.active ? '✦' : '◇' }} {{ syn.name }}</span>
          <span class="sbc-synergy-sub">{{ syn.active ? syn.bonusSummary : syn.requirementText }}</span>
        </div>
      </div>
    </section>

    <!-- ══ 2 & 3. 主工作区：左侧/中部 SVG 蓝图视口 + 右侧插槽选配抽屉（一屏双栏并排） ══ -->
    <div class="sbc-workspace" :class="{ 'sbc-workspace--single': hideInspector }">
      <!-- 2. 左栏主视区：顶部控制栏 + 节点快捷定位条 + 可拖拽缩放 SVG 视口 + 底部独立图例栏 -->
      <div
        class="sbc-viewport relative flex min-h-0 flex-col overflow-hidden rounded-[3px] border"
        data-test="space-canvas-viewport"
      >
        <!-- 顶部独立控制栏（彻底杜绝与上方拓扑节点重叠） -->
        <div
          class="sbc-viewport-header flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 bg-slate-950/90 px-3 py-1.5 font-mono text-[11px]"
          data-canvas-no-drag="true"
        >
          <div class="sbc-domain-tag flex flex-wrap items-center gap-2">
            <span class="font-bold text-sky-300">{{ domainTitle }}</span>
            <span class="text-[10px] text-slate-400">按住拖拽平移 · 滚轮无级缩放 · 点击节点或下方插槽条选配</span>
          </div>

          <div
            class="sbc-hud-toolbar flex items-center gap-1 rounded-[3px] px-1 py-0.5 font-mono text-[10px]"
            data-canvas-no-drag="true"
          >
            <button
              type="button"
              class="sbc-hud-btn"
              data-test="canvas-zoom-in"
              title="放大蓝图视口"
              @click="zoomIn()"
            >
              ➕ 放大
            </button>
            <button
              type="button"
              class="sbc-hud-btn"
              data-test="canvas-zoom-out"
              title="缩小蓝图视口"
              @click="zoomOut()"
            >
              ➖ 缩小
            </button>
            <button
              type="button"
              class="sbc-hud-btn"
              data-test="canvas-zoom-reset"
              title="1:1 复位视口"
              @click="resetView()"
            >
              1:1 复位
            </button>
            <button
              type="button"
              class="sbc-hud-btn"
              data-test="canvas-focus-core"
              title="聚焦中央核心槽"
              @click="handleFocusCore()"
            >
              🎯 聚焦核心
            </button>
            <span class="sbc-hud-zoom px-1 text-sky-300" data-test="canvas-zoom-percent">{{ zoomPercent }}%</span>
          </div>
        </div>

        <!-- 节点快捷定位胶囊条（一眼总览全部插槽状态，点击直接定位） -->
        <div
          class="sbc-slot-strip flex items-center gap-1 overflow-x-auto border-b border-slate-800/70 bg-slate-950/65 px-2.5 py-1 font-mono text-[10px]"
          data-canvas-no-drag="true"
        >
          <span class="flex-none text-slate-400">插槽速跳：</span>
          <button
            v-for="node in visibleNodes"
            :key="`pill-${node.slot.id}`"
            type="button"
            class="sbc-slot-pill flex-none"
            :class="{
              'sbc-slot-pill--selected': selectedSlotId === node.slot.id,
              'sbc-slot-pill--mounted': Boolean(resolveNodeAsset(node)),
            }"
            @click="selectSlotAndCenter(node)"
          >
            <span>{{ resolveNodeAsset(node) ? '🔵' : '⚪' }}</span>
            <span>{{ node.slot.label }}</span>
          </button>
        </div>

        <!-- SVG 蓝图主视口 -->
        <svg
          viewBox="0 0 800 460"
          class="sbc-svg block min-h-[420px] w-full flex-1 select-none"
          :class="{ 'sbc-svg--dragging': isDragging }"
          role="img"
          :aria-label="`${domainTitle}拓扑组装视图`"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
          @wheel="onWheel"
        >
          <defs>
            <pattern id="sbc-blueprint-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(56, 189, 248, 0.08)" stroke-width="0.8" />
              <path d="M 20 0 L 20 40 M 0 20 L 40 20" fill="none" stroke="rgba(56, 189, 248, 0.035)" stroke-width="0.5" />
            </pattern>
            <radialGradient id="sbc-earth-glow" cx="50%" cy="50%" r="55%">
              <stop offset="0%" stop-color="rgba(14, 165, 233, 0.28)" />
              <stop offset="65%" stop-color="rgba(14, 165, 233, 0.08)" />
              <stop offset="100%" stop-color="rgba(2, 6, 23, 0)" />
            </radialGradient>
          </defs>

          <!-- 背景工程网格 -->
          <rect x="0" y="0" width="800" height="460" fill="url(#sbc-blueprint-grid)" />

          <!-- 可平移缩放舞台 -->
          <g :transform="transformAttr" data-test="space-canvas-stage">
            <!-- (A) 空间站底图层 -->
            <g v-if="domain === 'station'" data-test="canvas-bg-station">
              <!-- 地球低轨弧线大气辉光 -->
              <path
                d="M -60 445 Q 400 345 860 445"
                fill="none"
                stroke="rgba(56, 189, 248, 0.32)"
                stroke-width="3"
              />
              <path
                d="M -60 455 Q 400 355 860 455"
                fill="none"
                stroke="rgba(14, 165, 233, 0.14)"
                stroke-width="14"
              />
              <!-- 空间站十字主承力桁架导轨 -->
              <line x1="120" y1="230" x2="680" y2="230" stroke="rgba(56, 189, 248, 0.2)" stroke-width="6" />
              <line x1="400" y1="55" x2="400" y2="395" stroke="rgba(56, 189, 248, 0.2)" stroke-width="6" />
              <!-- 外延深空生长导轨虚线 -->
              <rect
                x="145"
                y="75"
                width="510"
                height="310"
                rx="14"
                fill="none"
                stroke="rgba(148, 163, 184, 0.18)"
                stroke-dasharray="6 6"
              />
              <text x="670" y="425" fill="rgba(125, 211, 252, 0.45)" font-size="10" text-anchor="end">
                LEO 400KM ORBITAL TRUSS
              </text>
            </g>

            <!-- (B) 轨道星座底图层（文字置于右上象限弧线旁，彻底避开正北12点钟方向插槽） -->
            <g v-else-if="domain === 'constellation'" data-test="canvas-bg-constellation">
              <!-- 中央地球网格球体 -->
              <circle cx="400" cy="222" r="64" fill="url(#sbc-earth-glow)" stroke="rgba(56, 189, 248, 0.45)" stroke-width="1.5" />
              <ellipse cx="400" cy="222" rx="64" ry="22" fill="none" stroke="rgba(56, 189, 248, 0.22)" stroke-dasharray="3 3" />
              <ellipse cx="400" cy="222" rx="24" ry="64" fill="none" stroke="rgba(56, 189, 248, 0.22)" stroke-dasharray="3 3" />
              <text x="400" y="226" fill="rgba(186, 230, 253, 0.8)" font-size="10" text-anchor="middle">
                EARTH · 全球天基测控网
              </text>

              <!-- LEO 近地低轨环 -->
              <ellipse
                cx="400"
                cy="222"
                rx="125"
                ry="90"
                fill="none"
                :stroke="hasActiveSynergy ? 'rgba(56, 189, 248, 0.65)' : 'rgba(56, 189, 248, 0.3)'"
                :stroke-width="hasActiveSynergy ? 2.4 : 1.3"
                stroke-dasharray="5 4"
              />
              <text x="488" y="160" fill="rgba(56, 189, 248, 0.78)" font-size="8.5" text-anchor="start">
                LEO · 近地低轨环
              </text>

              <!-- SSO 太阳同步极轨环 -->
              <ellipse
                cx="400"
                cy="222"
                rx="215"
                ry="136"
                fill="none"
                :stroke="hasActiveSynergy ? 'rgba(192, 132, 252, 0.65)' : 'rgba(148, 163, 184, 0.32)'"
                :stroke-width="hasActiveSynergy ? 2.4 : 1.3"
                stroke-dasharray="7 4"
              />
              <text x="568" y="128" fill="rgba(192, 132, 252, 0.82)" font-size="8.5" text-anchor="start">
                SSO · 太阳同步极轨环
              </text>

              <!-- GEO 地球静止高轨环 -->
              <ellipse
                cx="400"
                cy="222"
                rx="290"
                ry="176"
                fill="none"
                :stroke="hasActiveSynergy ? 'rgba(251, 191, 36, 0.7)' : 'rgba(251, 191, 36, 0.32)'"
                :stroke-width="hasActiveSynergy ? 2.6 : 1.4"
              />
              <text x="615" y="88" fill="rgba(251, 191, 36, 0.85)" font-size="8.5" text-anchor="start">
                GEO · 地球静止高轨环
              </text>
            </g>

            <!-- (C) 地面/母港发射中心与航天城小巨构底图层 -->
            <g
              v-else-if="domain === 'launch_center'"
              data-test="canvas-bg-launch-center"
              data-bg-domain="launch_center"
            >
              <g data-test="canvas-bg-launch_center">
                <!-- 海岸/深谷地形等高线网格 -->
                <path
                  d="M 40 90 Q 220 55 400 72 T 760 95"
                  fill="none"
                  stroke="rgba(56, 189, 248, 0.16)"
                  stroke-width="1.2"
                  stroke-dasharray="8 5"
                />
                <path
                  d="M 30 385 Q 240 350 420 372 T 770 390"
                  fill="none"
                  stroke="rgba(56, 189, 248, 0.18)"
                  stroke-width="1.3"
                  stroke-dasharray="10 5"
                />
                <ellipse
                  cx="400"
                  cy="230"
                  rx="335"
                  ry="185"
                  fill="none"
                  stroke="rgba(148, 163, 184, 0.16)"
                  stroke-width="1.2"
                  stroke-dasharray="6 6"
                />

                <!-- 发射场高压喷水导流槽（Flame Deflector Trench） -->
                <rect
                  x="376"
                  y="24"
                  width="48"
                  height="242"
                  rx="6"
                  fill="rgba(15, 23, 42, 0.58)"
                  stroke="rgba(245, 158, 11, 0.35)"
                  stroke-width="1.4"
                  stroke-dasharray="5 3"
                />
                <line
                  x1="400"
                  y1="30"
                  x2="400"
                  y2="355"
                  stroke="rgba(251, 191, 36, 0.32)"
                  stroke-width="3"
                />

                <!-- 重型双轨转运铁道（Heavy Dual-Track Crawlerway） -->
                <line
                  x1="125"
                  y1="172"
                  x2="540"
                  y2="227"
                  stroke="rgba(56, 189, 248, 0.25)"
                  stroke-width="4"
                />
                <line
                  x1="256"
                  y1="230"
                  x2="256"
                  y2="125"
                  stroke="rgba(56, 189, 248, 0.32)"
                  stroke-width="3.5"
                />
                <line
                  x1="264"
                  y1="230"
                  x2="264"
                  y2="125"
                  stroke="rgba(56, 189, 248, 0.32)"
                  stroke-width="3.5"
                />
                <line
                  x1="260"
                  y1="122"
                  x2="540"
                  y2="122"
                  stroke="rgba(56, 189, 248, 0.28)"
                  stroke-width="3.5"
                />
                <line
                  x1="260"
                  y1="230"
                  x2="400"
                  y2="230"
                  stroke="rgba(56, 189, 248, 0.36)"
                  stroke-width="5"
                />

                <!-- 助推器垂直回收着陆靶标环（LZ-1 / ASDS） -->
                <circle
                  cx="540"
                  cy="125"
                  r="34"
                  fill="rgba(6, 78, 59, 0.2)"
                  stroke="rgba(52, 211, 153, 0.35)"
                  stroke-width="1.3"
                  stroke-dasharray="4 3"
                />

                <!-- 题头与底部工程铭牌装饰 -->
                <text
                  x="400"
                  y="18"
                  fill="rgba(125, 211, 252, 0.78)"
                  font-size="9.5"
                  font-weight="700"
                  letter-spacing="1.2"
                  text-anchor="middle"
                >
                  COSMODROME &amp; LAUNCH COMPLEX · 4→8→12 SLOTS
                </text>
                <text x="400" y="442" fill="rgba(148, 163, 184, 0.62)" font-size="9.5" text-anchor="middle">
                  地面/母港发射中心总成 · 重型双轨转运铁道与高压导流槽阵列
                </text>
              </g>
            </g>

            <!-- (D) 月球基地底图层 -->
            <g v-else data-test="canvas-bg-lunar">
              <!-- 沙克尔顿极地环形山等高线 -->
              <ellipse
                cx="400"
                cy="235"
                rx="325"
                ry="188"
                fill="none"
                stroke="rgba(148, 163, 184, 0.22)"
                stroke-width="1.5"
                stroke-dasharray="10 5"
              />
              <!-- 永昼峰脊线 -->
              <ellipse
                cx="400"
                cy="235"
                rx="215"
                ry="128"
                fill="rgba(15, 23, 42, 0.35)"
                stroke="rgba(251, 191, 36, 0.3)"
                stroke-width="1.8"
              />
              <!-- 永久阴影坑冷阱核心区 -->
              <circle
                cx="400"
                cy="235"
                r="82"
                fill="rgba(2, 6, 23, 0.55)"
                stroke="rgba(56, 189, 248, 0.28)"
                stroke-width="1.4"
                stroke-dasharray="4 4"
              />
              <text x="400" y="438" fill="rgba(148, 163, 184, 0.55)" font-size="10" text-anchor="middle">
                SHACKLETON CRATER · 沙克尔顿极地环形山与外环月海矿脉
              </text>
            </g>

            <!-- ══ 连接管线层（父子插槽廊道/桁架/数据链） ══ -->
            <g class="sbc-connections-layer" data-test="space-canvas-connections">
              <g v-for="conn in renderedConnections" :key="conn.key">
                <line
                  :x1="conn.x1"
                  :y1="conn.y1"
                  :x2="conn.x2"
                  :y2="conn.y2"
                  :stroke="conn.active ? 'rgba(56, 189, 248, 0.82)' : 'rgba(148, 163, 184, 0.3)'"
                  :stroke-width="conn.active ? 2.6 : 1.5"
                  :stroke-dasharray="conn.active ? undefined : '5 5'"
                />
                <circle
                  v-if="conn.active"
                  :cx="(conn.x1 + conn.x2) / 2"
                  :cy="(conn.y1 + conn.y2) / 2"
                  r="3"
                  fill="#38bdf8"
                />
              </g>
            </g>

            <!-- ══ 未展开的外延插槽半透明锚点提示（requiresExpansionHub && !visible） ══ -->
            <g class="sbc-hidden-hub-stubs">
              <g
                v-for="stub in hiddenExpansionNodes"
                :key="`stub-${stub.slot.id}`"
                :transform="`translate(${stub.slot.x}, ${stub.slot.y})`"
                :data-test="`canvas-locked-stub-${stub.slot.id}`"
                class="cursor-pointer opacity-55"
                @click.stop="selectSlot(stub.slot.id)"
              >
                <circle
                  r="18"
                  fill="rgba(15, 23, 42, 0.7)"
                  stroke="rgba(192, 132, 252, 0.55)"
                  stroke-width="1.2"
                  stroke-dasharray="3 3"
                />
                <text x="0" y="4" fill="#c084fc" font-size="9" text-anchor="middle">🔒 扩展口</text>
                <text x="0" y="29" fill="rgba(192, 132, 252, 0.8)" font-size="8.5" text-anchor="middle">
                  {{ stub.slot.label }}
                </text>
              </g>
            </g>

            <!-- ══ 可见节点插槽与构件图元层 ══ -->
            <g class="sbc-nodes-layer" data-test="space-canvas-nodes">
              <g
                v-for="node in visibleNodes"
                :key="node.slot.id"
                :transform="`translate(${node.slot.x}, ${node.slot.y})`"
                :data-test="`canvas-slot-${node.slot.id}`"
                :data-slot-state="node.state"
                :data-selected="selectedSlotId === node.slot.id ? 'true' : 'false'"
                data-canvas-no-drag="true"
                class="sbc-node-group cursor-pointer"
                @click.stop="selectSlot(node.slot.id)"
              >
                <!-- 选中高亮外环 -->
                <circle
                  v-if="selectedSlotId === node.slot.id"
                  r="33"
                  fill="none"
                  stroke="#38bdf8"
                  stroke-width="2"
                  stroke-dasharray="4 2"
                />

                <!-- 节点底盘框 -->
                <circle
                  r="26"
                  :fill="nodeFillColor(node)"
                  :stroke="nodeStrokeColor(node)"
                  :stroke-width="selectedSlotId === node.slot.id ? 2.4 : 1.8"
                  :stroke-dasharray="nodeStrokeDash(node)"
                />

                <!-- 挂载构件 SVG 矢量图元 -->
                <g v-if="resolveNodeAsset(node)" class="sbc-node-symbol">
                  <path
                    v-for="(d, idx) in getNodeSymbolDef(node).paths"
                    :key="`p-${idx}`"
                    :d="d"
                    fill="none"
                    :stroke="nodeSymbolColor(node)"
                    stroke-width="1.75"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                  <path
                    v-for="(ad, aIdx) in getNodeSymbolDef(node).accentPaths || []"
                    :key="`ap-${aIdx}`"
                    :d="ad"
                    fill="none"
                    :stroke="getNodeSymbolDef(node).accentColor || '#38bdf8'"
                    stroke-width="1.35"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </g>

                <!-- 未挂载构件时的插槽十字准星 -->
                <g v-else>
                  <line x1="-8" y1="0" x2="8" y2="0" :stroke="nodeStrokeColor(node)" stroke-width="1.3" />
                  <line x1="0" y1="-8" x2="0" y2="8" :stroke="nodeStrokeColor(node)" stroke-width="1.3" />
                  <circle r="3" fill="none" :stroke="nodeStrokeColor(node)" stroke-width="1.2" />
                </g>

                <!-- 右上角电力收支角标 -->
                <g v-if="resolveNodeAsset(node)" transform="translate(22, -24)">
                  <rect
                    x="-22"
                    y="-8"
                    width="44"
                    height="14"
                    rx="3"
                    fill="rgba(2, 6, 23, 0.9)"
                    :stroke="resolveNodeAsset(node)!.powerDeltaKw >= 0 ? 'rgba(52, 211, 153, 0.7)' : 'rgba(56, 189, 248, 0.65)'"
                    stroke-width="1"
                  />
                  <text
                    x="0"
                    y="2"
                    :fill="resolveNodeAsset(node)!.powerDeltaKw >= 0 ? '#34d399' : '#7dd3fc'"
                    font-size="8.5"
                    font-family="monospace"
                    text-anchor="middle"
                  >
                    ⚡{{ formatSigned(resolveNodeAsset(node)!.powerDeltaKw) }}kW
                  </text>
                </g>

                <!-- 槽位标签与当前构件名称 -->
                <text
                  x="0"
                  y="38"
                  fill="#e2e8f0"
                  font-size="9.5"
                  font-weight="600"
                  text-anchor="middle"
                >
                  {{ node.slot.label }}
                </text>
                <text
                  x="0"
                  y="50"
                  :fill="resolveNodeAsset(node) ? '#38bdf8' : '#94a3b8'"
                  font-size="8.5"
                  text-anchor="middle"
                >
                  {{ resolveNodeAsset(node)?.name ?? stateLabel(node.state) }}
                </text>
              </g>
            </g>
          </g>
        </svg>

        <!-- 底部独立图例与快捷状态栏（彻底告别遮挡左下角节点） -->
        <div
          class="sbc-viewport-footer"
          data-canvas-no-drag="true"
        >
          <div class="sbc-legend">
            <span>🟢 已建成实体</span>
            <span>🔵 蓝图构思(虚线)</span>
            <span>⚪ 空闲插槽</span>
            <span>🟣 挂载【扩展节点舱/管廊枢纽】可生长外延槽</span>
          </div>
          <span class="sbc-footer-tip">
            当前插槽：<b>{{ selectedNode?.slot.label || '-' }}</b> · 点击右侧构件卡可一键装载
          </span>
        </div>
      </div>

      <!-- 3. 右栏：插槽构件选配与节点行动工作台（固定在右侧并排，内部列表独立滚动） -->
      <aside
        v-if="!hideInspector"
        class="sbc-inspector"
        data-test="space-canvas-inspector"
        aria-label="插槽构件选配与节点行动抽屉"
      >
        <div v-if="selectedNode" class="sbc-inspector-inner">
          <!-- 选中插槽头部信息 + 左右快速切换插槽导航 -->
          <header class="sbc-inspector-header">
            <div class="sbc-inspector-title-row">
              <span class="sbc-inspector-title" data-test="inspector-slot-title">
                {{ selectedNode.slot.label }}
              </span>
              <span
                class="sbc-state-badge"
                :data-state="selectedNode.state"
                data-test="inspector-slot-state"
              >
                {{ stateLabel(selectedNode.state) }}
              </span>
            </div>

            <div class="sbc-inspector-meta-row">
              <span>接口：{{ interfaceLabel(selectedNode.slot.interfaceType) }}</span>
              <span>层级：Tier-{{ selectedNode.slot.tier }}</span>
              <span v-if="selectedNode.slot.lockedCore" class="sbc-core-tag">🔒 核心根模块</span>
            </div>

            <!-- 快捷插槽切换栏：不用在星图里找点，一键切换上一槽 / 下一槽 / 下一空闲槽 -->
            <div class="sbc-slot-nav">
              <button
                type="button"
                class="sbc-nav-btn"
                title="切换到上一个插槽"
                @click="stepSlot(-1)"
              >
                ◀ 上一插槽
              </button>
              <button
                type="button"
                class="sbc-nav-btn sbc-nav-btn--accent"
                title="直接跳转到下一个尚未选配的空闲插槽"
                @click="jumpToNextEmptySlot()"
              >
                ⚡ 下一空闲槽 ▶
              </button>
              <button
                type="button"
                class="sbc-nav-btn"
                title="切换到下一个插槽"
                @click="stepSlot(1)"
              >
                下一插槽 ▶
              </button>
            </div>

            <!-- 未解锁或前置引导提示 -->
            <div
              v-if="selectedNode.lockReason"
              class="sbc-lock-hint"
              data-test="inspector-lock-reason"
            >
              💡 {{ selectedNode.lockReason }}
            </div>
          </header>

          <!-- 当前已挂载构件卡片与单节点发射/卸下行动 -->
          <div
            v-if="selectedMountedAsset"
            class="sbc-mounted-box"
            data-test="inspector-mounted-asset"
          >
            <div class="sbc-mounted-head">
              <span class="sbc-mounted-name">
                当前挂载：{{ selectedMountedAsset.name }}
              </span>
              <span class="sbc-mounted-mass">{{ selectedMountedAsset.massTons }}t</span>
            </div>
            <p class="sbc-mounted-desc">{{ selectedMountedAsset.effectSummary }}</p>
            <div class="sbc-mounted-stats">
              <span>⚡ {{ formatSigned(selectedMountedAsset.powerDeltaKw) }}kW</span>
              <span>🫧 维生 {{ formatSigned(selectedMountedAsset.lifeSupportDelta) }}</span>
              <span>💰 ${{ selectedMountedAsset.costCredits }}</span>
              <span>🧬 纳米 {{ selectedMountedAsset.nanitesCost }}</span>
            </div>

            <div class="sbc-mounted-actions">
              <button
                type="button"
                class="sbc-btn sbc-btn--launch sbc-btn--flex"
                data-test="btn-launch-slot-node"
                @click="handleLaunchSelectedNode"
              >
                🚀 拟定该节点发射合同 / 下达建造令
              </button>
              <button
                v-if="!selectedNode.slot.lockedCore"
                type="button"
                class="sbc-btn sbc-btn--danger"
                data-test="btn-unmount-slot-node"
                @click="handleUnmountSelectedSlot"
              >
                🗑️ 卸下本槽构件
              </button>
            </div>
          </div>

          <!-- 可选配 SVG 构件资产列表（占满右栏剩余高度，独立顺滑滚动） -->
          <div class="sbc-asset-catalog">
            <div class="sbc-catalog-head">
              <span>📦 适配本插槽的构件库 ({{ selectedNodeAllowedAssets.length }})</span>
              <span class="sbc-catalog-sub">点击卡片即可装载</span>
            </div>

            <div
              v-if="selectedNodeAllowedAssets.length === 0"
              class="sbc-catalog-empty"
            >
              当前插槽暂无可替换构件
            </div>

            <div class="sbc-asset-scroll">
              <div
                v-for="asset in selectedNodeAllowedAssets"
                :key="asset.id"
                class="sbc-asset-card"
                :class="{ 'sbc-asset-card--active': selectedMountedAsset?.id === asset.id }"
                :data-test="`inspector-asset-card-${asset.id}`"
                @click="
                  !(Boolean(selectedNode.lockReason) && selectedNode.state === 'locked') &&
                  handleMountAsset(selectedNode.slot.id, asset.id)
                "
              >
                <div class="sbc-asset-card-inner">
                  <!-- 小型 SVG 图元预览 -->
                  <svg
                    viewBox="-24 -24 48 48"
                    class="sbc-mini-svg"
                  >
                    <path
                      v-for="(d, idx) in getAssetSymbolDef(asset).paths"
                      :key="`mp-${idx}`"
                      :d="d"
                      fill="none"
                      stroke="#38bdf8"
                      stroke-width="1.8"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                    <path
                      v-for="(ad, aIdx) in getAssetSymbolDef(asset).accentPaths || []"
                      :key="`map-${aIdx}`"
                      :d="ad"
                      fill="none"
                      :stroke="getAssetSymbolDef(asset).accentColor || '#c084fc'"
                      stroke-width="1.4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>

                  <div class="sbc-asset-card-body">
                    <div class="sbc-asset-title-row">
                      <span class="sbc-asset-name">{{ asset.name }}</span>
                      <span class="sbc-asset-cost">
                        ${{ asset.costCredits }} · 纳米{{ asset.nanitesCost }} · {{ asset.massTons }}t
                      </span>
                    </div>

                    <!-- 特殊战略属性徽标 -->
                    <div class="sbc-asset-badges">
                      <span
                        v-if="asset.isExpansionHub"
                        class="sbc-badge sbc-badge--hub"
                      >
                        🌟 扩展枢纽（可生长外延槽）
                      </span>
                      <span
                        v-if="isRoverBayAsset(asset)"
                        class="sbc-badge sbc-badge--rover"
                      >
                        🛞 探测车车库（可解锁外环矿脉）
                      </span>
                      <span class="sbc-asset-power">
                        ⚡{{ formatSigned(asset.powerDeltaKw) }}kW / 🫧{{ formatSigned(asset.lifeSupportDelta) }}
                      </span>
                    </div>

                    <p class="sbc-asset-desc">
                      {{ asset.effectSummary }}
                    </p>

                    <div class="sbc-asset-action-row">
                      <button
                        type="button"
                        class="sbc-btn sbc-btn--mount"
                        :data-test="`btn-mount-asset-${asset.id}`"
                        :disabled="Boolean(selectedNode.lockReason) && selectedNode.state === 'locked'"
                        @click.stop="handleMountAsset(selectedNode.slot.id, asset.id)"
                      >
                        {{ selectedMountedAsset?.id === asset.id ? '✓ 已装载于本槽' : '🔧 挂载至本槽蓝图' }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Schema } from '../../红警指挥系统/core/schema';
import type {
  SpaceCanvasDomainId,
  SpaceSlotInterfaceType,
  SpaceSlotNodeState,
  SpaceCanvasSlotDef,
  SpaceCanvasAssetDef,
  SpaceCanvasSynergyDef,
  SpaceCanvasNodeView,
  SpaceCanvasConnectionView,
  SpaceCanvasLedgerSummary,
  SpaceCanvasEvalResult,
  SpaceCanvasNodeActionPayload,
} from '../models/spaceCanvasModel';
import {
  getSpaceCanvasDomain,
  getSpaceCanvasSlots,
  getSpaceCanvasAssets,
  getReadonlySpaceCanvasAssetById,
  registerSpaceCanvasDomain,
  registerSpaceCanvasSlots,
  registerSpaceCanvasAssets,
  registerSpaceCanvasSynergies,
  deriveInitialCanvasDraft,
  evaluateSpaceCanvasView,
  buildSpaceCanvasBlueprintOrderText,
  buildSpaceCanvasNodeActionPayload,
} from '../models/spaceCanvasModel';
import type { SpaceSvgSymbolDef } from './spaceCanvasSvgSymbols';
import { getSvgSymbolDef } from './spaceCanvasSvgSymbols';
import { useSvgPanZoomCanvas } from './useSvgPanZoomCanvas';

export type StatSnapshot = Schema;

const props = withDefaults(
  defineProps<{
    domain: SpaceCanvasDomainId;
    snapshot?: StatSnapshot | null;
    selectedBaseName?: string;
    initialDraft?: Record<string, string>;
    hideInspector?: boolean;
  }>(),
  {
    snapshot: null,
    selectedBaseName: '主发射场',
    initialDraft: undefined,
    hideInspector: false,
  },
);

const emit = defineEmits<{
  (e: 'commit-blueprint', orderText: string, draftMap: Record<string, string>): void;
  (e: 'launch-node', payload: SpaceCanvasNodeActionPayload, node: SpaceCanvasNodeView): void;
  (e: 'update:draft', draftMap: Record<string, string>): void;
  (e: 'select-slot', slotId: string, node: SpaceCanvasNodeView | null): void;
}>();

const FALLBACK_LAUNCH_CENTER_SLOTS: SpaceCanvasSlotDef[] = [
  {
    id: 'lc_pad_1',
    domain: 'launch_center',
    label: '1# 标准常温发射工位',
    interfaceType: 'launch_pad_std',
    tier: 1,
    x: 400,
    y: 230,
    defaultAssetId: 'asset.lc.pad_std',
    lockedCore: true,
  },
  {
    id: 'lc_hif',
    domain: 'launch_center',
    label: '总装测试厂房槽',
    interfaceType: 'launch_assembly',
    tier: 1,
    x: 260,
    y: 230,
    parentSlotId: 'lc_pad_1',
  },
  {
    id: 'lc_prop_yard',
    domain: 'launch_center',
    label: '推进剂储罐与加注区',
    interfaceType: 'launch_propellant',
    tier: 1,
    x: 400,
    y: 340,
    parentSlotId: 'lc_pad_1',
  },
  {
    id: 'lc_telemetry_1',
    domain: 'launch_center',
    label: '近场遥测与气象站槽',
    interfaceType: 'launch_telemetry',
    tier: 1,
    x: 540,
    y: 230,
    parentSlotId: 'lc_pad_1',
  },
  {
    id: 'lc_pad_2',
    domain: 'launch_center',
    label: '2# 低温重型发射工位',
    interfaceType: 'launch_pad_heavy',
    tier: 2,
    x: 400,
    y: 115,
    parentSlotId: 'lc_hif',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_crawler_way',
    domain: 'launch_center',
    label: '重型转运与导流枢纽槽',
    interfaceType: 'launch_hub_heavy',
    tier: 2,
    x: 260,
    y: 125,
    parentSlotId: 'lc_hif',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_recovery_zone',
    domain: 'launch_center',
    label: '助推器回收区槽',
    interfaceType: 'launch_recovery',
    tier: 2,
    x: 540,
    y: 125,
    parentSlotId: 'lc_hif',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_weather_tower',
    domain: 'launch_center',
    label: '全天候防雷与深空测控槽',
    interfaceType: 'launch_weather',
    tier: 2,
    x: 540,
    y: 340,
    parentSlotId: 'lc_hif',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_pad_super',
    domain: 'launch_center',
    label: '3# 百米级捕获塔架槽',
    interfaceType: 'launch_pad_super',
    tier: 3,
    x: 400,
    y: 42,
    parentSlotId: 'lc_crawler_way',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_underground_fab',
    domain: 'launch_center',
    label: '地下洞库箭体旋压总厂',
    interfaceType: 'launch_mega_fab',
    tier: 3,
    x: 125,
    y: 175,
    parentSlotId: 'lc_crawler_way',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_sat_cleanroom',
    domain: 'launch_center',
    label: '洁净卫星与舱段脉动产线',
    interfaceType: 'launch_mega_payload_line',
    tier: 3,
    x: 675,
    y: 175,
    parentSlotId: 'lc_crawler_way',
    requiresExpansionHub: true,
  },
  {
    id: 'lc_cryo_plant',
    domain: 'launch_center',
    label: '深冷液氧甲烷原位化工厂',
    interfaceType: 'launch_mega_cryo',
    tier: 3,
    x: 125,
    y: 315,
    parentSlotId: 'lc_crawler_way',
    requiresExpansionHub: true,
  },
];

const FALLBACK_LAUNCH_CENTER_ASSETS: SpaceCanvasAssetDef[] = [
  {
    id: 'asset.lc.pad_std',
    name: '简易常温起竖发射台架',
    domain: 'launch_center',
    allowedInterfaces: ['launch_pad_std'],
    costCredits: 1800,
    nanitesCost: 20,
    massTons: 45,
    workloadDays: 2,
    powerDeltaKw: -25,
    lifeSupportDelta: 0,
    effectSummary: '1# 标准常温发射工位，基准有效运力 8t，支持中型常温火箭起竖点火。',
    svgSymbolId: 'ln_landing_pad',
  },
  {
    id: 'asset.lc.hif_horizontal',
    name: '水平分段总装测试厂房',
    domain: 'launch_center',
    allowedInterfaces: ['launch_assembly'],
    costCredits: 1500,
    nanitesCost: 15,
    massTons: 38,
    workloadDays: 2,
    powerDeltaKw: -20,
    lifeSupportDelta: 10,
    effectSummary: '支持中型常温运载火箭水平对接测试与转运起竖。',
    svgSymbolId: 'st_hab',
  },
  {
    id: 'asset.lc.vab_vertical',
    name: '垂直总装测试厂房 (VAB)',
    domain: 'launch_center',
    allowedInterfaces: ['launch_assembly'],
    costCredits: 3600,
    nanitesCost: 60,
    massTons: 120,
    workloadDays: 4,
    powerDeltaKw: -55,
    lifeSupportDelta: 25,
    isExpansionHub: true,
    effectSummary: '战役级巨型垂直总装厂房，挂载后同图展开 Tier-2 中型发射中心 4 槽！',
    svgSymbolId: 'st_node_hub',
  },
  {
    id: 'asset.lc.prop_hypergolic',
    name: '常温四氧化二氮储罐区',
    domain: 'launch_center',
    allowedInterfaces: ['launch_propellant'],
    costCredits: 1200,
    nanitesCost: 10,
    massTons: 30,
    workloadDays: 1.5,
    powerDeltaKw: -15,
    lifeSupportDelta: 0,
    effectSummary: '提供常规常温推进剂快速加注保障。',
    svgSymbolId: 'st_fuel_depot',
  },
  {
    id: 'asset.lc.prop_kerolox',
    name: '高纯液氧煤油加注站',
    domain: 'launch_center',
    allowedInterfaces: ['launch_propellant'],
    costCredits: 2200,
    nanitesCost: 25,
    massTons: 55,
    workloadDays: 2.5,
    powerDeltaKw: -30,
    lifeSupportDelta: 0,
    effectSummary: '高密度过冷液氧煤油加注系统，提升起飞推力与装药效率。',
    svgSymbolId: 'st_fuel_depot',
  },
  {
    id: 'asset.lc.telemetry_mobile',
    name: '车载机动遥测方舱',
    domain: 'launch_center',
    allowedInterfaces: ['launch_telemetry'],
    costCredits: 1100,
    nanitesCost: 10,
    massTons: 18,
    workloadDays: 1.5,
    powerDeltaKw: -15,
    lifeSupportDelta: 5,
    effectSummary: '提供主动段光学与无线电遥测跟踪及近场风切变监测。',
    svgSymbolId: 'sat_comm_relay',
  },
  {
    id: 'asset.lc.pad_cryo',
    name: '低温重型脐带发射塔架',
    domain: 'launch_center',
    allowedInterfaces: ['launch_pad_heavy'],
    costCredits: 4200,
    nanitesCost: 75,
    massTons: 160,
    workloadDays: 4,
    powerDeltaKw: -65,
    lifeSupportDelta: 0,
    effectSummary: '2# 低温重型工位，解锁重型低温火箭 (22t) 与能源号重型火箭 (35t)。',
    svgSymbolId: 'st_heavy_truss',
  },
  {
    id: 'asset.lc.crawler_std',
    name: '双轨履带转运车与高压导流槽',
    domain: 'launch_center',
    allowedInterfaces: ['launch_hub_heavy'],
    costCredits: 2800,
    nanitesCost: 45,
    massTons: 95,
    workloadDays: 3,
    powerDeltaKw: -35,
    lifeSupportDelta: 0,
    effectSummary: '支撑重型火箭垂直整体转运与点火声爆水幕降噪。',
    svgSymbolId: 'ln_rover_bay',
  },
  {
    id: 'asset.lc.crawler_super_hub',
    name: '超重型双轨转运与航天城流水线基座',
    domain: 'launch_center',
    allowedInterfaces: ['launch_hub_heavy'],
    costCredits: 5200,
    nanitesCost: 110,
    massTons: 210,
    workloadDays: 5,
    powerDeltaKw: -80,
    lifeSupportDelta: 20,
    isExpansionHub: true,
    effectSummary: '核心扩建枢纽：挂载后同图展开 Tier-3 国家航天城小巨构 4 个外延槽！',
    svgSymbolId: 'ln_tunnel_hub',
  },
  {
    id: 'asset.lc.lz_pad',
    name: '陆上垂直回收着陆坪 (LZ-1)',
    domain: 'launch_center',
    allowedInterfaces: ['launch_recovery'],
    costCredits: 2600,
    nanitesCost: 40,
    massTons: 70,
    workloadDays: 2.5,
    powerDeltaKw: -20,
    lifeSupportDelta: 0,
    effectSummary: '精密雷达引导着陆坪，解锁一级助推器 100% 自动回收与库存复用。',
    svgSymbolId: 'ln_landing_pad',
  },
  {
    id: 'asset.lc.asds_barge',
    name: '无人自主回收驳船船坞 (ASDS)',
    domain: 'launch_center',
    allowedInterfaces: ['launch_recovery'],
    costCredits: 3200,
    nanitesCost: 55,
    massTons: 110,
    workloadDays: 3,
    powerDeltaKw: -30,
    lifeSupportDelta: 0,
    effectSummary: '远洋动态定位无人回收船坞，无需返航燃料即可回收重型芯一级。',
    svgSymbolId: 'st_orbital_dock',
  },
  {
    id: 'asset.lc.weather_laser_tower',
    name: '全天候激光引雷与深空测控塔',
    domain: 'launch_center',
    allowedInterfaces: ['launch_weather'],
    costCredits: 3400,
    nanitesCost: 65,
    massTons: 65,
    workloadDays: 3.5,
    powerDeltaKw: -60,
    lifeSupportDelta: 10,
    effectSummary: '使本基地发射中心局部豁免雷暴/台风挂起，并提供 +250 TFLOPS 测控算力。',
    svgSymbolId: 'sat_early_warn',
  },
  {
    id: 'asset.lc.pad_mechazilla',
    name: '百米级超重型机械臂捕获塔架 (Mechazilla)',
    domain: 'launch_center',
    allowedInterfaces: ['launch_pad_super'],
    costCredits: 6800,
    nanitesCost: 160,
    massTons: 320,
    workloadDays: 6,
    powerDeltaKw: -120,
    lifeSupportDelta: 0,
    effectSummary: '3# 终极发射与空中筷子捕获工位，解锁超级重型两级全复用运载系统 (65t+)，发射成本 -30%。',
    svgSymbolId: 'ln_mass_driver',
  },
  {
    id: 'asset.lc.underground_fab',
    name: '地下洞库箭体旋压与发动机流水线总厂',
    domain: 'launch_center',
    allowedInterfaces: ['launch_mega_fab'],
    costCredits: 5500,
    nanitesCost: 120,
    massTons: 240,
    workloadDays: 5,
    powerDeltaKw: -95,
    lifeSupportDelta: 30,
    effectSummary: '双向映射火箭制造厂，开启助推器与重型运载火箭流水线量产，造箭工期 -35%、回款 +15%。',
    svgSymbolId: 'ln_fission_plant',
  },
  {
    id: 'asset.lc.sat_cleanroom',
    name: '十万级洁净卫星与空间站舱段脉动生产线',
    domain: 'launch_center',
    allowedInterfaces: ['launch_mega_payload_line'],
    costCredits: 5800,
    nanitesCost: 130,
    massTons: 190,
    workloadDays: 5,
    powerDeltaKw: -85,
    lifeSupportDelta: 35,
    effectSummary: '开启卫星簇与空间站模块化舱段流水线直产直发，造星与舱段制造工期 -35%。',
    svgSymbolId: 'st_lab',
  },
  {
    id: 'asset.lc.cryo_methalox_plant',
    name: '深冷液氧甲烷/液氢原位合成化工厂',
    domain: 'launch_center',
    allowedInterfaces: ['launch_mega_cryo'],
    costCredits: 4800,
    nanitesCost: 90,
    massTons: 175,
    workloadDays: 4.5,
    powerDeltaKw: 180,
    lifeSupportDelta: 15,
    effectSummary: '原位深冷液化推进剂直供 1#/2#/3# 发射塔并余热发电，本中心每次发射净回款 +20%。',
    svgSymbolId: 'ln_ice_electrolysis',
  },
];

function ensureLaunchCenterDomainRegistered(): void {
  if (getSpaceCanvasSlots('launch_center').length > 0) return;
  registerSpaceCanvasDomain({
    id: 'launch_center',
    title: '航天发射中心与航天城小巨构拓扑视图',
    subtitle: '4槽小型发射场 ➔ 8槽中型发射中心 ➔ 12槽国家航天城产装测发流水线',
    viewBoxWidth: 800,
    viewBoxHeight: 460,
    centerX: 400,
    centerY: 230,
  });
  registerSpaceCanvasSlots('launch_center', FALLBACK_LAUNCH_CENTER_SLOTS);
  registerSpaceCanvasAssets(FALLBACK_LAUNCH_CENTER_ASSETS);
  registerSpaceCanvasSynergies([
    {
      id: 'syn.lc.spaceport_city',
      domain: 'launch_center',
      name: '🏙️🚀 国家航天城 · 产装测发全链路流水线',
      description: '同时建成 VAB 垂直总装厂 + 地下洞库旋压总厂 + 洁净卫星舱段脉动线 + 深冷原位化工厂',
      bonusSummary: '激活独立产线 spaceport:<baseId> · 航天排产工期 -35% · 综合造发成本 -25%',
      ringTone: 'cyan',
      checkActive: (_assets, slotMap) =>
        Boolean(
          slotMap.lc_hif === 'asset.lc.vab_vertical' &&
            slotMap.lc_underground_fab &&
            slotMap.lc_sat_cleanroom &&
            slotMap.lc_cryo_plant,
        ),
    },
    {
      id: 'syn.lc.full_reuse_starbase',
      domain: 'launch_center',
      name: '♻️⚡ 两级完全复用 · 星舰极速周转阵列',
      description: '同时建成 3# 百米级捕获塔架 + 助推器回收区 + 深冷原位化工厂',
      bonusSummary: '全复用运载免消耗库存助推器 · 单次最大运力提升至 80t · 支持多合同并发点火',
      ringTone: 'emerald',
      checkActive: (_assets, slotMap) =>
        Boolean(slotMap.lc_pad_super && slotMap.lc_recovery_zone && slotMap.lc_cryo_plant),
    },
  ]);
}

ensureLaunchCenterDomainRegistered();

const {
  zoomPercent,
  isDragging,
  transformAttr,
  zoomIn,
  zoomOut,
  resetView,
  focusPoint,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
} = useSvgPanZoomCanvas();

function buildFreshDraft(domain: SpaceCanvasDomainId): Record<string, string> {
  if (domain === 'launch_center') {
    ensureLaunchCenterDomainRegistered();
  }
  const baseDraft = deriveInitialCanvasDraft(domain, props.snapshot ?? null) ?? {};
  if (domain === 'launch_center' && !baseDraft.lc_pad_1) {
    baseDraft.lc_pad_1 = 'asset.lc.pad_std';
  }
  if (props.initialDraft && Object.keys(props.initialDraft).length > 0) {
    return { ...baseDraft, ...props.initialDraft };
  }
  return { ...baseDraft };
}

const draftMap = ref<Record<string, string>>(buildFreshDraft(props.domain));
const selectedSlotId = ref<string>('');

function runEvaluateView(domain: SpaceCanvasDomainId, draft: Record<string, string>, snapshot: StatSnapshot | null) {
  if (domain === 'launch_center') {
    ensureLaunchCenterDomainRegistered();
  }
  const fn = evaluateSpaceCanvasView as unknown as (...args: unknown[]) => unknown;
  try {
    const res = fn(domain, draft, snapshot);
    if (res && typeof res === 'object' && 'nodes' in (res as Record<string, unknown>)) {
      return res as {
        nodes: SpaceCanvasNodeView[];
        connections: SpaceCanvasConnectionView[];
        ledger: SpaceCanvasLedgerSummary;
        synergies?: unknown[];
      };
    }
  } catch {
    // 尝试对象参数签名
  }
  const objRes = fn({ domain, draft, draftMap: draft, snapshot }) as {
    nodes: SpaceCanvasNodeView[];
    connections: SpaceCanvasConnectionView[];
    ledger: SpaceCanvasLedgerSummary;
    synergies?: unknown[];
  };
  return objRes;
}

const evalResult = computed(() => runEvaluateView(props.domain, draftMap.value, props.snapshot ?? null));

const allNodes = computed<SpaceCanvasNodeView[]>(() => evalResult.value?.nodes ?? []);

const visibleNodes = computed<SpaceCanvasNodeView[]>(() =>
  allNodes.value.filter(n => n.visible !== false),
);

const hiddenExpansionNodes = computed<SpaceCanvasNodeView[]>(() =>
  allNodes.value.filter(n => Boolean(n.slot.requiresExpansionHub) && n.visible === false),
);

function resolveDefaultSelectedSlotId(): string {
  const vis = visibleNodes.value;
  if (vis.length === 0) return '';
  const coreNode = vis.find(n => n.slot.lockedCore || n.slot.id.endsWith('core'));
  return (coreNode ?? vis[0]).slot.id;
}

selectedSlotId.value = resolveDefaultSelectedSlotId();

watch(
  () => props.domain,
  newDomain => {
    draftMap.value = buildFreshDraft(newDomain);
    resetView();
    selectedSlotId.value = resolveDefaultSelectedSlotId();
  },
);

watch(
  () => props.initialDraft,
  newInitial => {
    if (newInitial && Object.keys(newInitial).length > 0) {
      draftMap.value = {
        ...(deriveInitialCanvasDraft(props.domain, props.snapshot ?? null) ?? {}),
        ...newInitial,
      };
    }
  },
  { deep: true },
);

const domainDef = computed(() => getSpaceCanvasDomain(props.domain));
const domainTitle = computed(() => {
  const def = domainDef.value as { title?: string; name?: string } | undefined;
  if (def?.title) return def.title.replace(/\u753b\u5e03/g, '拓扑视图');
  if (def?.name) return def.name.replace(/\u753b\u5e03/g, '拓扑视图');
  if (props.domain === 'station') return '轨道空间站自由组装拓扑视图';
  if (props.domain === 'constellation') return '全球轨道星座组网拓扑视图';
  if (props.domain === 'lunar') return '月球沙克尔顿基地节点工程蓝图';
  if (props.domain === 'launch_center') return '航天发射中心与航天城小巨构拓扑视图';
  return `${props.domain} 天基工程拓扑视图`;
});

const selectedNode = computed<SpaceCanvasNodeView | null>(() => {
  const found = allNodes.value.find(n => n.slot.id === selectedSlotId.value);
  return found ?? visibleNodes.value[0] ?? allNodes.value[0] ?? null;
});

function computeNodeAssetRaw(node: SpaceCanvasNodeView | null | undefined): SpaceCanvasAssetDef | null {
  if (!node) return null;
  const raw = node as unknown as Record<string, unknown>;
  if (raw.asset && typeof raw.asset === 'object') return raw.asset as SpaceCanvasAssetDef;
  if (raw.mountedAsset && typeof raw.mountedAsset === 'object') return raw.mountedAsset as SpaceCanvasAssetDef;
  const slotId = node.slot?.id ?? node.slotId ?? node.id ?? '';
  const assetId =
    (typeof raw.assetId === 'string' && raw.assetId) ||
    (typeof raw.mountedAssetId === 'string' && raw.mountedAssetId) ||
    draftMap.value[slotId] ||
    (node.slot?.lockedCore ? node.slot.defaultAssetId : '');
  if (!assetId) return null;
  return (getReadonlySpaceCanvasAssetById(assetId) as SpaceCanvasAssetDef | undefined) ?? null;
}

const resolvedNodeAssetMap = computed<Map<string, SpaceCanvasAssetDef | null>>(() => {
  const map = new Map<string, SpaceCanvasAssetDef | null>();
  for (const node of allNodes.value) {
    const key = node.slotId || node.slot?.id || node.id;
    const asset = computeNodeAssetRaw(node);
    if (key) map.set(key, asset);
    if (node.slot?.id && node.slot.id !== key) map.set(node.slot.id, asset);
  }
  return map;
});

const resolvedNodeSymbolMap = computed<Map<string, SpaceSvgSymbolDef>>(() => {
  const map = new Map<string, SpaceSvgSymbolDef>();
  for (const node of allNodes.value) {
    const key = node.slotId || node.slot?.id || node.id;
    const asset = key ? (resolvedNodeAssetMap.value.get(key) ?? null) : computeNodeAssetRaw(node);
    const sym = getSvgSymbolDef(asset?.svgSymbolId, asset?.id);
    if (key) map.set(key, sym);
    if (node.slot?.id && node.slot.id !== key) map.set(node.slot.id, sym);
  }
  return map;
});

function resolveNodeAsset(node: SpaceCanvasNodeView | null | undefined): SpaceCanvasAssetDef | null {
  if (!node) return null;
  const key = node.slotId || node.slot?.id || node.id;
  if (key && resolvedNodeAssetMap.value.has(key)) {
    return resolvedNodeAssetMap.value.get(key) ?? null;
  }
  return computeNodeAssetRaw(node);
}

const selectedMountedAsset = computed<SpaceCanvasAssetDef | null>(() => resolveNodeAsset(selectedNode.value));

const selectedNodeAllowedAssets = computed<SpaceCanvasAssetDef[]>(() => {
  const node = selectedNode.value;
  if (!node) return [];
  if (Array.isArray(node.allowedAssets) && node.allowedAssets.length > 0) {
    return node.allowedAssets;
  }
  return getSpaceCanvasAssets(props.domain).filter(a =>
    a.allowedInterfaces.includes(node.slot.interfaceType),
  );
});

const ledgerView = computed(() => {
  const raw = (evalResult.value?.ledger ?? {}) as unknown as Record<string, unknown>;
  const num = (keys: string[], fallback = 0): number => {
    for (const k of keys) {
      if (typeof raw[k] === 'number' && Number.isFinite(raw[k] as number)) {
        return raw[k] as number;
      }
    }
    return fallback;
  };
  const bool = (keys: string[], fallback: boolean): boolean => {
    for (const k of keys) {
      if (typeof raw[k] === 'boolean') return raw[k] as boolean;
    }
    return fallback;
  };

  const powerGenKw = num(['totalPowerGenKw', 'powerGenKw', 'powerGenerationKw', 'powerPositiveKw', 'powerSupplyKw']);
  const powerLoadKw = Math.abs(
    num(['totalPowerLoadKw', 'powerLoadKw', 'powerConsumptionKw', 'powerNegativeKw', 'powerDemandKw']),
  );
  const netPowerKw = num(['netPowerKw', 'powerNetKw', 'powerBalanceKw'], powerGenKw - powerLoadKw);

  const lifeGen = num(['totalLifeGen', 'lifeGen', 'lifeSupportGen', 'lifeSupportGeneration', 'lifeSupportSupply', 'lifePositive']);
  const lifeLoad = Math.abs(
    num(['totalLifeLoad', 'lifeLoad', 'lifeSupportLoad', 'lifeSupportConsumption', 'lifeSupportDemand', 'lifeNegative']),
  );
  const netLife = num(['netLifeSupport', 'netLife', 'lifeSupportNet', 'lifeSupportBalance'], lifeGen - lifeLoad);

  const totalCredits = num(['totalCostCredits', 'totalCredits', 'costCredits']);
  const totalNanites = num(['totalNanites', 'totalNanitesCost', 'nanitesCost']);
  const totalMassTons = num(['totalMassTons', 'massTons']);

  const mountedCountFallback = visibleNodes.value.filter(n => Boolean(resolveNodeAsset(n))).length;
  const expandedCountFallback = visibleNodes.value.filter(n => n.slot.tier >= 2).length;

  const plannedCount = num(
    ['mountedCount', 'plannedCount', 'plannedSlotCount', 'mountedSlotCount', 'occupiedSlotCount'],
    mountedCountFallback,
  );
  const unlockedCount = num(
    ['unlockedSlotCount', 'unlockedCount', 'visibleSlotCount', 'availableSlotCount'],
    visibleNodes.value.length,
  );
  const expandedCount = num(
    ['tier2ExpandedCount', 'expandedCount', 'expandedSlotCount', 'expandedTier2Count', 'activeExpansionSlotCount'],
    expandedCountFallback,
  );

  return {
    powerGenKw,
    powerLoadKw,
    netPowerKw,
    powerDeficit:
      typeof raw.powerBalanced === 'boolean'
        ? !raw.powerBalanced || netPowerKw < 0
        : bool(['powerDeficit', 'isPowerDeficit', 'hasPowerDeficit'], netPowerKw < 0),
    lifeGen,
    lifeLoad,
    netLife,
    lifeDeficit:
      typeof raw.lifeBalanced === 'boolean'
        ? !raw.lifeBalanced || netLife < 0
        : bool(['lifeDeficit', 'isLifeSupportDeficit', 'hasLifeSupportDeficit'], netLife < 0),
    totalCredits,
    totalNanites,
    totalMassTons,
    plannedCount,
    unlockedCount,
    expandedCount,
  };
});

interface SynergyChipView {
  id: string;
  name: string;
  active: boolean;
  requirementText: string;
  bonusSummary: string;
}

const synergyChipList = computed<SynergyChipView[]>(() => {
  const ledger = evalResult.value?.ledger;
  if (ledger && Array.isArray(ledger.allSynergies) && ledger.allSynergies.length > 0) {
    const activeIds = new Set((ledger.activeSynergies ?? []).map(s => s.id));
    return ledger.allSynergies.map(syn => ({
      id: syn.id,
      name: syn.name,
      active: activeIds.has(syn.id),
      requirementText: syn.description,
      bonusSummary: syn.bonusSummary,
    }));
  }

  const rawEval = evalResult.value as unknown as Record<string, unknown>;
  const rawList =
    (Array.isArray(rawEval?.synergies) ? rawEval.synergies : null) ??
    (Array.isArray(rawEval?.synergyViews) ? rawEval.synergyViews : null) ??
    [];

  return rawList.map((item, idx) => {
    const obj = item as Record<string, unknown>;
    const def = (obj.synergy ?? obj.def ?? obj) as Partial<SpaceCanvasSynergyDef> & Record<string, unknown>;
    return {
      id: String(def.id ?? obj.id ?? `syn_${idx}`),
      name: String(def.name ?? obj.name ?? '天基组网羁绊'),
      active: Boolean(obj.active ?? obj.unlocked ?? obj.isActive ?? false),
      requirementText: String(def.description ?? def.requirementText ?? obj.requirementText ?? '凑齐对应轨道星座激活'),
      bonusSummary: String(def.bonusSummary ?? def.effectSummary ?? obj.bonusSummary ?? '组网战略加成已激活'),
    };
  });
});

const hasActiveSynergy = computed(() => synergyChipList.value.some(s => s.active));

const renderedConnections = computed(() => {
  const slotMap = new Map<string, SpaceCanvasSlotDef>();
  for (const s of getSpaceCanvasSlots(props.domain)) {
    slotMap.set(s.id, s);
  }
  for (const n of allNodes.value) {
    slotMap.set(n.slot.id, n.slot);
  }

  const rawConns = evalResult.value?.connections ?? [];
  return rawConns
    .map((conn, idx) => {
      const c = conn as unknown as Record<string, unknown>;
      const fromId = String(c.fromSlotId ?? c.parentSlotId ?? c.from ?? '');
      const toId = String(c.toSlotId ?? c.childSlotId ?? c.to ?? '');
      const fromSlot = slotMap.get(fromId);
      const toSlot = slotMap.get(toId);
      const x1 = typeof c.x1 === 'number' ? c.x1 : typeof c.fromX === 'number' ? c.fromX : (fromSlot?.x ?? 400);
      const y1 = typeof c.y1 === 'number' ? c.y1 : typeof c.fromY === 'number' ? c.fromY : (fromSlot?.y ?? 230);
      const x2 = typeof c.x2 === 'number' ? c.x2 : typeof c.toX === 'number' ? c.toX : (toSlot?.x ?? 400);
      const y2 = typeof c.y2 === 'number' ? c.y2 : typeof c.toY === 'number' ? c.toY : (toSlot?.y ?? 230);
      const visible = c.visible !== undefined ? Boolean(c.visible) : true;
      const active = Boolean(
        c.active ??
          c.energized ??
          (c.state === 'active' || c.state === 'built' || c.state === 'planned' || c.state === 'constructing'),
      );
      return {
        key: `${fromId}-${toId}-${idx}`,
        x1,
        y1,
        x2,
        y2,
        visible,
        active,
      };
    })
    .filter(c => c.visible);
});

function getAssetSymbolDef(asset: SpaceCanvasAssetDef | null | undefined): SpaceSvgSymbolDef {
  return getSvgSymbolDef(asset?.svgSymbolId, asset?.id);
}

function getNodeSymbolDef(node: SpaceCanvasNodeView): SpaceSvgSymbolDef {
  const key = node.slotId || node.slot?.id || node.id;
  const cached = key ? resolvedNodeSymbolMap.value.get(key) : undefined;
  if (cached) return cached;
  const asset = resolveNodeAsset(node);
  return getSvgSymbolDef(asset?.svgSymbolId, asset?.id);
}

function isRoverBayAsset(asset: SpaceCanvasAssetDef): boolean {
  const ext = asset.ext as Record<string, unknown> | undefined;
  return Boolean(
    asset.isRoverSurveyor ||
      asset.id.includes('rover_bay') ||
      asset.svgSymbolId?.includes('rover_bay') ||
      ext?.providesRoverSurvey ||
      ext?.unlocksRoverSurvey,
  );
}

function selectSlot(slotId: string): void {
  selectedSlotId.value = slotId;
  const node = allNodes.value.find(n => n.slot.id === slotId) ?? null;
  emit('select-slot', slotId, node);
}

function selectSlotAndCenter(node: SpaceCanvasNodeView): void {
  selectedSlotId.value = node.slot.id;
  emit('select-slot', node.slot.id, node);
}

function stepSlot(delta: number): void {
  const list = visibleNodes.value;
  if (list.length === 0) return;
  const idx = list.findIndex(n => n.slot.id === selectedNode.value?.slot.id);
  const nextIdx = idx < 0 ? 0 : (idx + delta + list.length) % list.length;
  selectedSlotId.value = list[nextIdx].slot.id;
}

function jumpToNextEmptySlot(): void {
  const list = visibleNodes.value;
  if (list.length === 0) return;
  const curIdx = list.findIndex(n => n.slot.id === selectedNode.value?.slot.id);
  for (let i = 1; i <= list.length; i += 1) {
    const candidate = list[(Math.max(0, curIdx) + i) % list.length];
    if (!resolveNodeAsset(candidate) && candidate.state !== 'locked') {
      selectedSlotId.value = candidate.slot.id;
      return;
    }
  }
  stepSlot(1);
}

function handleFocusCore(): void {
  const coreNode =
    visibleNodes.value.find(n => n.slot.lockedCore || n.slot.id.endsWith('core')) ?? visibleNodes.value[0];
  if (coreNode) {
    selectedSlotId.value = coreNode.slot.id;
    focusPoint(coreNode.slot.x, coreNode.slot.y, 1.35);
  } else {
    focusPoint(400, 230, 1.35);
  }
}

function handleMountAsset(slotId: string, assetId: string): void {
  const next = { ...draftMap.value, [slotId]: assetId };
  draftMap.value = next;
  selectedSlotId.value = slotId;
  emit('update:draft', { ...next });
}

function handleUnmountSelectedSlot(): void {
  const node = selectedNode.value;
  if (!node || node.slot.lockedCore) return;
  const next = { ...draftMap.value };
  delete next[node.slot.id];
  draftMap.value = next;
  emit('update:draft', { ...next });
}

function handleResetDraft(): void {
  const fresh = deriveInitialCanvasDraft(props.domain, props.snapshot ?? null) ?? {};
  draftMap.value = { ...fresh };
  resetView();
  emit('update:draft', { ...fresh });
}

function safeBuildBlueprintOrderText(): string {
  const baseName = props.selectedBaseName || '主发射场';
  const orderText = buildSpaceCanvasBlueprintOrderText(
    props.domain,
    draftMap.value,
    baseName,
    props.snapshot ?? null,
    evalResult.value as unknown as SpaceCanvasEvalResult,
  );
  if (typeof orderText === 'string' && orderText.trim()) {
    return orderText;
  }
  return `【天基蓝图规划令】定下「${domainTitle.value}」总体建造蓝图（已规划 ${ledgerView.value.plannedCount} 个节点，承建基地：${baseName}）`;
}

function handleCommitBlueprint(): void {
  const orderText = safeBuildBlueprintOrderText();
  emit('commit-blueprint', orderText, { ...draftMap.value });
}

function safeBuildNodeActionPayload(node: SpaceCanvasNodeView): SpaceCanvasNodeActionPayload {
  const baseName = props.selectedBaseName || '主发射场';
  const payload = buildSpaceCanvasNodeActionPayload(node, baseName);
  if (payload && typeof payload === 'object' && payload.orderText) {
    return payload;
  }
  const asset = resolveNodeAsset(node);
  const assetId = asset?.id ?? draftMap.value[node.slot.id] ?? '';
  const assetName = asset?.name ?? node.slot.label;
  return {
    domain: props.domain,
    slotId: node.slot.id,
    slotLabel: node.slot.label,
    assetId,
    assetName,
    baseName,
    orderText: `【天基节点建造与发射令】在「${domainTitle.value}」插槽「${node.slot.label}」发射并建造「${assetName}」（承建基地：${baseName}）`,
  };
}

function handleLaunchSelectedNode(): void {
  const node = selectedNode.value;
  if (!node) return;
  const payload = safeBuildNodeActionPayload(node);
  emit('launch-node', payload, node);
}

function formatSigned(val: number): string {
  const n = Number(val) || 0;
  return n > 0 ? `+${n}` : `${n}`;
}

function stateLabel(state: SpaceSlotNodeState | string): string {
  switch (state) {
    case 'completed':
    case 'built':
      return '已建成实体';
    case 'building':
    case 'constructing':
      return '在建施工中';
    case 'planned':
      return '蓝图构思态';
    case 'empty':
      return '空闲待选配';
    case 'locked':
      return '待解锁槽位';
    default:
      return String(state);
  }
}

function interfaceLabel(type: SpaceSlotInterfaceType): string {
  const map: Record<string, string> = {
    station_core: '空间站中央核心枢钮',
    station_hub_port: '轴向扩展节点口',
    station_pressurized: '加压舱段对接口',
    station_truss_power: '主桁架能源散热口',
    station_truss_payload: '主桁架任务载荷口',
    orbit_leo: 'LEO 近地低轨相位槽',
    orbit_sso: 'SSO 太阳同步极轨槽',
    orbit_geo: 'GEO 地球静止高轨槽',
    lunar_core: '坑底中央防辐射核心槽',
    lunar_hub_tunnel: '加压管廊延伸枢纽槽',
    lunar_pad: '月表起降与电磁物流坪',
    lunar_inner: '环形山内圈能源维生槽',
    lunar_rim_isru: '外环原位矿脉利用(ISRU)槽',
    launch_pad_std: '1# 标准常温发射工位',
    launch_assembly: '总装测试厂房槽',
    launch_propellant: '推进剂储罐与加注区',
    launch_telemetry: '近场遥测与气象站槽',
    launch_pad_heavy: '2# 低温重型发射工位',
    launch_hub_heavy: '重型转运与导流枢纽槽',
    launch_recovery: '助推器回收区槽',
    launch_weather: '全天候防雷与深空测控槽',
    launch_pad_super: '3# 百米级超重型捕获塔架槽',
    launch_mega_fab: '地下洞库箭体旋压制造槽',
    launch_mega_payload_line: '洁净卫星与舱段脉动产线槽',
    launch_mega_cryo: '深冷原位合成化工厂槽',
  };
  return map[type] ?? type;
}

function nodeFillColor(node: SpaceCanvasNodeView): string {
  switch (node.state as string) {
    case 'completed':
    case 'built':
      return 'rgba(6, 78, 59, 0.78)';
    case 'building':
    case 'constructing':
      return 'rgba(120, 53, 15, 0.75)';
    case 'planned':
      return 'rgba(12, 74, 110, 0.72)';
    case 'locked':
      return 'rgba(15, 23, 42, 0.55)';
    default:
      return 'rgba(15, 23, 42, 0.82)';
  }
}

function nodeStrokeColor(node: SpaceCanvasNodeView): string {
  switch (node.state as string) {
    case 'completed':
    case 'built':
      return '#34d399';
    case 'building':
    case 'constructing':
      return '#fbbf24';
    case 'planned':
      return '#38bdf8';
    case 'locked':
      return 'rgba(148, 163, 184, 0.35)';
    default:
      return 'rgba(148, 163, 184, 0.65)';
  }
}

function nodeStrokeDash(node: SpaceCanvasNodeView): string | undefined {
  if (node.state === 'planned') return '5 3';
  if (node.state === 'locked') return '3 3';
  return undefined;
}

function nodeSymbolColor(node: SpaceCanvasNodeView): string {
  const st = node.state as string;
  if (st === 'completed' || st === 'built') return '#6ee7b7';
  if (st === 'building' || st === 'constructing') return '#fde68a';
  return '#7dd3fc';
}
</script>

<style scoped>
.sbc-root {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 540px;
  color: #e2e8f0;
}
.sbc-ledger,
.sbc-viewport,
.sbc-inspector {
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.94) 0%, rgba(2, 6, 23, 0.96) 100%);
  border: 1px solid rgba(56, 189, 248, 0.25);
  border-radius: 3px;
}
.sbc-ledger {
  flex: none;
  padding: 8px 10px;
}
/* ══ 核心：左右两栏并排工作台（左侧主视口自适应撑满 + 右侧选配工作台固定 380px 并排同高） ══ */
.sbc-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 380px;
  gap: 10px;
  flex: 1 1 0%;
  min-height: 460px;
  align-items: stretch;
}
.sbc-workspace--single {
  grid-template-columns: minmax(0, 1fr);
}
@media (max-width: 960px) {
  .sbc-workspace {
    grid-template-columns: 1fr;
  }
}
.sbc-viewport {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.sbc-viewport-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid rgba(30, 41, 59, 0.85);
  background: rgba(2, 6, 23, 0.92);
  font-family: monospace;
  font-size: 11px;
}
.sbc-slot-strip {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  overflow-x: auto;
  border-bottom: 1px solid rgba(30, 41, 59, 0.75);
  background: rgba(9, 14, 26, 0.85);
  font-family: monospace;
  font-size: 10px;
  scrollbar-width: thin;
}
.sbc-slot-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
  padding: 2px 7px;
  border-radius: 2px;
  border: 1px solid rgba(148, 163, 184, 0.24);
  background: rgba(15, 23, 42, 0.8);
  color: #cbd5e1;
  font-family: monospace;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.sbc-slot-pill:hover {
  border-color: rgba(56, 189, 248, 0.55);
  color: #e0f2fe;
}
.sbc-slot-pill--mounted {
  border-color: rgba(56, 189, 248, 0.42);
  background: rgba(12, 74, 110, 0.28);
  color: #bae6fd;
}
.sbc-slot-pill--selected {
  border-color: #38bdf8;
  background: rgba(14, 116, 144, 0.48);
  color: #ffffff;
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.28);
}
.sbc-svg {
  display: block;
  width: 100%;
  flex: 1 1 0%;
  min-height: 380px;
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.sbc-svg--dragging {
  cursor: grabbing;
}
.sbc-viewport-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  border-top: 1px solid rgba(30, 41, 59, 0.85);
  background: rgba(2, 6, 23, 0.92);
  font-family: monospace;
  font-size: 10px;
}
.sbc-legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: #cbd5e1;
}
.sbc-footer-tip {
  color: #94a3b8;
}
.sbc-footer-tip b {
  color: #7dd3fc;
}
/* ══ 右栏：插槽构件选配与节点行动抽屉 ══ */
.sbc-inspector {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  padding: 10px;
  overflow: hidden;
}
.sbc-inspector-inner {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}
.sbc-inspector-header {
  flex: none;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(51, 65, 85, 0.7);
}
.sbc-inspector-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sbc-inspector-title {
  font-family: monospace;
  font-size: 13px;
  font-weight: 700;
  color: #7dd3fc;
}
.sbc-inspector-meta-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-family: monospace;
  font-size: 10px;
  color: #94a3b8;
}
.sbc-core-tag {
  color: #fcd34d;
}
.sbc-slot-nav {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 7px;
}
.sbc-nav-btn {
  flex: 1;
  padding: 3px 6px;
  border-radius: 2px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(30, 41, 59, 0.75);
  color: #cbd5e1;
  font-family: monospace;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.14s ease;
}
.sbc-nav-btn:hover {
  border-color: rgba(56, 189, 248, 0.65);
  color: #e0f2fe;
}
.sbc-nav-btn--accent {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(14, 116, 144, 0.35);
  color: #bae6fd;
  font-weight: 600;
}
.sbc-metric-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(30, 41, 59, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: #cbd5e1;
}
.sbc-metric-pill--danger {
  border-color: rgba(248, 113, 113, 0.65);
  background: rgba(127, 29, 29, 0.45);
  color: #fecaca;
}
.sbc-metric-pill--warn {
  border-color: rgba(251, 191, 36, 0.65);
  background: rgba(120, 53, 15, 0.45);
  color: #fde68a;
}
.sbc-alert-tag {
  margin-left: 4px;
  padding: 0 4px;
  border-radius: 2px;
  font-size: 10px;
}
.sbc-alert-tag--danger {
  background: rgba(239, 68, 68, 0.25);
  color: #fca5a5;
}
.sbc-alert-tag--warn {
  background: rgba(245, 158, 11, 0.25);
  color: #fcd34d;
}
.sbc-synergy-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 8px;
  border-radius: 3px;
  background: rgba(15, 23, 42, 0.75);
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #94a3b8;
}
.sbc-synergy-chip--active {
  border-color: rgba(56, 189, 248, 0.75);
  background: rgba(14, 116, 144, 0.32);
  color: #e0f2fe;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.22);
}
.sbc-synergy-sub {
  opacity: 0.82;
}
.sbc-hud-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  background: rgba(2, 6, 23, 0.86);
  border: 1px solid rgba(56, 189, 248, 0.28);
  border-radius: 3px;
  padding: 2px 4px;
  color: #cbd5e1;
}
.sbc-hud-btn {
  padding: 2px 6px;
  border-radius: 2px;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(148, 163, 184, 0.25);
  color: #e2e8f0;
  cursor: pointer;
}
.sbc-hud-btn:hover {
  border-color: rgba(56, 189, 248, 0.65);
  color: #38bdf8;
}
.sbc-btn {
  padding: 4px 9px;
  border-radius: 3px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  font-family: monospace;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.sbc-btn--flex {
  flex: 1;
}
.sbc-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.sbc-btn--primary {
  background: rgba(14, 116, 144, 0.55);
  border-color: rgba(56, 189, 248, 0.65);
  color: #e0f2fe;
}
.sbc-btn--primary:hover:not(:disabled) {
  background: rgba(14, 116, 144, 0.8);
}
.sbc-btn--ghost {
  background: rgba(30, 41, 59, 0.7);
  color: #cbd5e1;
}
.sbc-btn--launch {
  background: rgba(6, 95, 70, 0.6);
  border-color: rgba(52, 211, 153, 0.65);
  color: #d1fae5;
}
.sbc-btn--danger {
  background: rgba(127, 29, 29, 0.55);
  border-color: rgba(248, 113, 113, 0.55);
  color: #fecaca;
}
.sbc-btn--mount {
  background: rgba(30, 58, 138, 0.55);
  border-color: rgba(56, 189, 248, 0.5);
  color: #bae6fd;
  font-size: 10.5px;
}
.sbc-state-badge {
  padding: 1px 6px;
  border-radius: 2px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  background: rgba(30, 41, 59, 0.75);
  font-family: monospace;
  font-size: 10px;
}
.sbc-lock-hint {
  margin-top: 6px;
  padding: 6px 8px;
  border-radius: 2px;
  background: rgba(88, 28, 135, 0.28);
  border: 1px solid rgba(192, 132, 252, 0.45);
  color: #e9d5ff;
  font-family: monospace;
  font-size: 10.5px;
}
.sbc-mounted-box {
  flex: none;
  padding: 8px 10px;
  border-radius: 3px;
  border: 1px solid rgba(52, 211, 153, 0.4);
  background: rgba(6, 78, 59, 0.22);
}
.sbc-mounted-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.sbc-mounted-name {
  font-size: 12px;
  font-weight: 700;
  color: #6ee7b7;
}
.sbc-mounted-mass {
  font-family: monospace;
  font-size: 10px;
  color: #cbd5e1;
}
.sbc-mounted-desc {
  margin: 4px 0 0;
  font-size: 11px;
  line-height: 1.45;
  color: #cbd5e1;
}
.sbc-mounted-stats {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
  font-family: monospace;
  font-size: 10px;
  color: #cbd5e1;
}
.sbc-mounted-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 7px;
}
.sbc-asset-catalog {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 0%;
  min-height: 0;
}
.sbc-catalog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-family: monospace;
  font-size: 11px;
  font-weight: 600;
  color: #cbd5e1;
}
.sbc-catalog-sub {
  font-size: 10px;
  font-weight: 400;
  color: #7dd3fc;
}
.sbc-catalog-empty {
  padding: 12px;
  border: 1px dashed rgba(51, 65, 85, 0.8);
  border-radius: 2px;
  text-align: center;
  font-family: monospace;
  font-size: 11px;
  color: #94a3b8;
}
.sbc-asset-scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 0%;
  min-height: 180px;
  max-height: 440px;
  overflow-y: auto;
  padding-right: 3px;
}
.sbc-asset-card {
  padding: 8px;
  border-radius: 3px;
  background: rgba(15, 23, 42, 0.78);
  border: 1px solid rgba(148, 163, 184, 0.22);
  cursor: pointer;
  transition: border-color 0.14s ease, background 0.14s ease;
}
.sbc-asset-card:hover {
  border-color: rgba(56, 189, 248, 0.5);
  background: rgba(15, 23, 42, 0.95);
}
.sbc-asset-card--active {
  border-color: rgba(56, 189, 248, 0.75);
  background: rgba(12, 74, 110, 0.32);
  box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.25);
}
.sbc-asset-card-inner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.sbc-mini-svg {
  flex: none;
  width: 36px;
  height: 36px;
  padding: 3px;
  border-radius: 2px;
  border: 1px solid rgba(51, 65, 85, 0.85);
  background: rgba(2, 6, 23, 0.85);
}
.sbc-asset-card-body {
  flex: 1;
  min-width: 0;
}
.sbc-asset-title-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
}
.sbc-asset-name {
  font-size: 11.5px;
  font-weight: 700;
  color: #f1f5f9;
}
.sbc-asset-cost {
  font-family: monospace;
  font-size: 10px;
  color: #94a3b8;
}
.sbc-asset-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}
.sbc-asset-power {
  font-family: monospace;
  font-size: 10px;
  color: #7dd3fc;
}
.sbc-asset-desc {
  margin: 4px 0 0;
  font-size: 10.5px;
  line-height: 1.4;
  color: #cbd5e1;
}
.sbc-asset-action-row {
  display: flex;
  justify-content: flex-end;
  margin-top: 6px;
}
.sbc-badge {
  padding: 1px 5px;
  border-radius: 2px;
  font-family: monospace;
  font-size: 9.5px;
}
.sbc-badge--hub {
  background: rgba(107, 33, 168, 0.4);
  border: 1px solid rgba(192, 132, 252, 0.55);
  color: #f3e8ff;
}
.sbc-badge--rover {
  background: rgba(14, 116, 144, 0.4);
  border: 1px solid rgba(56, 189, 248, 0.55);
  color: #e0f2fe;
}
</style>
