/// <reference types="vite/client" />
/**
 * 未完工玩法统一开关（D6）：开关即生产/开发环境之别。
 * 沿用 Vite 按 `--mode` 注入的 import.meta.env.DEV（build:dev / watch / vitest 为 true，build 为 false）。
 */
export type FeatureName = 'engineering' | 'space';

export function isFeatureEnabled(_name: FeatureName): boolean {
  return import.meta.env?.DEV === true;
}
