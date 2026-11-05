# 第一波修复：公共规则（所有车道代理必读）

项目根 k:\AiChat\SillyTavern-世界观构建，源码 mvu指挥系统/src/。审计文档 docs/audit/2026-11-03-九大玩法审计汇总.md（只读，由主代理回写，你不要改它）。

## 权限变更
你从只读审计代理改为**本车道修复代理**。只能改下面“归属文件”里的文件及其对应测试文件（__tests__ 下同名或相关测试）。

## 红线
1. 不得 git（commit/stash/checkout/reset/restore 全禁），不联网，不 install，不 build/打包。
2. 工作区已有指挥官未提交改动（如 operationEngine.ts、researchSlots.ts、settleFloorHelpers.ts、schema.ts、laneProviders.ts、researchCompute.ts 等）。在其基础上继续改，**不得回退或覆盖他人改动**。改前先读当前文件内容。
3. 不得修改归属清单以外的文件。如必须改共享文件（useParse.ts、parsePipeline.ts、settleFloorHelpers.ts、settleFloor.ts（除 A6）、schema.ts 等），停下来，在回报里写成“第二波需求：文件/位置/改法”，由主代理统一处理。
4. 源头修复，不加兼容补丁层，不保留重复实现；不做与编号无关的重构或格式化。
5. 测试只补关键回归用例（每个编号 0~2 个），不扩写测试套件。不写哈希、不加无意义防御。
6. 若某编号实际需要设计决策（数值、玩法规则），不要自作主张，写进回报“需指挥官决策”。

## 验收（自己完成）
- 在 mvu指挥系统/ 目录运行 `pnpm exec vitest run <相关测试文件>` 验证；最后跑一次全量 `pnpm exec vitest run --reporter=dot`。
- 改前基线：docs/audit/baseline/failing-before.txt（46 条已存在的失败，62 个用例）。**不得新增失败**；已有失败不用修。
- 跑 `pnpm exec tsc --noEmit -p .`，对比 docs/audit/baseline/tsc-before-by-file.txt，你改动的文件不得新增类型错误。
- 注意：其他车道代理在并行改别的文件，全量测试若出现与你文件无关的新失败，注明“疑似他车道”即可。

## 回报格式（最终回复，紧凑）
1. 改动文件清单。
2. 每个编号：已修/部分/未修 + 改了什么（文件:行号）+ 证据（测试名或命令结果）。
3. 第二波需求（跨文件）。
4. 需指挥官决策项。
5. 未测边界（尤其需真机 SillyTavern 验证的）。
