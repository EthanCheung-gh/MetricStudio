# MetricStudio — 设计规范

> 基于 Plotly 的个人数据分析桌面工具
> 日期: 2026-07-17
> 状态: 已审批

---

## 1. 项目概述

MetricStudio 是一个面向个人数据分析师的专业桌面工具。它以 **Plotly JSON** 作为统一图表配置格式，将数据导入 → 数据清洗 → 图表构建 → 导出报告整合为一个深度一体化的桌面应用。

### 核心理念

- **高自由度** — IDE 式可拖拽面板布局，用户自定义工作区
- **Plotly JSON 优先** — 所有图表以标准 Plotly JSON 存储、交换、导出
- **双引擎** — Pandas（兼容）+ Polars（性能），用户可以按场景切换
- **渐进式** — MVP 走通核心闭环，后续逐步扩展仪表盘和数据源

---

## 2. 技术栈

### 总体架构

```
Tauri Shell (Rust)
├── Frontend: React + TypeScript (Tauri WebView)
└── Backend: Python FastAPI (Sidecar 进程)
    通信: HTTP REST API (localhost 随机端口)
```

### 详细组件

| 层级 | 技术 | 版本建议 |
|------|------|---------|
| **桌面壳** | Tauri 2.x | Rust 运行时 |
| **前端框架** | React 18 + TypeScript 5.x | Vite 5 |
| **UI 组件库** | NextUI + Tailwind CSS | 最新 |
| **状态管理** | Zustand | 最新 |
| **图表渲染** | Plotly.js + react-plotly.js | 2.x |
| **拖拽** | @dnd-kit | 最新 |
| **数据表格** | @tanstack/react-table | v8 |
| **面板布局** | react-resizable-panels | 最新 |
| **图标** | lucide-react | 最新 |
| **后端框架** | FastAPI + uvicorn | 0.110+ |
| **数据处理** | Pandas + Polars | 双引擎并存 |
| **数据清洗** | D-Tale (headless API) | 复用操作引擎 |
| **元数据库** | SQLite + SQLAlchemy | 内置 |
| **包管理** | pnpm (前端) + uv/poetry (后端) | 最新 |

---

## 3. 系统架构

### 3.1 进程模型

```
┌──────────────────────────────────────────────────────────────┐
│                    Tauri Shell (Rust)                         │
│                                                              │
│  ┌────────────────────────────┐  ┌────────────────────────┐  │
│  │     WebView 进程            │  │  Python Sidecar 进程    │  │
│  │     (React + TypeScript)   │  │  (FastAPI + uvicorn)    │  │
│  │                            │  │                         │  │
│  │  • UI 渲染                 │  │  • 数据导入/导出         │  │
│  │  • 图表构建交互             │  │  • 数据清洗操作链        │  │
│  │  • 面板布局管理             │  │  • 聚合计算             │  │
│  │  • 项目文件管理             │  │  • 元数据存储           │  │
│  │  • 导出 PNG/HTML           │  │  • Python 脚本生成      │  │
│  └──────────┬─────────────────┘  └──────────┬─────────────┘  │
│             │          HTTP REST            │                │
│             └────────────────────────────────┘               │
│                        127.0.0.1:随机端口                     │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 进程生命周期

```
Tauri 启动
  ├── 检测 Python 解释器 (venv → system → conda)
  ├── 启动 uvicorn (subprocess, 绑定随机端口)
  ├── 等待 /health 返回 200 (超时 10s)
  ├── 通过 Tauri command 传递端口给前端
  ├── 前端初始化 API Client
  │
  ├── [运行时] 前端 ↔ 后端 API 通信
  ├── [运行时] 健康检查 (每 30s)
  │
  └── 窗口关闭
      ├── 前端持久化工作区状态
      ├── Tauri 发送 SIGTERM 给 sidecar
      └── 等待 sidecar 退出 (超时 5s)
```

### 3.3 进程恢复

若 Python sidecar 意外退出：
1. 前端检测到 /health 不响应 (连续 3 次失败)
2. 显示"后端连接中断"横幅（非破坏性）
3. 自动重启 sidecar 进程
4. 恢复后重新加载数据状态（操作链从 SQLite 重建）

---

## 4. 核心数据流

```
 ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌───────────┐    ┌─────────┐
 │         │    │           │    │          │    │           │    │         │
 │ 导入文件 │───▶│ 数据清洗   │───▶│ 图表构建  │───▶│ 属性微调   │───▶│ 导出保存 │
 │         │    │           │    │          │    │           │    │         │
 │ CSV/    │    │ 过滤/排序  │    │ 拖拽字段  │    │ 颜色/字体  │    │ Plotly  │
 │ Excel/  │    │ 去空/类型  │    │ 映射通道  │    │ 轴/图例   │    │ JSON    │
 │ Parquet │    │ 统计摘要  │    │ 图表选择  │    │ 注释/布局  │    │ PNG/    │
 │         │    │           │    │          │    │           │    │ HTML    │
 └─────────┘    └───────────┘    └──────────┘    └───────────┘    └─────────┘
      │               │               │               │               │
      ▼               ▼               ▼               ▼               ▼
  DataFrame       DataFrame       Plotly JSON     Plotly JSON     Plotly JSON
```

### 数据不可变原则

- 原始导入数据**只读不修改**
- 每次清洗操作生成新的派生 DataFrame（操作 ID 版）
- 操作链完整记录在 `metadata.db`，支持回放和撤销

---

## 5. 前端设计

### 5.1 布局

IDE 式可拖拽面板，基于 `react-resizable-panels`：

```
┌─────────────────────────────────────────────────────────┐
│  ┌───── TitleBar (自定义深色) ───────────────────────┐  │
│  ├──────────┬─────────────────────────┬──────────────┤  │
│  │ 左侧面板  │      中央区域           │  右侧面板     │  │
│  │ (可折叠)  │  (主工作区)             │  (可折叠)     │  │
│  │          │                         │              │  │
│  │ 数据     │  数据视图 / 图表画布     │  Chart       │  │
│  │ 浏览器   │  (Tab 切换)             │  Builder     │  │
│  │          │                         │  字段拖拽    │  │
│  │ 文件列表  │                         │  图表类型    │  │
│  │          │                         │              │  │
│  │ DataFrame│                         │  属性编辑器  │  │
│  │ 列表     │                         │  布局/轴/色  │  │
│  │          │                         │              │  │
│  ├──────────┴─────────────────────────┴──────────────┤  │
│  │  StatusBar (数据量 / 引擎状态 / Python 连接状态)   │  │
│  └─────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

所有面板支持：
- 拖拽调整大小（分隔条）
- 折叠/展开（点击标题栏）
- 弹出独立窗口（拖出面板）

### 5.2 前端状态管理 (Zustand)

| Store | 内容 | 持久化 |
|-------|------|--------|
| `dataStore` | 已加载 DataFrame 列表、列元数据、当前活动数据集 | 否 |
| `chartStore` | 工作区图表列表、当前编辑图表、图表历史 | 是 |
| `workspaceStore` | 面板布局、Tab 状态、主题偏好 | 是（localStorage） |
| `uiStore` | 模态框、通知、侧边栏状态 | 否 |

### 5.3 视觉风格

- **主题**: 深色优先，随系统自动切换
- **字体**: 系统无衬线字体栈 (Inter/SF Pro/Noto Sans)
- **间距**: 紧凑模式（适合数据工具）
- **色彩**: NextUI 默认深色主题 + 自定义 Plotly 色板
- **动画**: 克制使用，仅面板展开/折叠和图表过渡

---

## 6. Chart Editor（图表编辑器）

图表编辑器是 MetricStudio 的核心交互界面，融合**拖拽构建**与**属性面板**两种模式。

### 6.1 拖拽构建流程

1. 用户选择数据源 → 左侧字段列表自动填充
2. 用户从字段列表拖拽字段到编码通道（X/Y/Color/Size/Facet）
3. 系统根据字段类型自动推荐图表类型
4. 用户选择或切换图表类型（保留已有字段映射）
5. 实时渲染 Plotly 图表
6. 属性面板显示当前图表可调参数

### 6.2 编码映射引擎

核心数据结构：

```typescript
interface Encoding {
  x?: EncodingChannel;
  y?: EncodingChannel;
  color?: EncodingChannel;
  size?: EncodingChannel;
  facet?: EncodingChannel;
  chartType: ChartType; // 'line' | 'bar' | 'scatter' | 'pie' | 'histogram' | 'box'
}

interface EncodingChannel {
  field: string;      // 字段名
  type: 'quantitative' | 'nominal' | 'temporal';
  aggregate?: 'sum' | 'mean' | 'count' | 'min' | 'max' | null;
  bin?: boolean;
}
```

Encoding → Plotly JSON 转换规则：

| Encoding 模式 | 输出 trace 类型 | 示例 |
|--------------|----------------|------|
| X(temporal) + Y(quantitative) | scatter (mode: 'lines+markers') | 折线图 |
| X(nominal) + Y(quantitative) | bar | 柱状图 |
| X(quantitative) + Y(quantitative) | scatter | 散点图 |
| color(nominal), 无位置 | pie | 饼图 |
| Y(quantitative), 无 X | histogram | 直方图 |
| Y(quantitative) + color(nominal) | box | 箱线图 |

### 6.3 属性面板

属性面板分为以下区块（可折叠）：

- **图表布局** — 标题、宽高、边距、背景色、主题
- **X 轴** — 标签、范围、刻度格式、旋转角度、网格线、对数轴
- **Y 轴** — 标签、范围、刻度格式、单位、对数轴
- **图例** — 位置、方向、字号、标题
- **颜色** — 全局色板选择、单 trace 颜色覆盖
- **字体** — 全局字体、标题字号、轴标签字号
- **注释** — 文本标注、公式标注、箭头标注

所有属性修改实时反映在 Plotly 预览中。

### 6.4 支持的图表类型 (MVP)

1. 折线图 (line)
2. 柱状图 (bar)
3. 散点图 (scatter)
4. 饼图 (pie)
5. 直方图 (histogram)
6. 箱线图 (box)

每种图表类型支持:
- 单系列 / 多系列（通过 color 编码自动拆分）
- 分组 / 堆叠（柱状图）
- 聚合函数选择（求和/均值/计数/最小/最大）

---

## 7. 后端设计

### 7.1 API 端点

```
# 健康检查
GET  /health

# 数据管理
POST /api/v1/data/import          # 导入文件
GET  /api/v1/data/list            # 列出 DataFrame
GET  /api/v1/data/{id}            # 获取 DataFrame 元数据
GET  /api/v1/data/{id}/preview    # 预览 (前 N 行)
GET  /api/v1/data/{id}/columns    # 列信息
GET  /api/v1/data/{id}/describe   # 统计摘要
DELETE /api/v1/data/{id}          # 卸载

# 数据清洗
POST /api/v1/transform/{id}/filter       # 过滤
POST /api/v1/transform/{id}/sort         # 排序
POST /api/v1/transform/{id}/dropna       # 去空
POST /api/v1/transform/{id}/fillna       # 填充
POST /api/v1/transform/{id}/rename       # 重命名列
POST /api/v1/transform/{id}/dtype        # 类型转换
POST /api/v1/transform/{id}/compute      # 计算列
GET  /api/v1/transform/{id}/history      # 操作历史
POST /api/v1/transform/{id}/undo         # 撤销

# 图表
POST /api/v1/chart/preview       # 数据聚合 + 返回预览 JSON
POST /api/v1/chart/aggregate     # 自定义聚合计算
GET  /api/v1/chart/templates     # 模板列表
POST /api/v1/chart/templates     # 保存为模板

# 项目
POST /api/v1/project/save        # 保存 .metricstudio
POST /api/v1/project/load        # 加载 .metricstudio
POST /api/v1/project/export/html # 导出 HTML 报告
POST /api/v1/project/export/png  # 导出 PNG 图片
```

### 7.2 Python Sidecar 内部结构

```
backend/
├── main.py                    # FastAPI 应用入口 + 生命周期
├── api/
│   ├── __init__.py
│   ├── data.py                # 数据导入路由
│   ├── transform.py           # 清洗操作路由
│   ├── chart.py               # 图表路由
│   └── project.py             # 项目存储路由
├── core/
│   ├── __init__.py
│   ├── engine.py              # Pandas/Polars 引擎抽象
│   ├── session.py             # 操作链管理
│   └── dataframe.py           # DataFrame 包装器
├── dtale_wrapper/
│   ├── __init__.py
│   ├── operations.py          # D-Tale 操作封装
│   └── stats.py               # 统计函数
├── models/
│   ├── __init__.py
│   ├── data.py                # 数据 Pydantic 模型
│   ├── transform.py           # 清洗参数模型
│   └── chart.py               # 图表参数模型
└── requirements.txt
```

### 7.3 数据清洗操作链

```
DataFrame 发布时:
  - 分配唯一 ID (uuid)
  - 创建操作链: []
  - 存储原始 DataFrame

执行操作时:
  1. 从操作链获取上一个状态（或从头重建）
  2. 应用当前操作
  3. 将操作加入链: [op1, op2, ...]
  4. 返回操作后的 preview

撤销:
  - truncate 操作链到目标位置
  - 从头重放到目标状态

操作链持久化:
  - 每个操作序列化为 JSON (操作类型 + 参数)
  - 保存在 metadata.db 或项目文件的 transforms/ 目录
  - 项目加载时按顺序回放操作链重建数据状态
```

### 7.4 双引擎策略

```python
class DataEngine:
    """Pandas / Polars 双引擎抽象层"""
    
    def __init__(self, engine: Literal['pandas', 'polars'] = 'auto'):
        # auto: <1M rows → pandas, >=1M rows → polars
        self.engine = engine
    
    def read_csv(self, path: str) -> DataFrame:
        # 根据引擎调用 pd.read_csv 或 pl.read_csv
    
    def filter(self, df, condition) -> DataFrame:
        # 统一 filter 接口
```

用户可以在设置中手动切换引擎，也可以让系统根据数据量自动选择。

---

## 8. D-Tale 集成

### 8.1 集成策略

不复用 D-Tale 的 UI（Flask/Jinja），只复用其**后端操作引擎**：

| D-Tale 模块 | 使用方式 |
|-------------|---------|
| `dtale.describe()` | 统计摘要 API |
| `dtale.column_builder` | 列计算/变换 |
| `dtale.reshapers` | 透视表 / melt |
| `dtale.code_export` | 操作 → Python 代码 |
| 操作链管理 | 复用 session/history 机制 |
| **UI / 前端** | ❌ 完全自建（React 表格视图） |

### 8.2 D-Tale Wrapper 层

```python
# dtale_wrapper/operations.py

class DTaleOperationWrapper:
    """封装 D-Tale 操作，提供统一接口"""
    
    def filter(df, column, operator, value):
        # 调用 D-Tale 的 filter 逻辑
        # 返回 操作记录 + 结果 DataFrame
    
    def describe(df):
        # 复用 D-Tale 的统计输出
        # 返回格式化统计摘要
```

所有 D-Tale 调用有 try/catch，失败时回退到原生 Pandas/Polars。

---

## 9. 数据存储

### 9.1 项目文件格式 (.metricstudio)

ZIP 压缩包格式：

```
project_name.metricstudio
├── manifest.json
│   ├── name: string
│   ├── version: string
│   ├── created_at: ISO datetime
│   ├── engine: "pandas" | "polars"
│   └── data_sources: [{id, name, path, rows, cols}]
│
├── data/                     # 原始数据副本 (可选)
│   ├── {source_id}.parquet
│   └── ...
│
├── transforms/
│   ├── {source_id}.json      # 操作链
│   └── ...
│
├── charts/
│   ├── {chart_id}.json       # Plotly Figure JSON
│   └── ...
│
└── metadata.db               # SQLite: 列标签/备注/设置
```

### 9.2 本地配置目录

```
~/.metricstudio/
├── preferences.json           # 全局偏好
├── themes/                    # 自定义主题
│   └── user_dark.json
├── templates/                 # 图表模板
│   └── monthly_report.json
└── recent_projects.json       # 最近打开的项目
```

### 9.3 导出格式

| 格式 | 内容 | 实现 |
|------|------|------|
| Plotly JSON | 单图表 | `JSON.stringify(figure)` |
| PNG | 静态图 | Plotly.js `toImage()` |
| SVG | 矢量图 | Plotly.js `toImage('svg')` |
| HTML | 自包含报告 | Plotly.js `toHTML()` + 嵌入式 Plotly.js CDN |
| Python 脚本 | 可复现代码 | 操作链 → Python 代码生成 |

---

## 10. 组件树（前端）

```
<App>
  <AppShell>
    <TitleBar />                    ← Tauri 无边框窗口 + 自定义标题栏
    <WorkspaceLayout>               ← react-resizable-panels
      ├── <LeftPanel collapsible>
      │   ├── <DataExplorer />      ← 文件系统浏览器
      │   └── <DatasetList />       ← 已加载 DataFrame 列表
      ├── <CenterArea>
      │   ├── <TabBar />            ← 数据视图 / 图表画布 Tab
      │   ├── <DataView />          ← 表格 + 统计摘要
      │   │   ├── <DataTable />     ← @tanstack/react-table
      │   │   └── <ColumnStats />   ← 列统计
      │   └── <ChartCanvas />       ← 图表画布
      │       └── <PlotlyRenderer /> ← react-plotly.js
      └── <RightPanel collapsible>
          ├── <ChartBuilder />      ← 拖拽构建
          │   ├── <FieldList />     ← 字段拖拽源
          │   ├── <EncodingPanel /> ← 编码通道
          │   ├── <ChartTypeSelector /> ← 图表类型
          │   └── <AggregationSelector />
          └── <PropertyEditor />    ← 属性面板
              ├── <LayoutSection />
              ├── <AxisSection />
              ├── <LegendSection />
              ├── <ColorSection />
              └── <AnnotationSection />
    </WorkspaceLayout>
    <StatusBar />                   ← 底部状态栏
  </AppShell>
</App>
```

---

## 11. 第一期 (MVP) 范围

### 包含的功能

1. **项目脚手架** — Tauri 壳 + React 前端 + Python sidecar 基础通信
2. **布局系统** — 三面板 IDE 布局，可拖拽调整大小，可折叠
3. **数据导入** — 支持 CSV / Excel / Parquet 本地文件
4. **数据预览** — 表格视图 + 列统计摘要 + 数据类型推断
5. **基础清洗** — 过滤 / 排序 / 去空 / 重命名列
6. **Chart Builder** — 字段拖拽 + 6 种图表类型 + 编码映射
7. **Plotly 实时渲染** — react-plotly.js 预览
8. **属性面板** — 布局 / 轴 / 颜色 / 图例 / 标题 的基本编辑
9. **保存/加载** — .metricstudio 项目文件
10. **导出** — PNG / HTML 单图表

### 不包含（第二期）

- 高级清洗（透视表 / melt / 合并）
- 多表关联 (JOIN)
- 操作撤销/重做
- 图表模板系统
- 报告导出（多图表）
- 数据库连接器
- Vizro 仪表盘集成

### 依赖验证

启动时验证关键依赖可用性：
- Python 3.10+
- `pandas` / `polars` / `fastapi` / `uvicorn` / `dtale`
- Node.js 环境（Tauri dev 模式）

---

## 12. 技术风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| Tauri + Python sidecar 进程管理 | 启动复杂，崩溃恢复 | 健康检查 + 自动重启 + 用户可见状态指示 |
| D-Tale 依赖过重 | 安装体积大，版本冲突 | Pin 版本，隔离 venv，备选回退 |
| Plotly.js 在大数据下性能 | 渲染卡顿 | 数据采样/分页，WebGL 模式，内存管理 |
| Chart Builder 交互复杂度高 | 开发周期长 | MVP 只做 6 种图表，增量扩展 |
| 跨平台兼容（macOS/Windows/Linux） | 路径/编码问题 | CI 三平台测试，Tauri 原生跨平台 |

---

## 13. 组件源代码目录结构（第一期）

```
metricstudio/
├── src-tauri/
│   ├── src/main.rs
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── icons/
│
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css                 # Tailwind + NextUI 样式
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx
│   │   │   ├── TitleBar.tsx
│   │   │   ├── WorkspaceLayout.tsx
│   │   │   ├── LeftPanel.tsx
│   │   │   ├── RightPanel.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── data/
│   │   │   ├── DataExplorer.tsx
│   │   │   ├── DatasetList.tsx
│   │   │   ├── DataView.tsx
│   │   │   ├── DataTable.tsx
│   │   │   └── ColumnStats.tsx
│   │   ├── chart/
│   │   │   ├── ChartCanvas.tsx
│   │   │   ├── PlotlyRenderer.tsx
│   │   │   ├── ChartBuilder.tsx
│   │   │   ├── FieldList.tsx
│   │   │   ├── EncodingPanel.tsx
│   │   │   ├── ChartTypeSelector.tsx
│   │   │   └── PropertyEditor.tsx
│   │   └── common/
│   │       ├── TabBar.tsx
│   │       ├── ErrorBoundary.tsx
│   │       └── LoadingSpinner.tsx
│   ├── stores/
│   │   ├── dataStore.ts
│   │   ├── chartStore.ts
│   │   ├── workspaceStore.ts
│   │   └── uiStore.ts
│   ├── hooks/
│   │   ├── useApi.ts
│   │   ├── useDataFrame.ts
│   │   └── useChartBuilder.ts
│   ├── api/
│   │   └── client.ts             # API 客户端
│   ├── types/
│   │   ├── plotly.ts
│   │   ├── data.ts
│   │   └── encoding.ts
│   └── utils/
│       ├── encodingToPlotly.ts   # 核心映射引擎
│       └── chartTemplates.ts
│
├── backend/
│   ├── main.py
│   ├── api/
│   │   ├── __init__.py
│   │   ├── data.py
│   │   ├── transform.py
│   │   ├── chart.py
│   │   └── project.py
│   ├── core/
│   │   ├── __init__.py
│   │   ├── engine.py
│   │   ├── session.py
│   │   └── dataframe.py
│   ├── dtale_wrapper/
│   │   ├── __init__.py
│   │   ├── operations.py
│   │   └── stats.py
│   ├── models/
│   │   ├── __init__.py
│   │   ├── data.py
│   │   ├── transform.py
│   │   └── chart.py
│   └── requirements.txt
│
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── tailwind.config.ts
├── postcss.config.js
├── vite.config.ts
├── index.html
├── .gitignore
└── README.md
```
