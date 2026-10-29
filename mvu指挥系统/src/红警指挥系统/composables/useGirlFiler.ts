/**
 * 机娘入档效果层（useGirlFiler）——pending_lore 的观察者与提交编排
 *
 * 纯逻辑（渲染/upsert）在 girlFiler.ts；本层只做胶水：
 * - 自动入档开关（localStorage 纯 UI 偏好，默认开；同 ui.ts theme 惯例，不进 MVU 变量树）
 * - watch store.data.pending_lore：有货且自动开 → 逐个 fileDossier
 * - 成功后：pending_lore 移除该条 + codex 补一行索引（经 MVU store 双向同步持久化，
 *   变量树不长期滞留档案大文本——哲学同 codex「完整设定走世界书」）
 * - 失败：留在 pending，回执面板亮红，可手动重试（fileDossier 为 upsert，重试幂等）
 */
import { reactive, watch } from 'vue';
import { fileDossier, isGirlDossierEntry } from '../worldbook/girlFiler';
import { in_tavern, useDataStore } from './store';

const AUTO_KEY = 'rts-girl-autofile';

function loadAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== 'off';
  } catch {
    return true;
  }
}

export interface FileLogItem {
  time: string;
  girl: string;
  ok: boolean;
  note: string;
}

export const filerState = reactive({
  auto: loadAuto(),
  busy: false,
  receipts: [] as FileLogItem[],
});

export function setAutoFile(v: boolean): void {
  filerState.auto = v;
  try {
    localStorage.setItem(AUTO_KEY, v ? 'on' : 'off');
  } catch {
    /* storage 不可用时仅本次生效 */
  }
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const ROSTER_MAP: Record<string, string> = {
  appended: '已追加',
  'already-present': '已存在',
  'roster-entry-created': '已建花名册并登记',
  'roster-entry-missing': '条目缺失',
};

/** 逐个提交全部暂存档案；成功者移出 pending + codex 索引，失败者及非机娘项（如新势力）留存 */
export async function fileAllPending(): Promise<void> {
  if (filerState.busy) return;
  const store = useDataStore();
  const rawPending = Array.isArray(store.data.pending_lore) ? [...store.data.pending_lore] : [];
  const items = rawPending.filter(isGirlDossierEntry);
  if (items.length === 0) return;
  filerState.busy = true;
  try {
    const filedNames = new Set<string>();
    for (const d of items) {
      try {
        const receipt = await fileDossier(d);
        filedNames.add(d.name);
        // codex 索引 upsert（前端详情弹窗可查；已有同名则不重复）
        if (!store.data.codex.some(c => c.name === d.name)) {
          store.data.codex.push({
            name: d.name,
            kind: '人员',
            desc: `机娘·${d.model || '型号待定'}。完整技能档案见《机娘·能力档案》；剧情条目见《剧情·北坡纪事》。`,
            params: {},
          });
        }
        filerState.receipts.unshift({
          time: new Date().toLocaleTimeString(),
          girl: d.name,
          ok: true,
          note: `档案${receipt.dossier.action === 'created' ? '新建' : '更新'} · 人物${receipt.story.action === 'created' ? '新建' : '更新'} · 总览${
            ROSTER_MAP[receipt.story.rosterAction] ?? receipt.story.rosterAction
          }`,
        });
      } catch (e) {
        filerState.receipts.unshift({ time: new Date().toLocaleTimeString(), girl: d.name, ok: false, note: errText(e) });
      }
    }
    if (filedNames.size > 0 && Array.isArray(store.data.pending_lore)) {
      const remaining = store.data.pending_lore.filter(x => !isGirlDossierEntry(x) || !filedNames.has(x.name));
      store.data.pending_lore.splice(0, store.data.pending_lore.length, ...remaining);
    }
    filerState.receipts.splice(10); // 回执最多留 10 条
  } finally {
    filerState.busy = false;
  }
}

/**
 * App 挂载时安装自动入档观察者（酒馆环境限定；独立预览只亮牌不写书）。
 * watch 深度无需 deep：MVU 同步/解析落盘都会整树替换；immediate 覆盖"载入聊天即有存货"场景。
 */
export function installAutoFiler(): void {
  if (!in_tavern) return;
  const store = useDataStore();
  watch(
    () => (Array.isArray(store.data.pending_lore) ? store.data.pending_lore.filter(isGirlDossierEntry).length : 0),
    n => {
      if (n > 0 && filerState.auto && !filerState.busy) void fileAllPending();
    },
    { immediate: true },
  );
}
