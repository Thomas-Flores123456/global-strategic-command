/**
 * modalErrorGuard.ts —— 弹窗渲染失败防御层（F5）
 *
 * 背景：弹窗 Teleport 进宿主全屏覆盖层 iframe（z 10000，打开时 pointer-events:auto）。
 * 若弹窗组件 render/setup 抛错，挂载根节点为空，但覆盖层仍全屏可交互，酒馆整页被卡死。
 *
 * 方案：在 FloatingApp 注册 onErrorCaptured；仅当错误源自「弹窗子树」时回退弹窗态
 * （activeModal=null / 关闭详情抽屉），由既有 watch(isAnyModalOpen) 联动 setModalHostVisible(false)
 * 收起覆盖层。非弹窗子树（控制台主体）的错误不拦截、照常上抛，避免误关。
 */
import { type ComponentPublicInstance, onErrorCaptured } from 'vue';

export interface ModalErrorGuardOptions {
  /** 弹窗根组件（FloatingApp 直接渲染的 Modal 与 Panel 组件定义） */
  modalComponents: readonly unknown[];
  /** 错误源自弹窗子树时调用：回退弹窗态 */
  onModalFailure: (err: unknown, source: string) => void;
}

/** 从出错实例向上追溯，返回第一个命中的弹窗根组件定义（未命中返回 null） */
export function findOwningModal(
  instance: ComponentPublicInstance | null | undefined,
  modalComponents: readonly unknown[],
): unknown {
  const set = new Set(modalComponents);
  let cur = instance?.$ ?? null;
  while (cur) {
    if (set.has(cur.type)) return cur.type;
    cur = cur.parent;
  }
  return null;
}

function componentName(def: unknown): string {
  const d = def as { __name?: string; name?: string } | null;
  return d?.__name ?? d?.name ?? 'anonymous';
}

/** 须在组件 setup 内调用 */
export function useModalErrorGuard(options: ModalErrorGuardOptions): void {
  onErrorCaptured((err, instance, info) => {
    const owner = findOwningModal(instance, options.modalComponents);
    if (!owner) return; // 非弹窗子树：不处理，继续上抛
    const source = componentName(owner);
    console.error(`[FloatingApp] 弹窗 ${source} 渲染失败（${info}），已回退弹窗态以释放全屏覆盖层:`, err);
    try {
      options.onModalFailure(err, source);
    } catch (e) {
      console.error('[FloatingApp] 弹窗回退失败:', e);
    }
    return false; // 已处理，停止上抛
  });
}
