# Feature Specification: MetricStudio 鸿蒙全量移植（基于 main 分支）

**Created**: 2026-08-19
**Status**: Approved
**Input**: 用户要求"基于 main 分支移植好功能和 UI"，在已有核心壳基础上全量移植 main（v0.2.0）功能。

## Overview

将 MetricStudio Web 桌面版（main 分支，React 19 + Tauri + Python FastAPI + Plotly）的**完整功能与 UI** 像素级移植到 HarmonyOS 原生应用（ArkTS/ArkUI，Stage 模型）。当前已完成工程骨架与核心壳（标题栏/活动栏/侧栏/主区域/状态栏），本次移植全部业务功能：数据导入与表格、变换引擎、图表构建与渲染、Dashboard、洞察/质量报告、i18n 双语言。由于 HarmonyOS 无法运行 Python 后端与 Tauri 壳，所有数据计算改为**纯 ArkTS 本地引擎**；**图表渲染沿用 WebView + 本地 Plotly.js**（与 Web 版完全一致，33 种图表类型全量可用，像素级对齐）。

## User Scenarios & Testing

### User Story 1 - 导入数据并查看表格（P1）

用户导入 CSV（文件选择/文本粘贴/示例数据）后，在数据视图看到带列类型徽章的表格，可排序、分页查看。

**Why this priority**: 数据是分析链路的基础，其余功能全部依赖数据集。

**Independent Test**: 导入示例数据 → 数据表格显示 128 行 × 5 列，列类型推断正确（数值/文本/日期）。

**Acceptance Scenarios**:
1. **Given** 应用启动无数据集，**When** 用户点击"开始示例"，**Then** 载入示例数据并切换到数据视图，表格渲染 128 行 5 列。
2. **Given** 已载入数据集，**When** 用户点击列头排序，**Then** 表格按该列升/降序排列。
3. **Given** 数据集列表存在多个数据集，**When** 点击其中一个，**Then** 主区域表格切换为该数据集。

---

### User Story 2 - 变换算子（清洗/排序/筛选/聚合）（P2）

用户对数据集执行去重、填缺失值、排序、筛选、聚合等变换，变换历史可撤销。

**Why this priority**: 数据准备是分析前置步骤，复用旧端口 TransformOps 引擎。

**Independent Test**: 对示例数据执行"按类别分组求和"，表格更新为聚合结果。

**Acceptance Scenarios**:
1. **Given** 已载入数据集，**When** 在变换面板选择"分组聚合"，**Then** 生成新数据预览且表格更新。
2. **Given** 执行了多次变换，**When** 点击撤销，**Then** 恢复到上一步状态。

---

### User Story 3 - 构建并渲染图表（P2）

用户从图表标签页新建图表，选择类型与字段编码（X/Y/颜色），图表画布实时渲染。

**Why this priority**: 可视化是核心分析能力。图表渲染沿用 Web 方案：**ArkUI Web 组件加载本地 rawfile（plotly.html + plotly.min.js）**，通过 `runJavaScript('renderFigure(figJson)')` 注入 figure，33 种 Plotly 图表类型全量可用，与 Web 版像素级一致。

**Independent Test**: 新建折线图，X=日期列、Y=数值列聚合 sum → 图表画布渲染折线。

**Acceptance Scenarios**:
1. **Given** 已载入数据集，**When** 点击"+"新建图表并选折线图，**Then** 图表画布渲染出折线。
2. **Given** 图表标签页打开，**When** 修改编码（改 X 字段），**Then** 图表实时刷新。

---

### User Story 4 - Dashboard（P3）

用户创建 Dashboard，添加 KPI 卡片与图表，全局筛选联动刷新。

**Why this priority**: Web 0.2.0 新增的核心交互视图，优先级 P3（在数据与图表之后）。

**Independent Test**: 创建 Dashboard 并添加图表 → 网格渲染；改筛选条件 → 卡片数值联动。

**Acceptance Scenarios**:
1. **Given** 已有图表，**When** 切换到 Dashboard 标签并添加图表，**Then** 图表网格渲染。
2. **Given** Dashboard 含数值卡片，**When** 修改全局筛选，**Then** 卡片与图表联动刷新。

---

### User Story 5 - 洞察与质量报告（P3）

系统对数据集生成本地启发式洞察（缺失/离群/趋势）与质量报告（缺失单元格/重复行）。

**Why this priority**: Web 0.2.0 的 AI 面板无本地 LLM，改为本地统计规则。

**Independent Test**: 打开洞察面板 → 显示缺失值统计与清洗建议。

**Acceptance Scenarios**:
1. **Given** 已载入数据集，**When** 打开洞察面板，**Then** 显示基于本地统计的洞察条目。
2. **Given** 数据集含缺失值，**When** 查看质量报告，**Then** 报告列出缺失单元格数与建议。

---

### Edge Cases

- 空数据集（0 行）：表格显示空态提示，图表不可用。
- 非数值列用于聚合：提示错误并回退。
- 超大文件（>10 万行）：限制导入并提示。
- CSV 解析异常（引号/编码问题）：显示导入错误 Toast。
- 深色/浅色主题切换：令牌整体切换。
- 语言切换 zh/en：全部界面文案联动。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 支持 CSV 导入（文件选择器 + 文本粘贴 + 内置示例数据），CSV 解析符合 RFC4180。
- **FR-002**: 系统 MUST 对每列做类型推断（number/date/string → quantitative/nominal/temporal）并显示类型徽章。
- **FR-003**: 系统 MUST 在数据视图渲染表格：列头排序、分页（每页 ≤100 行）、行数/列数显示。
- **FR-004**: 系统 MUST 支持数据集列表（多数据集切换、激活高亮、删除、行数徽章）。
- **FR-005**: 系统 MUST 提供变换引擎：去重、填缺失值、类型转换、排序、筛选、重命名、分组聚合、计算列；支持撤销。
- **FR-006**: 系统 MUST 提供图表构建：新建/复制/删除图表、类型选择（Plotly 33 种全量）、字段编码（X/Y/颜色/聚合）、图表标签页；**图表渲染 MUST 使用 ArkUI Web 组件加载本地 plotly.min.js，通过 runJavaScript 注入 figure 数据**，与 Web 版像素级一致。
- **FR-007**: 系统 MUST 提供 Dashboard：创建、添加图表/文本/KPI 卡片、网格布局、全局筛选联动。
- **FR-008**: 系统 MUST 提供本地洞察与质量报告（缺失单元格、重复行、列统计、清洗建议）。
- **FR-009**: 系统 MUST 支持中英文双语言切换与暗/亮主题切换。
- **FR-010**: 系统 MUST 在状态栏显示数据集行×列、引擎、语言切换与版本号。

### Key Entities

- **DataFrame**: 内存数据表（name、columns: ColumnMeta[]、rows: CellValue[][]、行/列计数）。
- **ColumnMeta**: 列元数据（name、dtype、inferredType: quantitative/nominal/temporal、nullable）。
- **ChartConfig**: 图表配置（id、name、datasetId、encoding: ChartEncoding、layout）。
- **ChartEncoding**: 编码（chartType、x、yFields[]、color、size、facet、options）。
- **DashboardConfig**: Dashboard 配置（id、name、items[]：chart/text/kpi）。
- **KpiCard**: KPI 卡片（id、title、column、aggregate、color）。
- **TransformOp**: 变换算子（type、params、timestamp），支持撤销栈。
- **Insight/QualityIssue**: 洞察条目与质量问题（severity、title、detail、suggestions）。

## Success Criteria

### Measurable Outcomes

- **SC-001**: 导入示例数据后，数据表格在 1 秒内渲染完成。
- **SC-002**: 图表编码修改后画布在 500ms 内刷新。
- **SC-003**: 变换操作在 10 万行以内数据集上 ≤2 秒完成。
- **SC-004**: 壳与各功能页面布局尺寸/颜色与 Web 版像素对齐（对照截图评审）。
- **SC-005**: 应用在设备上构建、安装、启动无崩溃，主流程（导入→变换→图表→Dashboard）可用。

## Assumptions

- HarmonyOS 端无 Python 后端 → 全部计算为 ArkTS 本地实现。
- 图表渲染使用 WebView + 本地 Plotly.js（rawfile），33 种图表类型全量可用；复用旧端口 plotly.html/plotly.min.js 与 ChartData/PlotlySpec 引擎。
- 数据规模 ≤10 万行，内存全量加载 + 同步处理。
- AI/洞察用本地统计规则替代 LLM。
- 复用旧端口（harmonyos-port-old-backup 分支）已移植的引擎代码（DataFrame/CsvParser/TransformOps 等）。
- 项目保存/加载（.metricstudio 文件）与快照/差异属 P3 之后，本期可延后。

## Open Questions

- 无（范围与方案已确认）。
