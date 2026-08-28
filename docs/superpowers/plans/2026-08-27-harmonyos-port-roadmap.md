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

### 评估后新增批次

#### Batch 5：SQL 工作台（评估结论 #1，已实现）

- [x] `engine/SqlEngine.ets`（新）：`relationalStore`（系统 SQLite）镜像全部数据集（表名规则同 web `safe_table_name`，分批 400 行 `batchInsert`，每次镜像前清空旧表）；只读校验与 web 同款（禁写关键词 + 单语句 + `^select`），`querySql` 截断 1 万行，返回 columns/rows/elapsed/truncated
- [x] `views/SqlWorkbench.ets`（新）：镜像表 chips（点击插入表名）、SQL 编辑器、运行/历史/清空历史、错误横幅、结果 meta（行列数/耗时/截断徽标）、200 行结果网格、「保存为数据集」（`resultToDataFrame` 类型推断复用 InferType）
- [x] 历史：Settings/preferences 持久化 50 条（web parity）
- [x] 入口：命令面板「SQL 工作台」命令（workspaceState.sqlOpen）
- [ ] 二期可选：SQLite 文件导入（picker 拷入沙箱后 open，外来库兼容性待验证）
- [x] 验证：`devecocli build` 通过；运行时需真机验证 RDB 镜像/查询链路

#### Batch 6：数据血缘子集 + undo 修复（评估结论 #2，已实现）

- [x] **undo 正确性修复**：旧实现在已变换帧上重放算子（对 filter/sort 等幂等算子碰巧正确，compute/rename/sample/pivot 错误或抛异常）；现从 base 快照重放剩余启用步骤，语义正确
- [x] `TransformStep`（op + enabled + error + rows/colsAfter）替换裸 `TransformOp[]` 历史链；导入/恢复快照时记录 base 深拷贝
- [x] 步骤禁用/启用：重放时跳过；重放抛错的步骤自动禁用并记录错误（链保持一致）
- [x] `LineageView`（新）：DataView 第三切换（表格/快照/血缘）；步骤列表（序号/算子/参数/行列数±delta）；点击步骤预览该时点数据（base 重放 0..N）并与当前 diff（行键 onlyLeft/onlyRight + 数值列均值差异，复用抽取后的 `diffFrames`）
- [x] `DiffResult` diff 逻辑抽取为 `diffFrames(left, right)`，快照 diff 与血缘 diff 共用
- [x] 限制（与评估一致）：血缘仅跟踪当前数据集会话（切换数据集清空，与既有 undo 行为一致）；无跨数据集 DAG/SVG 图；大数据集 diff 为 O(n) 全量行键
- [x] 验证：`devecocli build` 通过；SDK 校准——ArkUI `ClickEvent` 无 `stopPropagation`，行选中区与启停按钮改为兄弟节点隔离

#### Batch 7：Excel 导入（评估结论 #3，已实现）

- [x] vendored `xlsx.full.min.js`（SheetJS 社区版 0.20.3，Apache-2.0，~950KB）进 rawfile；`xlsx_bridge.html` 暴露 `parseXlsxBase64(b64, sheet)`（cellDates + 日期归一化为 YYYY-MM-DD）
- [x] `engine/ExcelBridge.ets`（新）：桥回执解码（防御双重 JSON 编码）+ `matrixToDataFrame`（表头去重补名、剔除全空行、复用 InferType 类型推断——与 CSV 解析同引擎）
- [x] DataExplorer：picker 接受 `.xlsx/.xls`（按扩展名路由到桥）；1×1 隐藏 WebView（onPageEnd ready 门控）；文件字节 → Base64Helper → runJavaScript；多工作簿 sheet Select 切换重解析
- [x] 已知限制：超大表（数万行）经 runJavaScript 回传大 JSON 待真机压测；桥回复的双层编码行为需真机确认（已做双向解码防御）
- [x] Parquet 维持拒绝/远期（评估不变）
- [x] 验证：`devecocli build` 通过；真机冒烟（多 sheet xlsx、日期列、大文件）待做

#### Batch 8：图表类型 33/33 全量移植（逐一比对 web encodingToPlotly）

本批后 **33 种图表类型全部本地渲染，占位提示仅对字段配置不足时出现**。逐类型比对（web 语义 → 移植实现）：

| 类型 | web 语义要点 | 移植状态 |
|---|---|---|
| line/step/area/dot/scatter | multi-Y + color 拆分 + 右轴/归一化 | ✅ Batch 1 |
| bar/barh | 同上 + orientation | ✅ Batch 1 |
| waterfall | x/y 聚合 + measure:'relative' | ✅ 本批补 measure |
| pie | color=标签 y=值（无 color 时 web 返回空） | ✅（无 color 回退 X，比 web 宽松） |
| funnel | y=阶段（首次出现序）x=聚合值 | ✅ 本批修正（旧实现误用 pie labels/values） |
| histogram | 原始值分箱 + histnorm/cumulative | ✅ |
| box/violin | color 分组；violin 加 box_visible/meanline_visible | ✅ 本批补 violin 两字段 |
| ecdf | 排序累计占比 + color 分组 | ✅ |
| heatmap/contour | pivot(x,y,z) 矩阵 | ✅ |
| density_heatmap/contour | histogram2d(contour) + **原始 x/y**（无需 z） | ✅ 本批修正（旧实现误要求 z） |
| radar | scatterpolar 闭合 + polar.bgcolor | ✅ 本批补 polar |
| scatter3d | x/y/z 数值 + 颜色类别色阶 + layout.scene | ✅ 本批 |
| surface | web 前端留空（靠后端）；pivot 矩阵→surface | ✅ 本批（超越 web 前端） |
| splom | 数值维度矩阵（默认取数值列≤8）+ 颜色索引 | ✅ 本批 |
| parcoords | 数值维度 + 颜色色阶 | ✅ 本批 |
| parcats | 文本维度（默认取文本列≤6） | ✅ 本批 |
| treemap/sunburst/icicle | path 层级聚合 + branchvalues total | ✅ 本批（新增 path 层级选择 UI） |
| sankey | source/target + y 聚合，node/link | ✅ 本批（新增 source/target 选择 UI） |
| ternary | scatterternary a/b/c + color 分组 + 三轴标题 | ✅ 本批 |
| table | 全列字符串 cells + 深色 header/cells | ✅ 本批 |
| gantt | options.start/end + 横条 base/时长 + color 分组 + xaxis date | ✅ 本批（新增开始/结束选择 UI） |
| candlestick | options O/H/L/C 列（默认列名 open/high/low/close）+ x | ✅ 本批（新增 OHLC 选择 UI） |
| timeline | 散点 + xaxis date | ✅ 本批 |

配套改动：`ChartEncoding` 增 `path/source/target`，`ChartOptions` 增 start/end/OHLC 字段（含 clone 与项目 JSON 持久化）；EncodingPanel 按类型出现层级路径 chips、Sankey 端点、甘特起止、K线 OHLC 配置段。

仍不移植的**修饰项**（非图表类型，后续按需）：facet 子图网格、scatter marginal、heatmap corr/annotated 模式、barmode 栈叠 UI。

#### Batch 9：数据页四功能面板（清洗/洞察/统计/变换，对齐 main DataView）

main 的 DataView 结构：左侧视图 tab（table/lineage/snapshots/sql）+ 右侧 40px 图标栏 + 单开 288px 面板（cleaning/insights/stats/transform/columns）。本批对齐：

- [x] DataView 重构：右侧图标栏（5 按钮）+ 单开面板（标题栏+关闭）；SQL 以 tab chip 打开既有浮层；CenterArea 移除旧 288 堆叠栏
- [x] **CleaningPanel（新）**：质量扫描（本地 computeQualityReport）、缺失/重复摘要、安全修复计划（数值缺失填 0 + 去重）预览（模拟 clone 计算行列 delta）与一键应用、列级质量统计表（缺失%/唯一/范围）、我的配方（transformHistory 存 Preferences，应用/删除）+ 去重/去缺失预设
- [x] **InsightsPanel 重写**：环比时序工作台（时间列分组求和 + MoM% + MA3 + 异常高亮，web tsResult 子集）、本地叙述摘要（LLM 接入位）、五类分析洞察卡（趋势/集中度/偏态/相关性/缺失，evidence k=v）
- [x] **StatsPanel（新）**：Pearson 相关矩阵（≤8 数值列，正蓝负红背景色阶 + 最强对文本）、一元线性回归（OLS slope/intercept/R² + 解读）、两组差异检验（Welch t，正态近似显著性，已标注）、均值 95% 置信区间
- [x] **TransformPanel 补齐**：计算字段改为**表达式**（本地递归下降求值器：列名/数字/+-*/%/括号/一元负号，空值传播，字段 chips 插入 + 前 5 行预览）；新增 **join** 段（右数据集/关联键/inner-left；TransformOps 新增 joinFrames 哈希连接 + DataState 分支处理）
- [x] 持久化：Settings 新增 recipes 存取
- [x] 验证：`devecocli build` 通过；设备掉线，重连后覆盖安装复验
- 修饰项差异（记录）：质量修复不含离群值处理；列级质量表无 samples 展开；洞察叙述暂为本地摘要

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
