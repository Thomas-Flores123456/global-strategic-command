# 项目文档导航

本目录用于收纳设计、计划、报告、交接与参考资料。工作区根目录只保留项目入口与日常操作脚本；现行世界书真源统一收纳在 `../worldbooks/`。

## 真源与目录职责

- `../worldbooks/*_世界书.json`：当前仓库的**现行设计态世界书真源**（共计 29 本标准条令世界书 ＋ 1 本剧情专卷 `赛博朋克2042-剧情.json`）。需要导入、校验或继续编辑时，以该目录为准。
- `../mvu指挥系统/`：MVU 前端与运行逻辑工程，与根目录统一纳入同一 Git 仓库管理。
- `../worldbook-explorer/`：本地只读世界书可视化检阅、苏联科技树与静态命中模拟工具。
- `../site/`：VitePress 静态文档站子工程。
- `../scripts/`：世界书与 Catalog 四态差异对账审计（`audit-worldbook-catalog.mjs`）及自动回填迁移工具（`inject-catalog-to-worldbook.mjs`）。
- `../samples/dlc/`：可复制使用的 DLC 样板与最小冒烟包。
- `../tests/fixtures/`：跨模块共享测试夹具。

## 根目录入口

- `../AGENTS.md`、`../CLAUDE.md`：项目常驻规则。
- `../NEXT.md`：当前唯一进度与下一步入口。
- `../校验世界书.mjs`：无参数时校验 `../worldbooks/` 中的全部现行世界书。
- `../统计常驻.mjs`：无参数时统计 `../worldbooks/` 中的现行世界书条目与 token 预算。
- `../起服CORS.mjs`：为 `mvu指挥系统` 的 `pnpm serve` 提供静态 CORS 服务。

## 设计文档

### 阵营设计

- [苏联阵营基调](design/factions/苏联阵营基调.md)
- [苏联科技总设计](design/factions/苏联科技总设计.md)
- [苏联武备总设计](design/factions/苏联武备总设计.md)
- [苏联建筑总设计](design/factions/苏联建筑总设计.md)

以上四份文件是苏联阵营的 v0.1 设计基线；不代表苏联世界书、`catalog.ts`、MVU 或运行时已经落地。

### 科技、武备与层级

- [T2 科技总设计](design/tech/T2科技总设计文档.md)
- [T2 扩展设计案](design/tech/T2扩展设计案.md)
- [T2 现实武备参数附录](design/tech/T2现实武备参数附录.md)
- [T3 科技总设计](design/tech/T3科技总设计文档.md)
- [T3 现实武备参数附录](design/tech/T3现实武备参数附录.md)
- [C4ISR 信息战 T2 回填方案](design/tech/C4ISR信息战T2回填方案.md)
- [暴露分级表设计方案](design/tech/暴露分级表设计方案.md)
- [战术网电作战体系与模块化枢纽总设计案](design/tech/战术网电作战体系与模块化枢纽总设计案.md)

### 系统与世界架构

- [MVU 协议讨论稿](design/systems/MVU协议讨论稿.md)
- [动态档案引擎设计草案](design/systems/动态档案引擎设计草案.md)
- [多世界适配总设计](design/systems/多世界适配总设计.md)
- [机娘技能设计总集](design/systems/机娘技能设计总集.md)

### 功能专题

- [DLC 设计](design/features/DLC设计.md)
- [DLC 制作规范](design/features/DLC制作规范.md)
- [开场启动器总设计案](design/features/开场启动器-总设计案.md)
- [开场启动器蓝图](design/features/开场启动器-蓝图.md)

## 项目记录

### 计划

- **[苏联阵营后续实施任务包](project/plans/苏联阵营后续实施任务包.md)**：苏联主线的跨 Agent 可领取任务账；领取任务时必须填写状态、Agent、带时区时间、文件锁、基线 SHA256 和回执。
- **[中控台版本迭代任务包](project/plans/中控台版本迭代任务包.md)**：中控台悬浮窗与世界书单一事实源（SSOT）架构转型任务包；以世界书 `<数据>` JSON 为唯一事实源、酒馆正则切除为过滤管道、四态差异对账与动态 Catalog 聚合。
- [世界书落地排期清单](project/plans/世界书落地排期清单.md)

### 报告与迁移映射

- **[世界书量化状态审计报表](project/reports/世界书量化状态审计报表.md)**：世界书与 Catalog 四态差异扫描审计报告，为单一事实源（SSOT）转型提供全量对账清单与机器可读快照。
- **[项目文件迁移公告（后续 Agent 必读）](project/reports/项目文件迁移公告-2026-09-02.md)**
- [苏联阵营大规模调研报告](project/reports/苏联阵营大规模调研报告.md)
- [Batch 0–2 catalog 数据化迁移报告](project/reports/Batch0-2-catalog数据化迁移报告.md)
- [T2 复检报告与后续设计案](project/reports/T2复检报告与后续设计案.md)
- [机娘能力档案 O1 叶子化迁移映射](project/reports/机娘能力档案-O1叶子化迁移映射.md)

### 历史交接

以下文档保留当时的路径、版本和会话状态，只用于追溯；当前状态以根目录 `NEXT.md` 为准。

- [机娘书 token 预算备忘](project/handoffs/跨会话协调-机娘书token预算备忘.md)
- [意识线保护书旧口径](project/handoffs/跨会话协调-意识线保护书旧口径.md)
- [MVU 协议与解析修复旧开场](project/handoffs/新会话开场-MVU协议与解析修复.md)
- [T2/T3 科技补全旧开场](project/handoffs/新会话开场-T2T3科技补全设计.md)

## 参考

- [（必看）编写世界书时的优化技巧](reference/（必看）编写世界书时的优化技巧.md)：性能、递归控制与 Token 预算指南。
- [世界书文风与受控质感编写规范](reference/世界书文风与受控质感编写规范.md)：正文语域、冷战工业档案体、受控质感规则与黄金样本标准。

## DLC 样板

- [欧盟完整样板](../samples/dlc/DLC样板_欧盟.json)
- [欧盟 mini 冒烟包](../samples/dlc/DLC测试包_欧盟mini.json)

两包书名相同，必须互斥安装。完整样板用于复制改造，mini 包只用于验证安装管道。

## 修改纪律

1. 世界书修改前先确认目标、红线和验收，并按项目规则加载 A0。
2. 设计链仍遵循“设计文档 → 世界书 → catalog/MVU”；不要从 `archive` 或 `.tmp` 反向覆盖现行真源。
3. 修改世界书后至少运行：

   ```powershell
   node 校验世界书.mjs
   node 统计常驻.mjs
   ```

4. 静态校验不能替代真实 SillyTavern 导入、运行时激活和驾驶员验收。
