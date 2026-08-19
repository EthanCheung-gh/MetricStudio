# Implementation Plan: MetricStudio 鸿蒙全量移植（基于 main 分支）

**Input**: Feature specification from `spec/harmonyos-port/spec.md`

## Summary

在已完成的核心壳基础上，将 main 分支（v0.2.0）的全部业务功能像素级移植到 HarmonyOS：数据导入与表格（纯 ArkTS 引擎）、变换算子、图表构建（**WebView + 本地 Plotly.js 渲染，33 种图表全量**）、Dashboard、本地洞察/质量报告、i18n 双语言。无 Python 后端，全部数据计算在 ArkTS 本地完成；图表渲染复用旧端口已验证的 WebView 方案。

## Technical Context

**Language/Version**: ArkTS（HarmonyOS API 22，Stage 模型）
**Primary Dependencies**: @ohos/hypium（测试）、@kit.ArkWeb（WebView）、@kit.CoreFile（文件选择器）、@kit.ArkData（持久化，可选）
**Storage**: 无后端，数据全量内存驻留；可选用 Preferences 持久化轻量设置（语言/主题）
**Testing**: devecocli build 静态校验 + hypium 引擎单测（DataFrame/CsvParser/TransformOps）
**Target Platform**: HarmonyOS 2in1/tablet/phone（API 22，已含 deviceTypes）
**Project Type**: desktop-analytics-app（HarmonyOS 原生）
**Performance Goals**: 10 万行内变换 ≤2s；表格渲染 1s 内；图表刷新 500ms 内
**Constraints**: 无 Python 后端、无网络 LLM；数据 <10 万行内存全量；图表渲染 WebView 内 plotly.min.js
**Scale/Scope**: ~25 个 .ets 文件；数据/变换/图表/Dashboard/洞察/i18n 六大模块

## Project Structure

### Documentation (this feature)

```text
spec/harmonyos-port/
├── spec.md              # 需求规格（Phase 1）
├── plan.md              # 本文件（Phase 2 架构设计）
└── tasks.md             # 任务分解（Phase 3，待生成）
```

### Source Code (repository root)

```text
entry/src/main/ets/
├── pages/Index.ets                    # 应用壳组装（已有，扩展路由）
├── common/
│   ├── Theme.ets                      # 设计令牌（已有，扩展 light 主题）
│   ├── Locale.ets                     # i18n 键值（已有轻量版，扩展为字典）
│   └── Format.ets                     # 数值/日期格式化（复用旧端口）
├── model/
│   ├── WorkspaceState.ets             # 壳状态（已有，扩展）
│   ├── DataFrame.ets                  # 数据模型（复用旧端口）
│   ├── ChartConfig.ets                # 图表配置模型（复用旧端口）
│   └── DataState.ets                  # 数据状态（dataFrames/active/preview）
├── engine/
│   ├── CsvParser.ets                  # CSV 解析（复用旧端口）
│   ├── InferType.ets                  # 类型推断（复用旧端口）
│   ├── TransformOps.ets               # 变换算子（复用旧端口 + 扩展）
│   ├── ColumnStats.ets                # 列统计（复用旧端口）
│   ├── ChartData.ets                  # 图表数据准备（复用旧端口，扩展编码模型）
│   ├── PlotlySpec.ets                 # Plotly figure 构造（复用旧端口，扩展 33 型）
│   ├── Insights.ets                   # 本地洞察/质量报告（新增）
│   └── SampleData.ets                 # 内置示例数据（新增，对齐 main sample_data.csv）
├── views/
│   ├── TitleBar.ets                   # 标题栏（已有）
│   ├── ActivityBar.ets                # 活动栏（已有）
│   ├── LeftPanel.ets                  # 左侧栏（改造：数据探索器/数据集列表/图表列表）
│   ├── RightPanel.ets                 # 右侧栏（改造：属性编辑器/变换面板）
│   ├── CenterArea.ets                 # 主区域（改造：数据/图表/Dashboard 标签页）
│   ├── StatusBar.ets                  # 状态栏（改造：数据集信息/引擎）
│   ├── IconButton.ets                 # 图标按钮（已有）
│   ├── DataView.ets                   # 数据表格视图（复用旧端口改造）
│   ├── DatasetList.ets                # 数据集列表（新增）
│   ├── DataExplorer.ets               # 数据导入器（文件选择/文本粘贴/示例）
│   ├── TransformPanel.ets             # 变换面板（复用旧端口改造）
│   ├── ChartView.ets                  # 图表画布（WebView+Plotly，复用旧端口）
│   ├── EncodingPanel.ets              # 编码面板（新增，适配 33 型）
│   ├── ChartTypeSelector.ets          # 图表类型选择（新增）
│   ├── DashboardView.ets              # Dashboard 视图（新增）
│   └── InsightsPanel.ets              # 洞察/质量面板（新增）
└── resources/base/rawfile/
    ├── plotly.html                    # WebView 宿主页（复用旧端口）
    └── plotly.min.js                  # Plotly 库（取 main 分支 public/plotly.min.js）
```

**Structure Decision**: 单模块（entry）内按 `common/model/engine/views` 分层，与旧端口保持一致；引擎层纯逻辑可单测（hypium），视图层只做渲染与交互。复用旧端口引擎代码可大幅缩短工期。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| WebView 承载 Plotly.js 图表 | 33 种图表类型与 Web 像素级一致，@ohos/charts 仅约 10 种且观感不同 | 纯 Canvas 自绘需重写全部图表逻辑，工作量与风险远超 WebView |
| 无后端纯 ArkTS 引擎 | HarmonyOS 无法运行 Python sidecar；数据计算必须本地化 | 内置 Python 运行时不可行（体积/签名限制） |

## Research & Decisions

- **Decision**: 图表渲染使用 ArkUI `Web` 组件 + 本地 rawfile（plotly.html + plotly.min.js），`WebviewController.runJavaScript('renderFigure(figJson)')` 注入 figure。
  **Rationale**: 旧端口 harmonyos-port-old-backup 已验证此链路可编译运行；与 Web 版 Plotly 渲染像素级一致；33 种图表类型全量可用，无需按类型重写渲染。
  **Alternatives considered**: @ohos/charts（类型少、观感不一致）、Canvas 自绘（工作量大）。
- **Decision**: 数据引擎全部 ArkTS 本地实现（DataFrame/CsvParser/InferType/TransformOps/ColumnStats 复用旧端口）。
  **Rationale**: 旧端口引擎已通过 hypium 单测且语义对齐 Web 后端（pandas 逻辑）。
  **Alternatives considered**: 内置 Python（不可行）。
- **Decision**: 洞察/质量报告用本地统计规则（缺失值/重复行/列分布/离群值/趋势）替代 LLM。
  **Rationale**: 无网络 LLM 依赖；本地规则可离线交付且确定性强。
  **Alternatives considered**: 接入云端 LLM（网络/权限/成本约束）。
- **Decision**: 文件导入用 `@kit.CoreFile` 文件选择器（DocumentViewPicker）选择 CSV，加"文本粘贴"与"内置示例"两个入口。
  **Rationale**: 与 Web 的导入能力对齐（文件/粘贴/示例），DocumentViewPicker 是 Stage 模型标准能力。
  **Alternatives considered**: 只做文本粘贴（体验差）。
- **Decision**: 语言/主题用 Preferences 轻量持久化。
  **Rationale**: 双语言与暗/亮主题切换需记忆用户选择；Preferences 简单可靠。
  **Alternatives considered**: 不做持久化（每次启动重置，体验差）。

## Data Model

### DataFrame（复用旧端口，语义对齐 Web DataFrameMeta/DataPreview）

```ts
class ColumnMeta { name: string; dtype: string; inferredType: 'quantitative'|'nominal'|'temporal'; nullable: boolean }
class DataFrame {
  name: string;
  columns: ColumnMeta[];
  rows: CellValue[][];              // CellValue = string | number | boolean | null
  get rowCount(): number;
  get colCount(): number;
}
```

### ChartConfig / ChartEncoding（对齐 Web src/types/encoding.ts）

```ts
type ChartType = 33 种联合（line/bar/barh/area/step/scatter/dot/.../timeline）
class EncodingChannel { field: string; type: FieldType; aggregate?: AggregateType; bin?: boolean }
class YFieldConfig { field; type; aggregate?; axis: 'left'|'right'; normalize: 'none'|'perSeries'|'global' }
class ChartEncoding {
  x?: EncodingChannel; yFields: YFieldConfig[]; color?; size?; facet?; z?; error?;
  dimensions?: string[]; path?: string[]; source?; target?; options?: ChartOptions; chartType: ChartType;
}
class ChartConfig { id: string; name: string; datasetId: string; encoding: ChartEncoding; }
```

### DashboardConfig（对齐 Web src/types/dashboard.ts）

```ts
class DashboardItem { id: string; type: 'chart'|'text'|'kpi'; chartId?: string; title?: string; column?: string; aggregate?: AggregateType; color?: string; x?: number; y?: number; w?: number; h?: number }
class DashboardConfig { id: string; name: string; items: DashboardItem[] }
```

### TransformOp（变换算子）

```ts
class TransformOp { type: 'dedupe'|'fillMissing'|'convertType'|'sort'|'filter'|'rename'|'aggregate'|'compute'|'dropCol'; params: string; timestamp: string }
```

## Contracts & Interfaces

### WebView ↔ Plotly 契约（沿用旧端口已验证模式）

```ts
// views/ChartView.ets
Web({ src: $rawfile('plotly.html'), controller: this.controller })
  .onPageEnd(() => { this.pageReady = true; this.renderChart(); })
  .domStorageAccess(true)
  .javaScriptAccess(true)

// 注入（figure JSON 由 engine/ChartData.ets + engine/PlotlySpec.ets 构造）
this.controller.runJavaScript('renderFigure(' + figJson + ')');

// rawfile/plotly.html 暴露
// window.renderFigure = function(jsonStr) { Plotly.react(el, fig.data, fig.layout, fig.config) }
```

### 引擎接口（纯逻辑，可单测）

```ts
parseCsv(text: string): DataFrame
inferColumnDtype(values: CellValue[]): 'number'|'date'|'string'
applyTransform(df: DataFrame, op: TransformOp): DataFrame
buildChartData(df: DataFrame, chartType: ChartType, encoding: ChartEncoding): ChartDataset
figureFromChartData(data: ChartDataset, chartType: ChartType, title: string): PlotlyFigure
computeInsights(df: DataFrame): Insight[]
computeQualityReport(df: DataFrame): QualityReport
```

### 数据导入

```ts
// DataExplorer.ets：DocumentViewPicker 选择 .csv → 读取文本 → parseCsv
// 文本粘贴：TextArea 输入 → parseCsv
// 示例数据：engine/SampleData.ets 内置 sample_data.csv 文本 → parseCsv
```

### 状态流转（DataState @Observed）

```ts
class DataState {
  dataFrames: DataFrame[];
  activeIndex: number;         // -1 = 无
  previewRows: CellValue[][];  // 当前页（≤100 行）
  transformHistory: TransformOp[];   // 撤销栈
  applyDataFrame(df: DataFrame): void;   // 更新 dataFrames + active + preview
  importCsvText(name: string, text: string): void;
  applyTransform(op: TransformOp): void; // 计算 → push history
  undo(): void;
}
```
