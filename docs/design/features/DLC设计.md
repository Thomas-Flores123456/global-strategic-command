# DLC 机制设计文档

> 状态：已批准 · 2026-08-31
> 范围：世界书 + mvu指挥系统前端 · 变量树 schema v1 冻结不破
> 前置事实：codex 动态分组已验证（苏联特色线）；酒馆助手世界书/变量 API 能力已确认

## 1. 目标

支持以 DLC 包形式动态添加/扩展/修改游戏内容：全新阵营（焚风/欧盟/中国等）、
内容扩展（建筑/人员/载具/机娘模板）、原生内容修改——全流程在状态栏设置页完成，
无需重新打包前端，无需玩家手工导入世界书。

## 2. 包类型

| kind | 用途 | 典型内容 |
|---|---|---|
| `faction` | 新阵营 | 双书（特色科技·X + 武备·X）+ 阵营注册 + data |
| `addon` | 内容扩展 | 向现有阵营/通用线追加建筑/人员/载具/机娘模板 |
| `patch` | 原生修改 | takeover 武备移交、条目覆盖（需备份回滚） |

一个包可组合多个模块（如 faction 包内含 patch.takeover）。

## 3. 武备归属三档（设定层）

| 档 | 归属 | 可引进性 |
|---|---|---|
| 自研 | 本阵营型号 | 对同盟开放 |
| 引进 | 他阵营/友好势力型号（"同盟国·"分区） | 按 relations 门槛 |
| 特色 | 锁 MCV（光棱/磁暴/湍流…） | **永不可引进**（铁律：特色理论依赖本阵营核心加密层） |

- 通用理论一次研究全阵营生效（已有双轨模型）；**型号才有国籍**。
- "同盟国·"分区 = 尚未阵营化的友好势力的**影子分区**。
- 对应 DLC 安装后走 **takeover 移交**：型号全文移入新阵营武备书（自研档），
  原书条目改写为一行引进指引；卸载时照备份回滚。设定不推翻，户口本换主人。
- relations 一期固定"同盟=可引进"，字段预留关系动态（断供/断档叙事）。

## 4. manifest 格式

```jsonc
{
  "dlc": {
    "id": "foehn", "name": "焚风", "kind": "faction", "version": "1.0.0",
    "requires": { "core": ">=1.0" }
  },
  "data": {                    // 结构化层：前端 overlay + 校验器咬合，AI 不直接读
    "faction": { "mcv": "焚风建造厂核心", "lab": "焚风湍流实验室", "t3": null },
    "researches": [ { "name": "湍流基础工学", "tier": 1, "cost": 400, "eta": "约3日",
                      "line": "焚风特色", "prereq": "…", "prereqs": [],
                      "need_buildings": ["焚风建造厂核心"], "unlocks": "…", "desc": "…" } ],
    "buildings": [], "productions": [], "mecha_templates": [],
    "relations": { "盟军": { "stance": "hostile" } }
  },
  "patch": {
    "takeover": [ { "from": "武备·盟军", "entries": ["…"], "to": "武备·焚风" } ]
  },
  "worldbooks": [              // 文本层：给 AI 讲故事（酒馆助手 WorldbookEntry 格式）
    { "name": "特色科技·焚风", "entries": [ /* … */ ] },
    { "name": "武备·焚风", "entries": [ /* … */ ] }
  ]
}
```

## 5. 存储与数据流

| 数据 | 位置 | AI 可见 |
|---|---|---|
| 世界书本体 | 世界书 API（createWorldbook / rebindCharWorldbooks additional） | 按蓝绿灯 |
| 阵营注册 + 初始科技种子 | message 变量 codex（MVU 树内，安装器直写） | ✅ |
| DLC 注册表（版本/书单/回滚备份/data 副本） | chat 变量 `$dlc`（`$` 前缀宏不外发） | ❌ |

**双源同一事务**：安装器一次流程内完成"写世界书 + 写 codex 种子 + 写 $dlc"；
前端 overlay 唯一来源是 `$dlc.data`（不解析世界书文本），杜绝双源漂移。

```
$dlc: {
  foehn: { version, books: [...], codexSeeds: [...],
           data: { ...manifest.data 副本 }, backups: { "武备·盟军#uid3": {...原条目} },
           installedAt }
}
```

## 6. 前端架构：合并目录 store（批1 承重墙）

现状 `import { RESEARCHES } from catalog` 全静态 → 改为响应式合并目录：

```
effectiveCatalog = merge(base(catalog.ts), ...orderBy($dlc, 安装序), codex)
```

- merge 按 name 键：覆盖（同名）/ 追加（新名）；faction 三源合并：
  `$dlc.data.faction`（权威）→ codex kind='阵营'（AI 临时势力）→ 建筑命名兜底（"X建造厂核心"精确匹配）
- **初始化屏障**：store 启动 `ready=false` → 读完 chat `$dlc` → `ready=true` 放行 UI。
  杜绝"overlay 到位前 derive 用 base 算错建议"的一致性窗口。独立预览立即 ready（可用 ?scenario=dlc mock）。
- 消费点全改造：PanelTech / ActionBar / useDetail / derive* 一律吃合并目录。
- schema v1 不动：新内容全是数据（buildings/tech.done/codex 开放集合）。

## 7. 设置页（新"系统"tab）

- **DLC 管理**：已装列表（$dlc）· 粘贴/上传导入 · 卸载（确认弹窗+回滚）
- **内容体检**：世界书 / 变量 / 对账 三维，绿黄红分级报告
- **环境状态**：酒馆助手 API 探测；独立预览降级为只读提示

安装流水线：
`解析 manifest → 预检（schema+规约+冲突+依赖）→ 预览确认（含 patch diff 确认门）
→ createWorldbook ×N → rebind additional → 写 codex 种子 → 写 $dlc → 回执`

卸载：照 $dlc 注册表删书 + 解绑 + 清 codexSeeds + 回滚 backups。

## 8. 校验规则集

**结构层**（zod 硬校验 manifest.data）
- R1 tier 必填 1|2|3，缺失=红
- R2 层级门槛一致性：有 tier:2 科技而 faction.lab 未声明=红；有 tier:3 而 t3 条件未定义=红
- R3 硬性键值：name/cost/tier=红缺；desc/eta=黄缺，逐条报告
- R4 科技名全局唯一：对 base+已装全体查重=红

**文本层**（世界书 lint）
- R5 标头体例 `[书名 | 分类]`；书名前缀约定（特色科技·/武备·/通用·）
- R6 MCV 铁律句式存在（faction 包）
- R7 预告 lint：禁止"预告：""未解锁不展开"式剧透未解锁内容
- R8 文本↔数据一致性：data 科技名必须在世界书文本出现
- R9 常驻条目数与 token 估算超标=黄

**运行层**（对账）
- R10 世界书↔$dlc 对账：书在册不在/册在书不在=黄
- R11 takeover 对账：声明移交的条目必须存在于目标书=红
- R12 移交/覆盖冲突：多包抢同一条目=红，按安装序仲裁并明示
- R13 codex 结构校验 + tech.done 孤儿名检测

**保护清单**：原生 11 本书禁止从设置页删除；写操作一律确认门。

## 9. 批次计划

| 批 | 内容 | 验收 |
|---|---|---|
| 批1 | 合并目录 store + 消费点改造 + faction 动态发现 + 初始化屏障 + ?scenario=dlc | 预览三场景回归 + dlc 场景 + build |
| 批2 | 设置页骨架 + 三维体检只读版 + 校验器（R1-R13） | 预览 + 真机只读体检 |
| 批3 | 导入/卸载/patch 写操作 + $dlc + 回滚 + 确认门 | 真机导入样板包 + 卸载回滚验证 |
| 批4 | manifest 规范文档 + 双书模板 + 首个样板 DLC（建议现实阵营） | 真机全流程 + 驾驶员验收 |

真机验收始终是驾驶员的门；自动化不置 driver-accepted。
