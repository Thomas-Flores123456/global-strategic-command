import gsap from 'gsap';
import { effectScope, nextTick, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  UI_MOTION_STORAGE_KEY,
  getUiMotionEnabled,
  isTestOrJsdomEnv,
  playTacticalAlertPulse,
  playTacticalDrawerEnter,
  playTacticalModalEnter,
  playTacticalStagger,
  setUiMotionEnabled,
  shouldRunGsapMotion,
  useGsapNumber,
  type StorageLike,
} from '../ui/motion/useGsapMotion';

function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, val) => {
      map.set(key, val);
    },
  };
}

function createFakeElement(childrenCount = 0): HTMLElement {
  const children = Array.from({ length: childrenCount }, () => ({ style: {} }) as unknown as HTMLElement);
  return {
    style: {},
    querySelectorAll: () => children,
  } as unknown as HTMLElement;
}

describe('useGsapMotion 统一战术动效底座', () => {
  it('默认开启战术界面动效，并支持通过 Storage 持久化开关状态', () => {
    const storage = createMemoryStorage();
    expect(getUiMotionEnabled(storage)).toBe(true);

    setUiMotionEnabled(false, storage);
    expect(storage.getItem(UI_MOTION_STORAGE_KEY)).toBe('false');
    expect(getUiMotionEnabled(storage)).toBe(false);

    setUiMotionEnabled(true, storage);
    expect(getUiMotionEnabled(storage)).toBe(true);
  });

  it('在 Vitest 测试环境下默认自动零延时旁路（保证同步单测不退化），forceRun 时放行', () => {
    const storage = createMemoryStorage();
    expect(isTestOrJsdomEnv()).toBe(true);
    expect(shouldRunGsapMotion({ storage })).toBe(false);
    expect(shouldRunGsapMotion({ storage, forceRun: true })).toBe(true);
  });

  it('useGsapNumber 在测试环境下同步更新数值，在 forceRun 时调用 gsap.to 进行补间', async () => {
    const scope = effectScope();
    const raw = ref(100);
    let animated!: ReturnType<typeof useGsapNumber>;
    scope.run(() => {
      animated = useGsapNumber(() => raw.value, { duration: 0.3 });
    });

    expect(animated.value).toBe(100);
    raw.value = 250;
    await nextTick();
    expect(animated.value).toBe(250);
    scope.stop();

    // 验证 forceRun 触发真实 gsap.to
    const toSpy = vi.spyOn(gsap, 'to').mockImplementation(() => ({}) as unknown as gsap.core.Tween);
    const forcedScope = effectScope();
    const rawForced = ref(10);
    forcedScope.run(() => {
      useGsapNumber(() => rawForced.value, { duration: 0.2, forceRun: true });
    });
    rawForced.value = 90;
    await nextTick();
    expect(toSpy).toHaveBeenCalled();
    toSpy.mockRestore();
    forcedScope.stop();
  });

  it('playTacticalModalEnter / DrawerEnter / Stagger / AlertPulse 基于元素引用触发 GSAP 补间', () => {
    const fromToSpy = vi.spyOn(gsap, 'fromTo').mockImplementation(() => ({}) as unknown as gsap.core.Tween);
    const killSpy = vi.spyOn(gsap, 'killTweensOf').mockImplementation(() => undefined);

    const backdrop = createFakeElement(0);
    const panel = createFakeElement(2);

    // 默认测试环境零延时旁路，不触发 fromTo
    playTacticalModalEnter(panel, backdrop);
    expect(fromToSpy).not.toHaveBeenCalled();

    // forceRun 时对 backdrop、panel 与内部子卡片执行补间
    playTacticalModalEnter(panel, backdrop, { forceRun: true });
    expect(fromToSpy).toHaveBeenCalledTimes(3);

    fromToSpy.mockClear();
    playTacticalDrawerEnter(panel, backdrop, { forceRun: true });
    expect(fromToSpy).toHaveBeenCalledTimes(2);

    fromToSpy.mockClear();
    playTacticalStagger(panel, '.pillar-card', { forceRun: true });
    expect(fromToSpy).toHaveBeenCalledTimes(1);

    fromToSpy.mockClear();
    playTacticalAlertPulse(panel, { forceRun: true });
    expect(fromToSpy).toHaveBeenCalledTimes(1);

    fromToSpy.mockRestore();
    killSpy.mockRestore();
  });
});
