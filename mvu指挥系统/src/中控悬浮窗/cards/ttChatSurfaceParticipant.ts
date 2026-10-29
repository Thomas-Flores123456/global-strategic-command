/**
 * ttChatSurfaceParticipant.ts —— TauriTavern 聊天虚拟列表 `ChatSurfaceParticipantV1` 楼层卡片水合适配器
 *
 * 架构文档：docs/Architecture/TaruiTavern/README.md
 * 实施任务包：docs/Architecture/Future Developments/30-TauriTavern宿主适配与专属开发脚手架实施任务包.md (PKG-C)
 *
 * 核心职责：
 * 1. 实现 TauriTavern `ChatSurfaceParticipantV1`（`id: 'tavernweave/floor-cards'`, `protocolVersion: 1`）；
 * 2. `prepareContent({ mesid, content }, claims)`：
 *    - 同步扫描 detached `.mes_text` 中的 `.tw-floor-card-host, .custom-tw-floor-card-host`；
 *    - 写入 `data-tw-mesid="${mesid}"`；
 *    - 若宿主带 `data-tw-last-height` 或存在同楼层同槽位历史高度缓存，恢复 `min-height` 防止虚拟滚动跳动；
 *    - 对显式声明重型 runtime（如 `data-tw-runtime="claim"`）的卡片宿主通过 `claims.claim(source, activate)` 注册按需激活与卸载回收；
 * 3. `didCommitContent({ mesid, element, content, signal })`：
 *    - 对已提交至 live DOM 的未水合卡片宿主调用 `hydrateFloorCardHost(hostEl, { mesid, mesElement: element })`；
 *    - 绑定 `signal` 的 `abort` 事件并返回幂等 `disposer`：在楼层滚出虚拟列表视口或内容重绘时，
 *      保存 `data-tw-last-height`、移除 `.tw-floor-card-mount` 子树并重置 `data-tw-hydrated`，确保下次滚回视口 100% 重新水合且零内存泄漏。
 */

import {
  getTauriTavernBridge,
  ttHostBridge,
  type ChatSurfaceMountedContext,
  type ChatSurfaceParticipantV1,
  type ChatSurfacePrepareContext,
  type ChatSurfaceRuntimeActivateContext,
  type ChatSurfaceRuntimeClaims,
  type TauriTavernChatSurfaceApi,
  type TauriTavernDisposable,
} from '../host/ttHostBridge';
import {
  collectFloorCardHosts,
  dehydrateFloorCardHost,
  hydrateFloorCardHost,
} from './floorCardHydrator';

export const FLOOR_CARD_PARTICIPANT_ID = 'tavernweave/floor-cards' as const;
export const FLOOR_CARD_PARTICIPANT_PROTOCOL_VERSION = 1 as const;

export interface FloorCardChatSurfaceParticipantOptions {
  /** 自定义 participant ID，默认 `'tavernweave/floor-cards'` */
  id?: string;
  /** 指定探测窗口（用于跨帧或单测注入） */
  hostWindow?: unknown;
  /** 单个卡片宿主完成水合时的可选回调 */
  onHydrateHost?: (hostEl: HTMLElement, mesid: number) => void;
  /** 单个卡片宿主卸载回收时的可选回调 */
  onDisposeHost?: (hostEl: HTMLElement, mesid: number, recordedHeight: number) => void;
}

function getCardTypeKey(hostEl: HTMLElement): string {
  return (
    (hostEl.dataset?.twCard ?? hostEl.getAttribute?.('data-tw-card') ?? 'faction-unlock').trim() ||
    'faction-unlock'
  );
}

function makeFloorCardSlotKey(mesid: number, index: number, cardType: string): string {
  return `${mesid}:${index}:${cardType}`;
}

function setHostMesid(hostEl: HTMLElement, mesid: number): void {
  const mesidStr = String(mesid);
  if (hostEl.dataset) {
    hostEl.dataset.twMesid = mesidStr;
  }
  hostEl.setAttribute?.('data-tw-mesid', mesidStr);
}

function applyPlaceholderMinHeight(hostEl: HTMLElement, heightPx: number): void {
  if (!Number.isFinite(heightPx) || heightPx <= 0) return;
  const rounded = Math.round(heightPx);
  const heightStr = String(rounded);
  if (hostEl.dataset) {
    hostEl.dataset.twLastHeight = heightStr;
  }
  hostEl.setAttribute?.('data-tw-last-height', heightStr);
  if (hostEl.style) {
    hostEl.style.minHeight = `${rounded}px`;
    hostEl.style.setProperty?.('min-height', `${rounded}px`);
  }
}

function readExistingLastHeight(hostEl: HTMLElement): number {
  const raw =
    hostEl.dataset?.twLastHeight ?? hostEl.getAttribute?.('data-tw-last-height') ?? '';
  const parsed = Number.parseFloat(String(raw).trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

/**
 * 判断卡片宿主是否显式声明需要通过 `claims.claim(source, activate)` 按需受控激活重型 runtime
 */
function resolveHeavyRuntimeClaimSource(hostEl: HTMLElement): Element | null {
  const runtimeMode = (
    hostEl.dataset?.twRuntime ??
    hostEl.getAttribute?.('data-tw-runtime') ??
    ''
  )
    .trim()
    .toLowerCase();
  const heavyFlag = (
    hostEl.dataset?.twHeavyRuntime ??
    hostEl.getAttribute?.('data-tw-heavy-runtime') ??
    ''
  )
    .trim()
    .toLowerCase();

  if (runtimeMode === 'claim' || runtimeMode === 'heavy' || heavyFlag === 'true') {
    return hostEl;
  }

  if (typeof hostEl.querySelector === 'function') {
    const childClaim =
      hostEl.querySelector('[data-tw-runtime="claim"]') ??
      hostEl.querySelector('[data-tw-heavy-runtime="true"]') ??
      hostEl.querySelector('[data-tw-heavy-preview="true"]') ??
      hostEl.querySelector('.tw-heavy-runtime-source');
    if (childClaim) {
      return childClaim;
    }
  }

  return null;
}

function invokeDisposable(disposable: TauriTavernDisposable | void | null | undefined): void {
  if (!disposable) return;
  if (typeof disposable === 'function') {
    disposable();
    return;
  }
  if (typeof disposable === 'object' && typeof disposable.dispose === 'function') {
    disposable.dispose();
  }
}

/**
 * 创建 TauriTavern `ChatSurfaceParticipantV1` 楼层卡片水合参与者实例
 */
export function createFloorCardChatSurfaceParticipant(
  options?: FloorCardChatSurfaceParticipantOptions,
): ChatSurfaceParticipantV1 {
  const participantId = options?.id?.trim() || FLOOR_CARD_PARTICIPANT_ID;
  const slotHeightCache = new Map<string, number>();
  const claimedHosts = new WeakSet<HTMLElement>();
  const activeClaimDisposers = new WeakMap<HTMLElement, () => void>();

  return {
    id: participantId,
    protocolVersion: FLOOR_CARD_PARTICIPANT_PROTOCOL_VERSION,

    prepareContent(
      context: ChatSurfacePrepareContext,
      claims: ChatSurfaceRuntimeClaims,
    ): void {
      if (!context || !context.content) return undefined;
      const { mesid, content } = context;
      const hosts = collectFloorCardHosts(content);

      for (let idx = 0; idx < hosts.length; idx++) {
        const hostEl = hosts[idx];
        const cardType = getCardTypeKey(hostEl);
        const slotKey = makeFloorCardSlotKey(mesid, idx, cardType);

        setHostMesid(hostEl, mesid);

        // 恢复最小占位高度（优先取元素自身 data-tw-last-height，其次取同楼层同槽位历史卸载高度缓存）
        const explicitLastHeight = readExistingLastHeight(hostEl);
        const cachedHeight = explicitLastHeight > 0
          ? explicitLastHeight
          : (slotHeightCache.get(slotKey) ?? 0);
        if (cachedHeight > 0) {
          applyPlaceholderMinHeight(hostEl, cachedHeight);
        }

        // 若宿主显式标记需要重型 runtime，注册 claims.claim 按需激活器
        const claimSource = resolveHeavyRuntimeClaimSource(hostEl);
        if (claimSource && claims && typeof claims.claim === 'function') {
          claimedHosts.add(hostEl);
          claims.claim(
            claimSource,
            (activateCtx: ChatSurfaceRuntimeActivateContext): TauriTavernDisposable => {
              const effectiveMesid =
                typeof activateCtx?.mesid === 'number' && Number.isFinite(activateCtx.mesid)
                  ? activateCtx.mesid
                  : mesid;
              const effectiveElement =
                activateCtx?.element ?? (activateCtx?.content as HTMLElement | undefined) ?? content;

              setHostMesid(hostEl, effectiveMesid);
              const didHydrate = hydrateFloorCardHost(hostEl, {
                mesid: effectiveMesid,
                mesElement: effectiveElement,
              });
              if (didHydrate) {
                options?.onHydrateHost?.(hostEl, effectiveMesid);
              }

              let disposed = false;
              const disposeClaim = () => {
                if (disposed) return;
                disposed = true;
                activeClaimDisposers.delete(hostEl);
                const recordedHeight = dehydrateFloorCardHost(hostEl);
                if (recordedHeight > 0) {
                  slotHeightCache.set(
                    makeFloorCardSlotKey(effectiveMesid, idx, cardType),
                    recordedHeight,
                  );
                }
                options?.onDisposeHost?.(hostEl, effectiveMesid, recordedHeight);
              };

              activeClaimDisposers.set(hostEl, disposeClaim);

              const sig = activateCtx?.signal;
              if (sig) {
                if (sig.aborted) {
                  disposeClaim();
                } else if (typeof sig.addEventListener === 'function') {
                  sig.addEventListener('abort', disposeClaim, { once: true });
                }
              }

              return disposeClaim;
            },
          );
        }
      }

      return undefined;
    },

    didCommitContent(
      context: ChatSurfaceMountedContext,
    ): TauriTavernDisposable {
      if (!context || !context.content) {
        return () => {};
      }
      const { mesid, element, content, signal } = context;
      const initialHosts = collectFloorCardHosts(content);

      for (let idx = 0; idx < initialHosts.length; idx++) {
        const hostEl = initialHosts[idx];
        const cardType = getCardTypeKey(hostEl);
        const slotKey = makeFloorCardSlotKey(mesid, idx, cardType);

        setHostMesid(hostEl, mesid);

        const existingHeight = readExistingLastHeight(hostEl) || slotHeightCache.get(slotKey) || 0;
        if (existingHeight > 0) {
          applyPlaceholderMinHeight(hostEl, existingHeight);
        }

        // 已通过 claims.claim 托管按需激活的卡片宿主，等待 runtime 授权时再水合
        if (claimedHosts.has(hostEl)) {
          continue;
        }

        const hydrated = hydrateFloorCardHost(hostEl, {
          mesid,
          mesElement: element ?? content,
        });
        if (hydrated) {
          options?.onHydrateHost?.(hostEl, mesid);
        }
      }

      let disposed = false;
      const disposeFloor = () => {
        if (disposed) return;
        disposed = true;

        const currentHosts = collectFloorCardHosts(content);
        const allHosts: HTMLElement[] = [];
        const seen = new Set<HTMLElement>();
        for (const h of [...initialHosts, ...currentHosts]) {
          if (!seen.has(h)) {
            seen.add(h);
            allHosts.push(h);
          }
        }

        for (let idx = 0; idx < allHosts.length; idx++) {
          const hostEl = allHosts[idx];
          const activeClaimDispose = activeClaimDisposers.get(hostEl);
          if (activeClaimDispose) {
            activeClaimDispose();
            continue;
          }

          const cardType = getCardTypeKey(hostEl);
          const recordedHeight = dehydrateFloorCardHost(hostEl);
          if (recordedHeight > 0) {
            slotHeightCache.set(makeFloorCardSlotKey(mesid, idx, cardType), recordedHeight);
          }
          options?.onDisposeHost?.(hostEl, mesid, recordedHeight);
        }
      };

      if (signal) {
        if (signal.aborted) {
          disposeFloor();
        } else if (typeof signal.addEventListener === 'function') {
          signal.addEventListener('abort', disposeFloor, { once: true });
        }
      }

      return disposeFloor;
    },
  };
}

/**
 * 向 TauriTavern `ChatSurface` 注册楼层卡片水合参与者，返回幂等注销函数。
 */
export function installChatSurfaceCardParticipant(
  chatSurface?: TauriTavernChatSurfaceApi | null,
  options?: FloorCardChatSurfaceParticipantOptions,
): () => void {
  const resolvedSurface =
    chatSurface ??
    (options?.hostWindow !== undefined
      ? getTauriTavernBridge(options.hostWindow).chatSurface
      : ttHostBridge.chatSurface);

  if (!resolvedSurface || typeof resolvedSurface.registerParticipant !== 'function') {
    return () => {};
  }

  const participant = createFloorCardChatSurfaceParticipant(options);
  const registration = resolvedSurface.registerParticipant(participant);

  let unregistered = false;
  return () => {
    if (unregistered) return;
    unregistered = true;
    invokeDisposable(registration);
  };
}
