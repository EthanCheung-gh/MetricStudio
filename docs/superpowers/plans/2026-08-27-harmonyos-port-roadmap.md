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

- [x] ChartConfig 增 `ChartLayout`（annotations/shapes，含 clone），PlotlySpec 注入 figure； AnnotationPanel 提供文本注解、水平/垂直参考线（值可编辑、六色色板、删除），挂载于 ChartConfigDialog
- [x] 项目 JSON 携带 chart.layout（annotations + shapes）
- [x] 命令面板 CommandPalette（搜索过滤 + 导航/操作/设置 13 个本地命令：tab 切换、新建图表、撤销、面板折叠、主题、语言、设置、保存项目）
- [x] 快捷键：ArkUI `keyboardShortcut` 实现全局 Ctrl+K（命令面板）/ Ctrl+Z（撤销）/ Ctrl+S（保存项目）；TitleBar 增加面板入口按钮
- [x] 备注：SDK 的 `window.on('keyEvent')` 不存在、`KeyEvent` 无 `pressedKeys`（有 `ctrlKey`）——按编译器与 SDK d.ts 校准后改用 keyboardShortcut 方案

### Batch 4：故事 / 报告本地导出

- [x] `engine/ReportBuilder.ets`（新）：本地 HTML 生成（web backend report.py/story.py 的离线版）——数据源信息 + 清洗步骤（transformHistory）+ 洞察（computeInsights）+ 图表（buildFigureJson 同引擎）+ 结论；plotly.min.js（4.4MB）内联，导出文件完全离线可渲染；图表注入时强制浅色字体避免白底不可见；script 块对 JSON 做 `<` 转义
- [x] `views/ReportDialog.ets`（新）：报告标题 / 图表多选（默认全选）/ 区块勾选 / 结论输入 / DocumentSavePicker 保存
- [x] 入口：命令面板「导出报告」命令（workspaceState.reportOpen）
- [x] 与 web 的差异：合并 Story/Report 为单对话框；不做报告模板持久化（web 仅存 localStorage）

### 暂缓项评估（2026-08-28）

#### 1. SQL 工作台 —— **建议做（首选）**，relationalStore 即 SQLite

- web 实现核查：后端 `query_engine.py` 就是**内存 SQLite**（`sqlite3.connect(':memory:')` + pandas `to_sql` 镜像全部数据集 → 只读 SELECT；禁写关键词正则 + 单语句校验 + 10s 超时 + 1 万行截断 + 50 条历史）。
- 鸿蒙方案：`relationalStore`（系统内置 SQLite，API 已核对：`getRdbStore/querySql/batchInsert/execSQL`）+ cacheDir 临时库：
  1. 镜像：`CREATE TABLE`（列名安全化规则同 web `safe_table_name`）+ 分批 `batchInsertSync`（500 行/批）
  2. 执行：复刻同款只读校验（禁 attach/drop/insert 等 + 单 SELECT）后 `querySql`，结果截断 1 万行
  3. UI：SqlWorkbench 面板（SQL 输入 + 结果表 + 「保存为数据集」→ DataFrame 化）+ preferences 历史 50 条
- 价值：与 web **同方言**（都是 SQLite），查询经验互通，超出预期对齐。
- 工作量：中（引擎 ~200 行 + UI ~250 行）。风险：低-中（临时库生命周期；大表分批插入）。
- 可选延伸：SQLite 文件导入（用户 .db 拷入沙箱后 open）——可行但 RDB 对外来库有元数据写入风险，列为二期。

#### 2. 数据血缘 —— **建议做线性链子集**，并先修 undo 正确性缺陷

- 调查发现（重要）：`DataState.undo` 注释声称"TransformOps keeps an original snapshot"，**实际不存在**；undo 是在已变换帧上重放前 n-1 个算子——对 filter/dedupe/sort 等幂等算子碰巧正确，但 compute（重复加列）、rename（旧列缺失会 throw）、sample（重放丢数据）、pivot/melt 语义均错误。
- 子集方案：移植侧变换是单数据集线性链（无 join），无需 SVG 图，列表即可覆盖全部实际场景：
  1. 导入时深拷贝 base 快照
  2. 步骤列表：序号/算子/参数/结果行列数（±delta）
  3. 步骤预览：base 重放 0..N（行列数 + 与当前 diff，复用 diffWithCurrent 行键/列均值逻辑）
  4. 步骤禁用/启用：重放时跳过
  5. **顺带重写 undo 为「从 base 重放 n-1」**，一并修正正确性
- 工作量：中；风险：低（重放基础设施现成）；依赖：无。

#### 3. Excel / Parquet 导入 —— **Excel 做（SheetJS 桥），Parquet 拒绝/远期**

- Excel (.xlsx)：
  - 方案 A（推荐）：SheetJS 社区版（Apache-2.0）vendor `xlsx.full.min.js`（~1MB）进 rawfile + 隐藏 WebView 桥（项目已有 ChartView WebView 模式）：文件 → ArrayBuffer → WebView 内解析 → 行 JSON postMessage 回 ArkTS → DataFrame。解析器久经考验（日期/多 sheet），ArkTS 侧零解析代码，**不依赖 OHPM 生态**（本次生态检索因网络受限未核实，方案 A 规避该不确定性）。
  - 方案 B（不推荐）：纯 ArkTS 解析 OOXML（zlib 解压 + 手写 sharedStrings/styles/日期推断）——工作量与坑位显著更高。
- Parquet：纯 ArkTS 不现实（列式编码 + snappy/zstd）；C++ NAPI 引 parquet 工具链成本与个人工具场景失衡；JS 侧存在 hyparquet（MIT，纯 JS）可走同款 WebView 桥但编码覆盖待验证。**建议拒绝/远期**——CSV + SQLite + Excel 已覆盖绝大多数数据来源。

## 验证

每批完成后在 DevEco/devecocli 环境执行 `devecocli build`；批内以静态自查为准（本仓库当前无 ArkTS SDK 可本地编译）。
