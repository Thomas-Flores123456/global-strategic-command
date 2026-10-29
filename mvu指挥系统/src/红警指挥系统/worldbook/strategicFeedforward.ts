/**
 * worldbook/strategicFeedforward.ts —— 战略前馈与基地防区工程摘要导出入口（FD-38 · PKG-D）
 *
 * 与 planning/strategicFeedforward.ts 同源导出，提供 formatBaseSectorsSummary、
 * buildStrategicFeedforwardText 与 formatStrategicFeedforwardPrompt（支持输出各基地
 * 已建成的防区/环境工程名称列表，如 `防区工程：洞口防红外伪装网、半山腰通风竖井管网`）。
 */
export * from '../planning/strategicFeedforward';
export {
  buildStrategicFeedforwardText,
  deriveStrategicFeedforward,
  formatBaseSectorsSummary,
  formatStrategicFeedforwardPrompt,
} from '../planning/strategicFeedforward';
