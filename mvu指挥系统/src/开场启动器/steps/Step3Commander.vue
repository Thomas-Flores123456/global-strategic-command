<template>
  <div class="step3-commander">
    <!-- ══════════ 1. 主指挥官身份档案 ══════════ -->
    <section class="wiz-section compact-sec">
      <div class="wiz-sec-head">
        <div class="wiz-label">1. 主指挥官身份档案（战区最高统帅）</div>
        <span class="wiz-chip accent">
          {{
            choices.personaMode === 'skip'
              ? '沿用当前宿主身份'
              : choices.personaName.trim() || '待指定统帅名号'
          }}
        </span>
      </div>

      <div class="opt-grid persona-grid">
        <label class="opt-card persona-card" :class="{ sel: choices.personaMode === 'skip' }">
          <input v-model="choices.personaMode" type="radio" value="skip" class="sr-radio" />
          <div class="opt-title">
            <span>沿用当前身份</span>
            <span class="wiz-chip rec">零改动</span>
          </div>
          <div class="opt-flavor">保持当前已激活的身份档案，开局时不切换统帅身份。</div>
        </label>

        <label class="opt-card persona-card" :class="{ sel: choices.personaMode === 'existing' }">
          <input v-model="choices.personaMode" type="radio" value="existing" class="sr-radio" />
          <div class="opt-title">
            <span>选用既有档案</span>
            <span class="wiz-chip">{{ personaNames.length }} 份可选</span>
          </div>
          <div class="opt-flavor">从酒馆已保存的身份列表中择一切换为本局最高统帅。</div>
        </label>

        <label class="opt-card persona-card" :class="{ sel: choices.personaMode === 'create' }">
          <input v-model="choices.personaMode" type="radio" value="create" class="sr-radio" />
          <div class="opt-title">
            <span>新建统帅档案</span>
            <span class="wiz-chip accent">建档并就任</span>
          </div>
          <div class="opt-flavor">现场撰写新指挥官履历与行事风格，发射时自动创建并切换。</div>
        </label>
      </div>

      <div v-if="choices.personaMode !== 'skip' && !choices.personaName.trim()" class="persona-empty-hint">
        ⚠ 尚未指定统帅名号；若保持为空，开局时将自动沿用当前身份。
      </div>

      <div v-if="choices.personaMode === 'existing'" class="persona-sub-panel">
        <select v-model="choices.personaName" class="wiz-select">
          <option value="" disabled>—— 请选择统帅档案 ——</option>
          <option v-for="name in personaNames" :key="name" :value="name">{{ name }}</option>
        </select>
        <div v-if="choices.personaName" class="wiz-desc-preview persona-preview">
          {{ existingDescription || '（该统帅档案暂无履历描述）' }}
        </div>
      </div>

      <div v-if="choices.personaMode === 'create'" class="persona-create-inline">
        <label class="adj-field">
          <span class="field-label">新统帅代号 / 姓名</span>
          <input v-model="choices.personaName" class="wiz-input" type="text" placeholder="如：陆战指挥官 顾沉" />
        </label>
        <label class="adj-field">
          <span class="field-label">统帅履历与指挥风格</span>
          <textarea
            v-model="choices.personaDescription"
            class="wiz-textarea compact-textarea"
            placeholder="指挥官背景、军种出身、性格与下达命令的风格……"
          ></textarea>
        </label>
      </div>
    </section>

    <!-- ══════════ 2. 开场随行人类名册与人物档案 ══════════ -->
    <section class="wiz-section compact-sec" data-testid="human-roster-section">
      <div class="wiz-sec-head">
        <div class="wiz-label">2. 随行己方人类名册与人物档案</div>
        <span class="wiz-chip" :class="roster.length > 0 ? 'rec' : ''">
          已编入 {{ roster.length }} 名随行人员
        </span>
      </div>

      <!-- 天然在编核心 + 预设人物快捷征召栏 -->
      <div class="roster-bar-box">
        <div class="core-line">
          <span class="core-label">在编核心：</span>
          <span class="wiz-chip rec">🎖️ {{ choices.personaName.trim() || '最高统帅（本人）' }}</span>
          <span v-for="fid in selectedFactions" :key="fid" class="wiz-chip accent">
            🤖 {{ factionName(fid) }} MCV 机娘 · {{ starterMcv(fid)?.girlName ?? '机娘' }}
          </span>
        </div>

        <div class="recruit-bar">
          <span class="core-label">预设人物：</span>
          <button
            v-for="preset in HUMAN_COMPANION_PRESETS"
            :key="preset.id"
            type="button"
            class="wiz-pill"
            :class="{ active: isPresetInRoster(preset) }"
            :title="`${preset.name}「${preset.callsign}」· ${preset.bio}`"
            @click="toggleRecruitPreset(preset)"
          >
            {{ isPresetInRoster(preset) ? '✓ ' : '+ ' }}{{ preset.name }} · {{ preset.tag }}
          </button>
          <button type="button" class="wiz-pill custom-add-pill" @click="addCustomHuman()">
            ✚ 新建自定义人物
          </button>
        </div>
      </div>

      <!-- 0 人轻装态提示 -->
      <div v-if="roster.length === 0" class="roster-empty-box">
        <span>
          当前仅 <strong>最高统帅 + 首发 MCV 机娘</strong> 轻装开局。如需携带己方人类参谋、工程老将或同伴同行，请点击上方按钮招入预设人物或新建自定义人物，随后可在下方「3. 副官与参谋席位任命」中点将委任。
        </span>
      </div>

      <!-- Master-Detail：左随行名册列表 + 右人物档案工作台 -->
      <div v-else class="roster-master-detail">
        <!-- 左栏：已编入的随行人类列表 -->
        <div class="roster-master-list" role="listbox" aria-label="随行人类名册">
          <button
            v-for="(member, mIdx) in roster"
            :key="member.id"
            type="button"
            class="roster-chip-btn"
            :class="{ sel: activeMember?.id === member.id }"
            :aria-selected="activeMember?.id === member.id"
            @click="selectedMemberId = member.id"
          >
            <div class="rc-top">
              <span class="rc-name">
                👤 {{ member.name || `随行军官 #${mIdx + 1}` }}
                <small v-if="member.callsign" class="rc-callsign">「{{ member.callsign }}」</small>
              </span>
              <span class="mini-badge" :class="member.assignment ? 'warn' : 'rec'">
                {{ assignmentShortText(member.assignment) }}
              </span>
            </div>
            <div class="rc-sub">
              <span>{{ findHumanOrigin(member.origin).shortTag }}</span>
              <span>· {{ member.title || '战区随行人员' }}</span>
            </div>
          </button>

          <button type="button" class="roster-add-more-btn" @click="addCustomHuman()">
            + 继续添加随行人物
          </button>
        </div>

        <!-- 右栏：当前选中人物的立体档案卡 -->
        <div v-if="activeMember" class="roster-detail-dossier" data-testid="human-dossier-editor">
          <div class="dossier-top-bar">
            <div class="dossier-title-wrap">
              <strong class="dossier-main-name">📋 人物档案 · {{ activeMember.name || '未命名角色' }}</strong>
              <span v-if="activeMember.callsign" class="wiz-chip accent">「{{ activeMember.callsign }}」</span>
              <span class="wiz-chip">{{ findHumanOrigin(activeMember.origin).label }}</span>
            </div>
            <button
              type="button"
              class="rm-del-btn"
              title="从开场名册移除该人物"
              @click="removeHuman(activeMember.id)"
            >
              ✕ 移除此人
            </button>
          </div>

          <!-- 第一区：2x2 规整基础信息网格（单行标签不折行、下拉框不截断） -->
          <div class="dossier-grid-2x2">
            <label class="adj-field">
              <div class="field-head">
                <span class="field-label">姓名 / 本名</span>
                <span class="field-sub">必填</span>
              </div>
              <input
                v-model="activeMember.name"
                class="wiz-input"
                type="text"
                placeholder="如：顾清弦 / 瓦列里"
                @input="onRosterChanged"
              />
            </label>

            <label class="adj-field">
              <div class="field-head">
                <span class="field-label">专属代号</span>
                <span class="field-sub">选填 · 外号或呼号</span>
              </div>
              <input
                v-model="activeMember.callsign"
                class="wiz-input"
                type="text"
                placeholder="如：冷面算盘 / 夜枭"
              />
            </label>

            <label class="adj-field">
              <div class="field-head">
                <span class="field-label">职务与军衔</span>
                <span class="field-sub">队列编制头衔</span>
              </div>
              <input
                v-model="activeMember.title"
                class="wiz-input"
                type="text"
                placeholder="如：战区后勤精算主任"
                @input="onRosterChanged"
              />
            </label>

            <label class="adj-field">
              <div class="field-head">
                <span class="field-label">随行渊源</span>
                <span class="field-sub">因何随同登场</span>
              </div>
              <select v-model="activeMember.origin" class="wiz-select">
                <option v-for="o in HUMAN_ORIGIN_OPTIONS" :key="o.id" :value="o.id">
                  {{ o.label }}（{{ o.shortTag }}）
                </option>
              </select>
            </label>
          </div>

          <div class="origin-desc-line">
            <span class="origin-tag">{{ findHumanOrigin(activeMember.origin).shortTag }}</span>
            <span>{{ findHumanOrigin(activeMember.origin).desc }}</span>
          </div>

          <!-- 第二区：外貌着装 + 性格口吻（双栏等高对齐） -->
          <div class="dossier-row-2">
            <label class="adj-field">
              <div class="field-head">
                <span class="field-label">外貌与着装</span>
                <span class="field-sub">神态、衣着与随身标志物</span>
              </div>
              <textarea
                v-model="activeMember.appearance"
                class="wiz-textarea dossier-textarea"
                placeholder="眉眼神态、常穿制服/便装、义体改装或标志性随身物件……"
              ></textarea>
            </label>

            <label class="adj-field">
              <div class="field-head">
                <span class="field-label">性格与说话风格</span>
                <span class="field-sub">行事作风与口吻反差</span>
              </div>
              <textarea
                v-model="activeMember.personality"
                class="wiz-textarea dossier-textarea"
                placeholder="性格脾气、汇报风格与私下相处的态度反差……"
              ></textarea>
            </label>
          </div>

          <!-- 第三区：过往履历与绝活 -->
          <label class="adj-field dossier-full-field">
            <div class="field-head">
              <span class="field-label">过往履历与个人绝活</span>
              <span class="field-sub">同步载入战区人物图鉴与首幕简报</span>
            </div>
            <textarea
              v-model="activeMember.bio"
              class="wiz-textarea dossier-textarea-sm"
              placeholder="出身背景、专业领域绝活或个人执念……"
            ></textarea>
          </label>

          <!-- 第四区：专长倾向 + 开局席位委任（底部说明框等高对齐） -->
          <div class="dossier-row-2 equal-foot-row">
            <label class="adj-field stretch-field">
              <div class="field-head">
                <span class="field-label">战术专长倾向</span>
                <span class="field-sub">出任副官/参谋时生效</span>
              </div>
              <select v-model="activeMember.buffPreset" class="wiz-select" @change="onRosterChanged">
                <option v-for="b in ADJUTANT_BUFF_PRESETS" :key="b.id" :value="b.id">
                  {{ b.name }}
                </option>
              </select>
              <div class="buff-desc-hint stretch-hint">{{ findBuffDescription(activeMember.buffPreset) }}</div>
            </label>

            <label class="adj-field stretch-field">
              <div class="field-head">
                <span class="field-label">开局职务委任</span>
                <span class="field-sub">与下方席位实时同步</span>
              </div>
              <select
                :value="activeMember.assignment"
                class="wiz-select"
                @change="setMemberAssignment(activeMember.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">随行核心同伴（免日薪 · 0/日）</option>
                <option v-for="fid in selectedFactions" :key="fid" :value="`faction:${fid}`">
                  委任：{{ factionName(fid) }}主责副官（{{ HUMAN_ADJUTANT_DAILY_UPKEEP }}/日）
                </option>
                <option value="staff">
                  委任：联席参谋部参谋（{{ HUMAN_ADJUTANT_DAILY_UPKEEP }}/日）
                </option>
              </select>
              <div class="buff-desc-hint stretch-hint">
                {{
                  activeMember.assignment
                    ? `已正式委任席位（日薪 ${HUMAN_ADJUTANT_DAILY_UPKEEP}/日），同步载入人物图鉴与首幕剧情`
                    : '作为随行核心同伴登场（免日薪），完整载入人物图鉴与首幕车舱剧情'
                }}
              </div>
            </label>
          </div>
        </div>
      </div>
    </section>

    <!-- ══════════ 3. 副官与参谋席位任命 ══════════ -->
    <section class="wiz-section compact-sec">
      <div class="wiz-sec-head">
        <div class="wiz-label">3. 副官与参谋席位任命（从在场人员中点将）</div>
        <span class="wiz-chip" :class="totalDailyUpkeep > 0 ? 'warn' : 'rec'">
          副官总日薪：{{ totalDailyUpkeep }} / 日
        </span>
      </div>

      <!-- 席位切换 Tab 条 -->
      <div class="seat-tab-bar" role="tablist" aria-label="副官与参谋席位">
        <button
          v-for="(factionId, idx) in selectedFactions"
          :key="factionId"
          type="button"
          class="seat-tab"
          :class="{ active: activeSeatTab === factionId }"
          role="tab"
          :aria-selected="activeSeatTab === factionId"
          @click="activeSeatTab = factionId"
        >
          <span class="seat-tab-title">
            {{ idx === 0 ? '★' : `#${idx + 1}` }} {{ factionName(factionId) }}主责席
          </span>
          <span class="seat-tab-sub">{{ seatSummaryLabel(factionId) }}</span>
        </button>

        <button
          type="button"
          class="seat-tab"
          :class="{ active: activeSeatTab === '__staff__' }"
          role="tab"
          :aria-selected="activeSeatTab === '__staff__'"
          @click="activeSeatTab = '__staff__'"
        >
          <span class="seat-tab-title">✚ 联席参谋增益席</span>
          <span class="seat-tab-sub">
            {{
              staffAssignedHuman
                ? `${staffAssignedHuman.name} · ${HUMAN_ADJUTANT_DAILY_UPKEEP}/日`
                : staffEnabled
                  ? `${choices.staffAdjutant?.name || '参谋'} · ${HUMAN_ADJUTANT_DAILY_UPKEEP}/日`
                  : '空缺（0/日）'
            }}
          </span>
        </button>
      </div>

      <!-- 当前选中的阵营主责副官席位详情面板 -->
      <div
        v-for="(factionId, idx) in selectedFactions"
        v-show="activeSeatTab === factionId"
        :key="factionId"
        class="adj-slot-card"
      >
        <div class="adj-slot-head">
          <div class="adj-title-group">
            <strong class="adj-faction-name">{{ factionName(factionId) }}主责席 · 选择在场人员出任</strong>
            <span class="wiz-chip accent">首发载具：{{ starterMcv(factionId)?.vehicleName ?? 'MCV' }}</span>
          </div>
          <span class="wiz-chip" :class="slotFor(factionId).identity === 'human' ? 'warn' : 'rec'">
            {{
              slotFor(factionId).identity === 'human'
                ? `日薪 ${HUMAN_ADJUTANT_DAILY_UPKEEP}/日`
                : '零日薪开销'
            }}
          </span>
        </div>

        <div class="adj-identity-grid">
          <!-- 候选 1：首发 MCV 机娘兼任 -->
          <button
            type="button"
            class="opt-card adj-id-card"
            :class="{ sel: slotFor(factionId).identity === 'mcv_girl' }"
            @click="appointMcvGirlToFaction(factionId)"
          >
            <div class="opt-title">
              <span>🤖 {{ starterMcv(factionId)?.girlName ?? '机娘' }}（MCV机娘兼任）</span>
              <span class="wiz-chip rec">免日薪</span>
            </div>
            <div class="opt-flavor">
              {{ starterMcv(factionId)?.girlDuty ?? 'MCV移动基地车核心' }} · 自带专长增益
            </div>
          </button>

          <!-- 候选 2..N：已在上方「随行人类名册」中添加的己方人类 -->
          <button
            v-for="member in roster"
            :key="member.id"
            type="button"
            class="opt-card adj-id-card"
            :class="{ sel: isHumanAssignedToFaction(member, factionId) }"
            @click="setMemberAssignment(member.id, `faction:${factionId}`)"
          >
            <div class="opt-title">
              <span>
                👤 {{ member.name || '未命名人类' }}
                <small v-if="member.callsign">「{{ member.callsign }}」</small>
              </span>
              <span class="wiz-chip warn">{{ HUMAN_ADJUTANT_DAILY_UPKEEP }}/日</span>
            </div>
            <div class="opt-flavor">
              {{ member.title || '己方随行人员' }} · {{ findBuffName(member.buffPreset) }}
            </div>
          </button>

          <!-- 若上方名册尚未添加人类，提供一键招入对应阵营代表人物并委任入口 -->
          <button
            v-if="roster.length === 0"
            type="button"
            class="opt-card adj-id-card add-human-shortcut"
            @click="recruitAndAssignToFaction(factionId)"
          >
            <div class="opt-title">
              <span>✚ 招入随行人类并委任</span>
              <span class="wiz-chip warn">{{ HUMAN_ADJUTANT_DAILY_UPKEEP }}/日</span>
            </div>
            <div class="opt-flavor">
              当前随行名册为空；点击自动招入一名{{ factionName(factionId) }}代表参谋并展开其人物档案
            </div>
          </button>

          <!-- 候选末项：统帅亲自直辖 -->
          <button
            type="button"
            class="opt-card adj-id-card"
            :class="{ sel: slotFor(factionId).identity === 'commander_self' }"
            @click="appointCommanderSelfToFaction(factionId)"
          >
            <div class="opt-title">
              <span>🎖️ 统帅亲自直辖</span>
              <span class="wiz-chip">无专长加成</span>
            </div>
            <div class="opt-flavor">主指挥官直接兼管该阵营日常调度，零日薪，不挂载副官专长</div>
          </button>
        </div>

        <template v-if="slotFor(factionId).identity === 'mcv_girl'">
          <div class="adj-row">
            <label class="adj-field">
              <span class="field-label">{{ starterMcv(factionId)?.girlName ?? '机娘' }} · 副官专长增益预设</span>
              <select v-model="slotFor(factionId).buffPreset" class="wiz-select">
                <option v-for="b in ADJUTANT_BUFF_PRESETS" :key="b.id" :value="b.id">
                  {{ b.name }}
                </option>
              </select>
              <div class="buff-desc-hint">{{ findBuffDescription(slotFor(factionId).buffPreset) }}</div>
            </label>
          </div>
        </template>

        <template v-else-if="slotFor(factionId).identity === 'human'">
          <div class="adj-row">
            <label class="adj-field">
              <span class="field-label">在任人类副官：{{ slotFor(factionId).name }}（{{ slotFor(factionId).title }}）· 专长增益</span>
              <select
                v-model="slotFor(factionId).buffPreset"
                class="wiz-select"
                @change="syncSlotBuffBackToRoster(factionId)"
              >
                <option v-for="b in ADJUTANT_BUFF_PRESETS" :key="b.id" :value="b.id">
                  {{ b.name }}
                </option>
              </select>
              <div class="buff-desc-hint">{{ findBuffDescription(slotFor(factionId).buffPreset) }}</div>
            </label>
          </div>
        </template>

        <div v-if="idx > 0" class="adj-row">
          <label class="adj-field">
            <span class="field-label">跨系并网磨合代价（15日）</span>
            <select v-model="slotFor(factionId).penaltyPreset" class="wiz-select">
              <option v-for="p in penaltyOptionsFor(factionId)" :key="p.id" :value="p.id">
                {{ p.name }} — {{ p.reason }}
              </option>
            </select>
          </label>
        </div>
      </div>

      <!-- 联席参谋部 · 初始参谋增益席详情面板 -->
      <div v-show="activeSeatTab === '__staff__'" class="adj-slot-card">
        <div class="adj-slot-head">
          <div class="adj-title-group">
            <strong class="adj-faction-name">联席参谋增益席 · 从随行人类中点将出任</strong>
            <span class="wiz-chip">提供跨阵营全局参谋加成</span>
          </div>
          <span class="wiz-chip" :class="staffEnabled ? 'warn' : 'rec'">
            {{ staffEnabled ? `日薪 ${HUMAN_ADJUTANT_DAILY_UPKEEP}/日` : '空缺（零日薪）' }}
          </span>
        </div>

        <div class="adj-identity-grid">
          <button
            type="button"
            class="opt-card adj-id-card"
            :class="{ sel: !staffEnabled }"
            @click="clearStaffSeat()"
          >
            <div class="opt-title">
              <span>🚫 暂不设联席参谋</span>
              <span class="wiz-chip rec">0/日</span>
            </div>
            <div class="opt-flavor">开局暂不设立专职联席参谋席，节省每日薪饷支出</div>
          </button>

          <button
            v-for="member in roster"
            :key="member.id"
            type="button"
            class="opt-card adj-id-card"
            :class="{ sel: member.assignment === 'staff' }"
            @click="setMemberAssignment(member.id, 'staff')"
          >
            <div class="opt-title">
              <span>
                👤 委任：{{ member.name || '未命名人类' }}
                <small v-if="member.callsign">「{{ member.callsign }}」</small>
              </span>
              <span class="wiz-chip warn">{{ HUMAN_ADJUTANT_DAILY_UPKEEP }}/日</span>
            </div>
            <div class="opt-flavor">
              {{ member.title || '己方随行人员' }} · {{ findBuffName(member.buffPreset) }}
            </div>
          </button>

          <button
            v-if="roster.length === 0"
            type="button"
            class="opt-card adj-id-card add-human-shortcut"
            @click="recruitAndAssignToStaff()"
          >
            <div class="opt-title">
              <span>✚ 招入随行人类并出任参谋</span>
              <span class="wiz-chip warn">{{ HUMAN_ADJUTANT_DAILY_UPKEEP }}/日</span>
            </div>
            <div class="opt-flavor">
              点击自动招入「顾清弦（林参谋）· 冷面算盘」至随行名册并任命为联席参谋
            </div>
          </button>
        </div>

        <template v-if="staffEnabled && choices.staffAdjutant">
          <div class="adj-row" style="margin-top: 8px">
            <label class="adj-field">
              <span class="field-label">在任联席参谋：{{ choices.staffAdjutant.name }}（{{ choices.staffAdjutant.title }}）· 专长增益</span>
              <select
                v-model="choices.staffAdjutant.buffPreset"
                class="wiz-select"
                @change="syncStaffBuffBackToRoster()"
              >
                <option v-for="b in ADJUTANT_BUFF_PRESETS" :key="b.id" :value="b.id">
                  {{ b.name }}
                </option>
              </select>
              <div class="buff-desc-hint">{{ findBuffDescription(choices.staffAdjutant.buffPreset) }}</div>
            </label>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { getHostAdapter } from '../pipeline';
import {
  ADJUTANT_BUFF_PRESETS,
  defaultFactionAdjutantFor,
  FACTION_PENALTY_PRESETS,
  findFaction,
  findHumanOrigin,
  HUMAN_ADJUTANT_DAILY_UPKEEP,
  HUMAN_COMPANION_PRESETS,
  HUMAN_ORIGIN_OPTIONS,
  resolveSelectedFactions,
  resolveStarterMcvInfo,
  syncAdjutantsFromHumanRoster,
  type FactionAdjutantChoice,
  type HumanCompanionPreset,
  type HumanRosterMember,
  type LaunchChoices,
} from '../presets';

const choices = inject<LaunchChoices>('launchChoices')!;
const adapter = getHostAdapter();

if (!Array.isArray(choices.humanRoster)) {
  choices.humanRoster = [];
}
const roster = computed(() => choices.humanRoster!);
const selectedMemberId = ref<string>(roster.value[0]?.id ?? '');

const activeMember = computed<HumanRosterMember | null>(() => {
  if (roster.value.length === 0) return null;
  return roster.value.find(m => m.id === selectedMemberId.value) ?? roster.value[0];
});

const personaNames = computed<string[]>(() => {
  try {
    if (typeof adapter.personaNames === 'function') {
      const list = adapter.personaNames();
      return Array.isArray(list) ? list : [];
    }
  } catch {
    /* ignore host persona read error */
  }
  return [];
});
const existingDescription = computed<string>(() => {
  const name = choices.personaName.trim();
  if (!name) return '';
  try {
    if (typeof adapter.personaDescription === 'function') {
      return adapter.personaDescription(name) ?? '';
    }
  } catch {
    /* ignore host persona description error */
  }
  return '';
});

const savedExistingName = ref(choices.personaMode === 'existing' ? choices.personaName : '');
const savedCreateName = ref(choices.personaMode === 'create' ? choices.personaName : '');
const savedCreateDesc = ref(choices.personaDescription);

watch(
  () => choices.personaMode,
  (mode, prev) => {
    if (prev === 'existing') {
      savedExistingName.value = choices.personaName;
    } else if (prev === 'create') {
      savedCreateName.value = choices.personaName;
      savedCreateDesc.value = choices.personaDescription;
    }

    if (mode === 'existing') {
      const target =
        savedExistingName.value && personaNames.value.includes(savedExistingName.value)
          ? savedExistingName.value
          : (personaNames.value[0] ?? '');
      choices.personaName = target;
    } else if (mode === 'create') {
      choices.personaName = savedCreateName.value;
      choices.personaDescription = savedCreateDesc.value;
    }
  },
);

const selectedFactions = computed(() => resolveSelectedFactions(choices));
const activeSeatTab = ref<string>(selectedFactions.value[0] ?? 'allied');

watch(
  selectedFactions,
  list => {
    if (activeSeatTab.value !== '__staff__' && !list.includes(activeSeatTab.value)) {
      activeSeatTab.value = list[0] ?? 'allied';
    }
    for (const m of roster.value) {
      if (m.assignment.startsWith('faction:')) {
        const fid = m.assignment.slice('faction:'.length);
        if (!list.includes(fid)) {
          m.assignment = '';
        }
      }
    }
    syncAdjutantsFromHumanRoster(choices);
  },
  { immediate: true },
);

function factionName(factionId: string): string {
  return findFaction(factionId).name;
}

function starterMcv(factionId: string) {
  return resolveStarterMcvInfo(factionId);
}

function slotFor(factionId: string): FactionAdjutantChoice {
  if (!choices.factionAdjutants) {
    choices.factionAdjutants = {};
  }
  if (!choices.factionAdjutants[factionId]) {
    choices.factionAdjutants[factionId] = defaultFactionAdjutantFor(factionId);
  }
  return choices.factionAdjutants[factionId];
}

function isPresetInRoster(preset: HumanCompanionPreset): boolean {
  return roster.value.some(m => m.name.trim() === preset.name || m.id.startsWith(preset.id));
}

function toggleRecruitPreset(preset: HumanCompanionPreset) {
  const idx = roster.value.findIndex(m => m.name.trim() === preset.name || m.id.startsWith(preset.id));
  if (idx >= 0) {
    const removedId = roster.value[idx].id;
    roster.value.splice(idx, 1);
    if (selectedMemberId.value === removedId) {
      selectedMemberId.value = roster.value[0]?.id ?? '';
    }
    syncAdjutantsFromHumanRoster(choices);
    return;
  }
  const member: HumanRosterMember = {
    id: `${preset.id}_${Date.now()}`,
    name: preset.name,
    callsign: preset.callsign,
    title: preset.title,
    faction: preset.faction,
    origin: preset.origin,
    appearance: preset.appearance,
    personality: preset.personality,
    buffPreset: preset.buffPreset,
    bio: preset.bio,
    assignment: '',
  };
  roster.value.push(member);
  selectedMemberId.value = member.id;
  syncAdjutantsFromHumanRoster(choices);
}

function addCustomHuman(initialAssignment = ''): HumanRosterMember {
  const idx = roster.value.length + 1;
  const member: HumanRosterMember = {
    id: `human_custom_${Date.now()}_${idx}`,
    name: `随行军官 #${idx}`,
    callsign: '',
    title: '战区前线参谋',
    faction: selectedFactions.value[0] ?? 'allied',
    origin: 'veteran_retinue',
    appearance: '身穿干练的战地勤务制服，随身携带加密战术终端与便携配枪。',
    personality: '沉稳干练，执行命令果断利落，善于在高压局势下协助指挥官梳理情报。',
    buffPreset: 'logistics_actuary',
    bio: '追随指挥官一同跨界部署的前线骨干军官，熟悉基地车日常勤务与外围警戒调度。',
    assignment: initialAssignment,
  };
  roster.value.push(member);
  selectedMemberId.value = member.id;
  if (initialAssignment) {
    setMemberAssignment(member.id, initialAssignment);
  } else {
    syncAdjutantsFromHumanRoster(choices);
  }
  return member;
}

function removeHuman(memberId: string) {
  const idx = roster.value.findIndex(m => m.id === memberId);
  if (idx >= 0) {
    roster.value.splice(idx, 1);
    if (selectedMemberId.value === memberId) {
      selectedMemberId.value = roster.value[0]?.id ?? '';
    }
    syncAdjutantsFromHumanRoster(choices);
  }
}

function setMemberAssignment(memberId: string, assignment: string) {
  if (assignment) {
    for (const m of roster.value) {
      if (m.id !== memberId && m.assignment === assignment) {
        m.assignment = '';
      }
    }
  }
  const target = roster.value.find(m => m.id === memberId);
  if (target) {
    target.assignment = assignment;
    selectedMemberId.value = target.id;
  }
  syncAdjutantsFromHumanRoster(choices);
}

function onRosterChanged() {
  syncAdjutantsFromHumanRoster(choices);
}

function assignmentShortText(assignment: string): string {
  if (!assignment) return '随行同伴';
  if (assignment === 'staff') return '联席参谋';
  if (assignment.startsWith('faction:')) {
    const fid = assignment.slice('faction:'.length);
    return `${factionName(fid)}副官`;
  }
  return '在编';
}

function isHumanAssignedToFaction(member: HumanRosterMember, factionId: string): boolean {
  return (
    slotFor(factionId).identity === 'human' &&
    (member.assignment === `faction:${factionId}` || slotFor(factionId).name === member.name.trim())
  );
}

function appointMcvGirlToFaction(factionId: string) {
  for (const m of roster.value) {
    if (m.assignment === `faction:${factionId}`) {
      m.assignment = '';
    }
  }
  const slot = slotFor(factionId);
  const starter = starterMcv(factionId);
  slot.identity = 'mcv_girl';
  slot.name = starter?.girlName ?? `${factionName(factionId)}机娘`;
  slot.title = starter?.girlDuty ?? '首席战术副官';
  slot.buffPreset = starter?.defaultBuffPreset ?? slot.buffPreset;
}

function appointCommanderSelfToFaction(factionId: string) {
  for (const m of roster.value) {
    if (m.assignment === `faction:${factionId}`) {
      m.assignment = '';
    }
  }
  const slot = slotFor(factionId);
  slot.identity = 'commander_self';
}

function recruitAndAssignToFaction(factionId: string) {
  const matchedPreset =
    HUMAN_COMPANION_PRESETS.find(p => p.faction === factionId) ?? HUMAN_COMPANION_PRESETS[0];
  const member: HumanRosterMember = {
    id: `${matchedPreset.id}_${Date.now()}`,
    name: matchedPreset.name,
    callsign: matchedPreset.callsign,
    title: matchedPreset.title,
    faction: factionId,
    origin: matchedPreset.origin,
    appearance: matchedPreset.appearance,
    personality: matchedPreset.personality,
    buffPreset: matchedPreset.buffPreset,
    bio: matchedPreset.bio,
    assignment: `faction:${factionId}`,
  };
  roster.value.push(member);
  selectedMemberId.value = member.id;
  setMemberAssignment(member.id, `faction:${factionId}`);
}

function recruitAndAssignToStaff() {
  const preset = HUMAN_COMPANION_PRESETS[0];
  const member: HumanRosterMember = {
    id: `${preset.id}_${Date.now()}`,
    name: preset.name,
    callsign: preset.callsign,
    title: preset.title,
    faction: 'common',
    origin: preset.origin,
    appearance: preset.appearance,
    personality: preset.personality,
    buffPreset: preset.buffPreset,
    bio: preset.bio,
    assignment: 'staff',
  };
  roster.value.push(member);
  selectedMemberId.value = member.id;
  setMemberAssignment(member.id, 'staff');
}

function clearStaffSeat() {
  for (const m of roster.value) {
    if (m.assignment === 'staff') {
      m.assignment = '';
    }
  }
  if (choices.staffAdjutant) {
    choices.staffAdjutant.enabled = false;
  }
}

function syncSlotBuffBackToRoster(factionId: string) {
  const slot = slotFor(factionId);
  const member = roster.value.find(m => m.assignment === `faction:${factionId}`);
  if (member && slot.buffPreset) {
    member.buffPreset = slot.buffPreset;
  }
}

function syncStaffBuffBackToRoster() {
  const member = roster.value.find(m => m.assignment === 'staff');
  if (member && choices.staffAdjutant?.buffPreset) {
    member.buffPreset = choices.staffAdjutant.buffPreset;
  }
}

const staffAssignedHuman = computed(() => roster.value.find(m => m.assignment === 'staff') ?? null);

function seatSummaryLabel(factionId: string): string {
  const slot = slotFor(factionId);
  if (slot.identity === 'mcv_girl') return `${starterMcv(factionId)?.girlName ?? '机娘'}（免日薪）`;
  if (slot.identity === 'human') return `${slot.name?.trim() || '人类副官'} · ${HUMAN_ADJUTANT_DAILY_UPKEEP}/日`;
  return '统帅直辖';
}

function findBuffName(buffId?: string): string {
  return ADJUTANT_BUFF_PRESETS.find(b => b.id === buffId)?.name ?? '通用参谋增益';
}

function findBuffDescription(buffId?: string): string {
  return ADJUTANT_BUFF_PRESETS.find(b => b.id === buffId)?.description ?? '';
}

function penaltyOptionsFor(factionId: string) {
  const specific = FACTION_PENALTY_PRESETS.filter(p => p.faction === factionId);
  return specific.length > 0 ? specific : FACTION_PENALTY_PRESETS;
}

const staffEnabled = computed(() => Boolean(choices.staffAdjutant?.enabled));

const totalDailyUpkeep = computed(() => {
  let sum = 0;
  for (const factionId of selectedFactions.value) {
    if (slotFor(factionId).identity === 'human') {
      sum += HUMAN_ADJUTANT_DAILY_UPKEEP;
    }
  }
  if (staffEnabled.value) {
    sum += HUMAN_ADJUTANT_DAILY_UPKEEP;
  }
  return sum;
});
</script>

<style scoped>
.compact-sec {
  margin-bottom: 10px;
}

.persona-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.persona-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 10px;
}

.sr-radio {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.persona-empty-hint {
  margin-top: 6px;
  padding: 5px 9px;
  border-radius: 5px;
  border: 1px dashed rgba(210, 173, 105, 0.45);
  background: rgba(210, 173, 105, 0.08);
  color: var(--rac-warn);
  font-size: 11px;
}

.persona-sub-panel {
  margin-top: 8px;
}

.persona-preview {
  margin-top: 6px;
  padding: 6px 9px;
  font-size: 11.5px;
}

.persona-create-inline {
  margin-top: 8px;
  display: grid;
  grid-template-columns: minmax(180px, 0.4fr) minmax(0, 0.6fr);
  gap: 8px;
}

.compact-textarea {
  min-height: 44px;
}

/* ── 2. 随行人类名册与立体人物档案 Master-Detail ── */
.roster-bar-box {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 8px;
}

.core-line,
.recruit-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.core-label {
  font-size: 11px;
  color: var(--rac-muted);
  font-weight: 600;
  flex-shrink: 0;
}

.custom-add-pill {
  border-color: var(--rac-accent) !important;
  color: var(--rac-hi) !important;
}

.roster-empty-box {
  padding: 8px 11px;
  border-radius: 6px;
  border: 1px dashed var(--rac-dim);
  background: rgba(8, 13, 18, 0.55);
  font-size: 11.5px;
  color: var(--rac-muted);
  line-height: 1.5;
}

.roster-empty-box strong {
  color: var(--rac-hi);
}

.roster-master-detail {
  display: grid;
  grid-template-columns: 205px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
}

.roster-master-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.roster-chip-btn {
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-text);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
  transition: all 0.14s ease;
}

.roster-chip-btn:hover {
  border-color: var(--rac-line);
  background: var(--rac-panel-2);
}

.roster-chip-btn.sel {
  border-color: var(--rac-accent);
  background: var(--rac-panel-2);
  box-shadow: inset 3px 0 0 0 var(--rac-accent);
}

.rc-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.rc-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--rac-hi);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rc-callsign {
  color: var(--rac-accent);
  font-weight: 400;
}

.mini-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
  font-family: var(--mono);
}

.mini-badge.rec {
  color: var(--rac-ok);
  background: rgba(70, 209, 154, 0.14);
}

.mini-badge.warn {
  color: var(--rac-warn);
  background: rgba(210, 173, 105, 0.16);
}

.rc-sub {
  font-size: 10.5px;
  color: var(--rac-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.roster-add-more-btn {
  padding: 7px 10px;
  border-radius: 5px;
  border: 1px dashed var(--rac-dim);
  background: transparent;
  color: var(--rac-muted);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.roster-add-more-btn:hover {
  border-color: var(--rac-accent);
  color: var(--rac-hi);
}

.roster-detail-dossier {
  padding: 12px 14px;
  border-radius: 6px;
  border: 1px solid var(--rac-line);
  background: var(--rac-panel-2);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.dossier-top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--rac-dim);
}

.dossier-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.dossier-main-name {
  font-size: 13px;
  color: var(--rac-hi);
}

.rm-del-btn {
  background: rgba(255, 90, 54, 0.06);
  border: 1px solid rgba(255, 90, 54, 0.45);
  color: var(--rac-alert);
  border-radius: 4px;
  padding: 3px 9px;
  font-size: 11px;
  cursor: pointer;
  transition: background 0.14s ease;
}

.rm-del-btn:hover {
  background: rgba(255, 90, 54, 0.16);
}

/* 2x2 规整基础信息网格 */
.dossier-grid-2x2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 10px;
}

.dossier-row-2 {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.dossier-full-field {
  width: 100%;
}

.field-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}

.field-label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--rac-hi);
  white-space: nowrap;
}

.field-sub {
  font-size: 10px;
  color: var(--rac-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.origin-desc-line {
  padding: 6px 10px;
  border-radius: 5px;
  background: var(--rac-panel);
  border-left: 2px solid var(--rac-accent);
  font-size: 11px;
  color: var(--rac-text);
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1.45;
}

.origin-tag {
  font-size: 10px;
  font-family: var(--mono);
  padding: 1px 6px;
  border-radius: 3px;
  background: rgba(116, 198, 255, 0.12);
  color: var(--rac-accent);
  flex-shrink: 0;
}

.dossier-textarea {
  min-height: 58px;
  font-size: 11.5px;
  line-height: 1.5;
}

.dossier-textarea-sm {
  min-height: 44px;
  font-size: 11.5px;
  line-height: 1.5;
}

.equal-foot-row {
  align-items: stretch;
}

.stretch-field {
  height: 100%;
}

.stretch-hint {
  flex: 1;
  display: flex;
  align-items: center;
}

/* ── 3. 席位页签切换条与点将面板 ── */
.seat-tab-bar {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 6px;
  margin-bottom: 8px;
}

.seat-tab {
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--rac-dim);
  background: var(--rac-panel);
  color: var(--rac-muted);
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  transition: all 0.14s ease;
}

.seat-tab:hover {
  border-color: var(--rac-line);
  color: var(--rac-hi);
}

.seat-tab.active {
  border-color: var(--rac-accent);
  background: var(--rac-panel-2);
  color: var(--rac-hi);
  box-shadow: inset 0 2px 0 0 var(--rac-accent);
}

.seat-tab-title {
  font-size: 11.5px;
  font-weight: 700;
}

.seat-tab-sub {
  font-size: 10px;
  font-family: var(--mono);
  color: var(--rac-accent);
}

.adj-slot-card {
  padding: 10px 12px;
  border: 1px solid var(--rac-dim);
  border-radius: 6px;
  background: var(--rac-panel-2);
}

.adj-slot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.adj-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.adj-faction-name {
  font-size: 12.5px;
  color: var(--rac-hi);
}

.adj-identity-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
  gap: 7px;
  margin-bottom: 8px;
}

.adj-id-card {
  width: 100%;
  font: inherit;
  padding: 7px 9px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.add-human-shortcut {
  border-style: dashed !important;
}

.adj-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 8px;
  margin-top: 6px;
}

.adj-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--rac-muted);
}

.buff-desc-hint {
  margin-top: 2px;
  padding: 6px 9px;
  border-radius: 4px;
  background: var(--rac-panel);
  border: 1px dashed var(--rac-dim);
  color: var(--rac-text);
  font-size: 11px;
  line-height: 1.45;
}

@media (max-width: 760px) {
  .persona-grid,
  .persona-create-inline,
  .roster-master-detail,
  .dossier-grid-2x2,
  .dossier-row-2,
  .adj-identity-grid {
    grid-template-columns: 1fr;
  }
}
</style>
