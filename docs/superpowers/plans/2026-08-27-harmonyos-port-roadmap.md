# HarmonyOS 移植路线图（harmonyos-port）

> 基线：`main` 分支（React/Tauri Web 版）。逐批次把 Web 功能移植为 ArkTS 原生实现；
> Web 版依赖 Python 后端的能力一律改为**本地引擎**（离线可用），不依赖网络服务。

## 现状差距矩阵（2026-08-27 盘点）

| 功能域 | Web 实现 | 移植状态 |
|---|---|---|
| 应用外壳 / 布局 | AppShell + WorkspaceLayout | ✅ 完成 |
| 数据导入 | 文件 / 拖拽 / 粘贴 / SQLite（后端解析） | ✅ 文件选择 + 粘贴（SQLite 暂缓） |
| 表格 / 数据集管理 | DataTable + DatasetList | ✅ 完成 |
| 变换 | 后端 pandas | ✅ 本地 TransformOps（11+ 种 + 撤销） |
| 图表构建 | chartStore + 后端 figure | ✅ 本地 ChartData + PlotlySpec（16 类真实渲染） |
| 多 Y 轴 | yFields[axis, normalize] | ⚠️ 本批：模型已有，UI/渲染补齐 |
| Dashboard | dashboardStore（chart/kpi/text + 过滤 + 布局） | ⚠️ 本批：卡片模型 + KPI 配置 + 过滤联动（拖拽布局后续） |
| NL 清洗（AI 命令栏） | 后端 LLM | ✅ 本地确定性 NlParser |
| 问答 Ask | 后端 LLM（/api/v1/nl/ask） | ⚠️ Batch 2：LLM 接入 + 本地兜底 |
| QA 会话 / 导出 | qaStore + qaExport（md/html） | ⚠️ Batch 2 |
| 图表注解 / 参考线 | layout.annotations / shapes | ⚠️ Batch 3 |
| 命令面板 / 快捷键 | CommandPalette + shortcuts | ⚠️ Batch 3 |
| 故事 / 报告 | 后端生成 HTML | ⚠️ Batch 4：本地模板生成 HTML |
| 项目保存 | 后端 .metricstudio 文件 | ✅ Preferences JSON（Batch 1 起含 Dashboard） |
| 清洗配方 / 质量扫描 | 后端 quality + recipes | ⚠️ 部分（本地质量指标已有；配方管理后续批次） |
| SQL 工作台 / 血缘 | 后端 SQL 引擎 / 血缘图 | ⛔ 暂缓（需本地 SQL 引擎；血缘可基于 transformHistory 做子集） |
| Excel / Parquet | 后端解析 | ⛔ 暂缓（需格式解析库） |

## 批次规划

### Batch 1（本批）：多 Y 轴 parity + Dashboard 卡片化

**A. 多 Y 轴（web: EncodingPanel + encodingToPlotly L740-909）**

- [x] `engine/ChartData.ets`：`SeriesData` 携带 `axis` / `normalized`；XY 分支按 yField 传递 axis；构建后统一应用归一化（perSeries ÷ 自身最大绝对值，global ÷ 所有 global 系列最大绝对值，名称追加 " (normalized)"，语义与 web 一致）
- [x] `engine/PlotlySpec.ets`：trace 支持 `yaxis: 'y2'`；layout 增加 `yaxis2`（side=right / overlaying=y / anchor=x）；y 轴标题 = 左侧字段名 join，右轴同；归一化轴标题追加 " (normalized)"
- [x] `views/EncodingPanel.ets`：multi 类型每个 Y 行追加 轴（左/右）与归一化（无/按序列/全局）选择
- [x] `common/Locale.ets`：chart.axis.* / chart.norm.* / chart.normalize 键（zh+en）

**B. Dashboard 卡片化（web: dashboardStore + DashboardView 子集）**

- [x] `model/DashboardState.ets`（新）：`DashboardItem(kind: chart|kpi|text)` 列表 + 增删 + tick 通知（对齐 chartTick 模式）
- [x] `model/WorkspaceState.ets`：持有 `dashboard`；exportJson/importJson 携带 `dashboardItems`
- [x] `views/DashboardView.ets` 重写：items 驱动渲染；添加图表（选择现有 chart）/ 添加 KPI（数值列 + 聚合）/ 添加文本（TextArea）；chart/KPI/text 卡片删除；文本卡点击编辑；全局筛选同时作用于图表卡与 KPI 卡
- [x] `common/Locale.ets`：dashboard.* 补充键
- [x] 补充：`devecocli build` 构建通过（Batch 1 + Batch 2 均已验证编译）

### Batch 2：LLM 接入 + QA 会话

- [x] `engine/LlmClient.ets`（新）：@ohos.net.http，OpenAI 兼容 `/chat/completions`，读 `LlmConfig`；附 ops 解析与列名校验（`parseOpsReply`）与数据摘要构建（`buildDataContext`）
- [x] AICommandBar：清洗/提问两模式 LLM 优先、未配置或失败时回退本地引擎并 toast 提示；回答附模型徽标（本地引擎时标注「本地引擎」）
- [x] `model/QaState.ets`（新）：按数据集分会话（conversations/turns，含模型与时间戳）+ Markdown 导出（`conversationToMarkdown`）
- [x] 导出入口：AICommandBar 回答卡「导出 MD」按钮，DocumentSavePicker + fileIo 落盘
- [x] `module.json5`：申请 `ohos.permission.INTERNET`

### Batch 3：图表注解 + 命令面板 + 快捷键

- [ ] ChartConfig 增 layout（annotations/shapes），PlotlySpec 注入；配置入口放 ChartConfigDialog
- [ ] 命令面板（浮层 + 命令注册表：导航/主题/新建图表/撤销等，无后端命令）
- [ ] 快捷键子集（onKeyPreIme / 按键事件：Ctrl+K 面板、Ctrl+Z 撤销）

### Batch 4：故事 / 报告本地导出

- [ ] 本地 HTML 模板（数据源信息 + 清洗步骤 + 洞察 + 选中图表的 Plotly figure 离线渲染）+ fileIo 保存

### 暂缓 / 评估

- SQL 工作台（评估轻量本地 SQL 或降级为筛选表达式）
- 血缘视图（可基于 `transformHistory` 做线性链子集）
- Excel / Parquet 导入、Dashboard 拖拽布局、跨图 brush

## 验证

每批完成后在 DevEco/devecocli 环境执行 `devecocli build`；批内以静态自查为准（本仓库当前无 ArkTS SDK 可本地编译）。
