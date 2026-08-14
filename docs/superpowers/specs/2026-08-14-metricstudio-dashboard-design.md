# MetricStudio 交互式仪表盘（Dashboard）设计规范

> 一屏多图自由布局 + 全局筛选器 + 图表联动 + 布局持久化
> 日期: 2026-08-14
> 状态: 草稿（待审批）
> 前置: 26 种图表类型 ✅、crossfilter 单源联动 ✅、多图表标签页 ✅、.metricstudio 项目保存/加载 ✅

---

## 1. 目标

让 MetricStudio 从「单图分析工具」升级为「分析看板」，用户可以把多个图表自由排列在一个画布上，通过顶部全局筛选器（下拉 / 范围 / 日期）驱动所有图表联动刷新，并把布局 + 筛选器状态随项目一起保存。

**成功标准**：
- 一个 Dashboard 画布同时渲染 N 个图表，可拖拽移动、缩放尺寸
- 顶部筛选器（类别多选 / 数值范围 / 日期范围）作用于画布内所有图表
- 布局、筛选器、图表集合随 `.metricstudio` 项目保存与恢复

---

## 2. 非目标（本期不做）

- Dashboard 内的图表间 brush 联动（复用现有单源 crossfilter，但 Dashboard 首版只保留全局筛选器；brush 联动列为第二期）
- 多数据集混排（一个 Dashboard 内图表可来自不同 dataset，但全局筛选器按 dataset 分组，不做跨数据集 JOIN 语义）
- 布局模板市场 / 分享
- 定时刷新、数据流订阅
- Dashboard 导出为自包含交互式 HTML（第二期，可复用 report 管道）

---

## 3. 现状与差距

| 现状 | 差距 |
|------|------|
| `chartStore.previewFigure` 只缓存**一个**活跃图表 figure | Dashboard 需**多图表同时渲染**，各自持有 figure |
| `chartStore.selection` 是**单一** brush 源 | Dashboard 需**多个全局筛选器**同时生效 |
| 后端 `ChartPreviewRequest.selection` 只接受单个 `SelectionFilter` | 后端需接受 **`filters: list[FilterSpec]`**（range + in 两类） |
| `workspaceStore.activeTab` 只有 `'data' \| 'chart'` | 需新增 `'dashboard'` 视图 |
| `project.py` manifest 只存 `charts` | manifest 需新增 `dashboards` |
| 视图切换为「Data + N 个 Chart Tab」 | 需新增固定「Dashboard」Tab |

---

## 4. 核心数据模型

### 4.1 前端类型（`src/types/dashboard.ts`，新增）

```typescript
export interface DashboardItem {
  chartId: string;          // 引用 chartStore.charts 的 id
  x: number;                // 网格列（0-based）
  y: number;                // 网格行（0-based）
  w: number;                // 占列宽（网格单位）
  h: number;                // 占行高（网格单位）
}

export type DashboardFilterKind = 'category' | 'range' | 'date';

export interface DashboardFilter {
  id: string;
  field: string;            // 数据字段名
  label: string;            // 显示名，缺省用 field
  kind: DashboardFilterKind;
  datasetId: string;        // 作用于哪个数据集
  value: unknown;           // category: string[] | null；range/date: [lo, hi] | null
}

export interface DashboardConfig {
  id: string;
  name: string;
  items: DashboardItem[];
  filters: DashboardFilter[];
  cols: number;             // 网格列数，默认 12
  rowHeight: number;        // 行高 px，默认 80
  createdAt: string;
  updatedAt: string;
}
```

### 4.2 后端模型（`backend/models/chart.py`，修改）

新增通用筛选规格，替换单 `SelectionFilter` 作为 Dashboard 的筛选载体：

```python
class FilterSpec(CBaseModel):
    """One dashboard filter applied to a dataset before aggregation."""
    field: str
    op: Literal["range", "in"] = "range"
    range: Optional[list] = None      # op=range: [lo, hi]
    values: Optional[list] = None     # op=in: 类别值列表（字符串化比较）


class ChartPreviewRequest(CBaseModel):
    dataset_id: str
    encoding: ChartEncoding
    selection: Optional[SelectionFilter] = None   # 保留：现有单源 brush 联动
    filters: Optional[list[FilterSpec]] = None     # 新增：Dashboard 全局筛选器
```

> 兼容性：`selection` 保留不动，现有 ChartCanvas 单源联动不受影响。`filters` 与 `selection` 可同时存在，先 `_filter_by_filters` 再 `_filter_by_selection`。

---

## 5. 前端设计

### 5.1 状态管理（`src/stores/dashboardStore.ts`，新增）

Zustand + persist（localStorage，key `metricstudio-dashboards`）：

```typescript
interface DashboardState {
  dashboards: DashboardConfig[];
  activeDashboardId: string | null;

  createDashboard: () => DashboardConfig;
  removeDashboard: (id: string) => void;
  renameDashboard: (id: string, name: string) => void;
  setActiveDashboard: (id: string | null) => void;

  addItem: (dashboardId: string, chartId: string) => void;
  removeItem: (dashboardId: string, chartId: string) => void;
  moveItem: (dashboardId: string, chartId: string, x: number, y: number) => void;
  resizeItem: (dashboardId: string, chartId: string, w: number, h: number) => void;

  addFilter: (dashboardId: string, filter: Omit<DashboardFilter, 'id'>) => void;
  updateFilter: (dashboardId: string, filterId: string, patch: Partial<DashboardFilter>) => void;
  removeFilter: (dashboardId: string, filterId: string) => void;

  loadDashboards: (dashboards: DashboardConfig[]) => void;   // 项目加载时恢复
}
```

所有更新走不可变引用替换（与现有 store 一致），`updatedAt` 自动刷新。

### 5.2 视图切换（`workspaceStore` + `CenterArea`）

- `activeTab` 类型扩展为 `'data' | 'chart' | 'dashboard'`。
- `CenterArea` 的 Tab Bar 新增固定 **Dashboard Tab**（位于 Data Tab 之后，用 `LayoutDashboard` 图标），点击进入 `DashboardView`。
- `activeTab: 'dashboard'` 时，中心内容渲染 `<DashboardView />`（而非 `DataView` / `ChartCanvas`）。

### 5.3 Dashboard 视图（`src/components/dashboard/DashboardView.tsx`，新增）

结构：

```
┌────────────────────────────────────────────────┐
│  Dashboard 标题 + [+ 加图表] [导出]             │   ← DashboardToolbar
├────────────────────────────────────────────────┤
│  [筛选器1] [筛选器2] ... [+ 加筛选器]           │   ← DashboardFilterBar
├────────────────────────────────────────────────┤
│  网格画布（react-grid-layout）                  │
│  ┌─────────┐ ┌──────────────┐                 │
│  │ 图表卡片 │ │   图表卡片    │                 │
│  └─────────┘ └──────────────┘                 │
│  ┌──────────────────────┐                     │
│  │       图表卡片        │                     │
│  └──────────────────────┘                     │
└────────────────────────────────────────────────┘
```

- `DashboardToolbar`：标题（可重命名）、`+ 加图表`（打开图表选择器，复用 `ChartConfigDialog` 或新增轻量下拉）、导出按钮（第二期）。
- `DashboardFilterBar`：渲染 `dashboards.filters`，每个筛选器一个控件（类别 → 多选下拉；range/date → 范围输入/日期选择），变化即 `updateFilter`。
- 网格画布：`react-grid-layout`，`cols = dashboard.cols`，`rowHeight = dashboard.rowHeight`，`onLayoutChange` 同步 `items` 的 x/y/w/h。

### 5.4 图表卡片（`src/components/dashboard/DashboardChartCard.tsx`，新增）

每个卡片独立渲染，不复用全局 `previewFigure`：

- 接收 `chart: ChartConfig` + `filters: FilterSpec[]`。
- `useEffect` 里 `api.previewChart(chart.datasetId, chart.encoding, filters)` 拉取 figure，本地 `useState<PlotlyFigure>` 缓存。
- `PlotlyRenderer` 复用（关闭 brush：`onSelected` 不接，或第二期接 brush 联动）。
- 卡片右上角：编辑（切到该 chart 的 Chart 视图）、移除（`removeItem`）。
- 筛选器变化 → 依赖数组触发所有卡片重新拉取（可加简单去抖 150ms）。

### 5.5 API 客户端（`src/api/client.ts`，修改）

`previewChart` 签名扩展：

```typescript
previewChart: (datasetId: string, encoding: ChartEncoding, filters?: SelectionFilter[] | FilterSpec[]) =>
  fetchJson<PlotlyFigure>('/api/v1/chart/preview', {
    method: 'POST',
    body: JSON.stringify({ dataset_id: datasetId, encoding, filters }),
  }),
```

> 注意：现有 `chartStore.previewChart` 传入的是单 `selection`（brush 源），保持走 `selection` 字段；Dashboard 卡片走 `filters` 字段。二者互不干扰。

---

## 6. 后端设计

### 6.1 筛选应用（`backend/api/chart.py`，修改）

新增 `_filter_by_filters`，在 `_aggregate` 之前逐条应用：

```python
def _filter_by_filters(df: pd.DataFrame, filters: list["FilterSpec"]) -> pd.DataFrame:
    out = df
    for f in filters or []:
        if f.field not in out.columns:
            continue
        series = out[f.field]
        if f.op == "in":
            vals = set(str(v) for v in (f.values or []))
            out = out[series.astype(str).isin(vals)]
        else:  # range
            lo, hi = f.range[0], f.range[1]
            numeric = pd.to_numeric(series, errors="coerce")
            if numeric.notna().any():
                out = out[(numeric >= float(lo)) & (numeric <= float(hi))]
            else:
                dt = pd.to_datetime(series, errors="coerce")
                if dt.notna().any():
                    out = out[(dt >= pd.to_datetime(lo)) & (dt <= pd.to_datetime(hi))]
    return out
```

`preview_chart` 端点：

```python
df = dataset.df
if request.filters:
    df = _filter_by_filters(df, request.filters)
if request.selection:
    df = _filter_by_selection(df, request.selection)
figure = _aggregate(df, request.encoding)
```

### 6.2 项目持久化（`backend/api/project.py`，修改）

`manifest` 新增 `dashboards`，版本号 `0.2.0 → 0.3.0`：

```python
manifest = {
    "name": name,
    "version": "0.3.0",
    ...
    "charts": charts,
    "dashboards": dashboards,      # 新增：前端传入的 DashboardConfig[]
}
```

`load_project` 返回 `dashboards`，前端 `loadProjectByPath` 调用 `dashboardStore.loadDashboards(...)` 恢复。

---

## 7. 数据流示例

```
用户新建 Dashboard
  → dashboardStore.createDashboard()（空画布）
  → CenterArea 切到 Dashboard 视图

用户点 [+ 加图表] 选 chart-1 / chart-2
  → addItem 两次，items = [{chartId: chart-1, x:0,y:0,w:6,h:4}, {chartId: chart-2, x:6,y:0,w:6,h:4}]
  → 画布渲染两个 DashboardChartCard，各自 api.previewChart(...) 拉取 figure

用户加筛选器「region ∈ {North, South}」（kind=category, datasetId=ds-1）
  → addFilter → filters = [{field: region, op: in, values: [North, South]}]
  → DashboardFilterBar 渲染多选下拉
  → 所有卡片依赖 filters 变化，重新 previewChart（带 filters）

用户调整卡片位置/尺寸
  → react-grid-layout onLayoutChange → moveItem/resizeItem → persist(localStorage)

用户保存项目
  → TitleBar 保存 → 前端把 dashboards 传入 api.saveProject → manifest.dashboards
  → 重新加载 → loadProject 返回 dashboards → dashboardStore.loadDashboards
```

---

## 8. 文件变更

### 新增

| 文件 | 用途 |
|------|------|
| `src/types/dashboard.ts` | DashboardConfig / DashboardItem / DashboardFilter 类型 |
| `src/stores/dashboardStore.ts` | Dashboard 状态 + actions + persist |
| `src/components/dashboard/DashboardView.tsx` | Dashboard 视图（toolbar + filter bar + 网格） |
| `src/components/dashboard/DashboardChartCard.tsx` | 单个图表卡片（独立 figure + PlotlyRenderer） |
| `src/components/dashboard/DashboardFilterBar.tsx` | 筛选器控件（category/range/date） |

### 修改

| 文件 | 改动 |
|------|------|
| `src/stores/workspaceStore.ts` | `activeTab` 扩展 `'dashboard'` |
| `src/components/layout/CenterArea.tsx` | 新增固定 Dashboard Tab + 渲染 `DashboardView` |
| `src/api/client.ts` | `previewChart` 支持 `filters` 参数 |
| `src/utils/project.ts` | 保存/加载 dashboards |
| `backend/models/chart.py` | 新增 `FilterSpec`，`ChartPreviewRequest` 加 `filters` |
| `backend/api/chart.py` | 新增 `_filter_by_filters`，`preview_chart` 应用 filters |
| `backend/api/project.py` | manifest 加 `dashboards`，版本 0.3.0 |

### 依赖

| 依赖 | 用途 | 备注 |
|------|------|------|
| `react-grid-layout` + `@types/react-grid-layout` | 网格拖拽 + resize | 首选；若 React 19 peer 冲突，降级自研轻量网格（CSS Grid + 已有 `@dnd-kit`） |

---

## 9. 分期

### 第一期（核心闭环）

| # | 内容 |
|---|------|
| 1 | `dashboard.ts` 类型 + `dashboardStore` + persist |
| 2 | `FilterSpec` 后端模型 + `_filter_by_filters` + preview 应用 |
| 3 | `api.client.previewChart(filters)` |
| 4 | `DashboardView` + `DashboardChartCard` + `DashboardFilterBar` |
| 5 | workspaceStore/CenterArea 加 Dashboard Tab |
| 6 | 项目 manifest 加 dashboards（save/load） |

### 第二期（增强）

| # | 内容 |
|---|------|
| 7 | Dashboard 内图表间 brush 联动（复用 SelectionFilter，多 brush 源） |
| 8 | 布局模板（保存/应用整块布局） |
| 9 | Dashboard 导出为自包含交互式 HTML（复用 report 管道 + 嵌入 Plotly CDN） |
| 10 | 筛选器一键「清除全部 / 联动高亮」 |

---

## 10. 测试策略

- **后端**（`backend/tests/test_dashboard_filters.py`，新增）：`_filter_by_filters` 对 `range`（数值 + 日期）和 `in`（类别）的过滤正确性；`preview` 同时传 `filters` + `selection` 的组合行为。
- **前端**：`tsc --noEmit`；手动验证拖拽/resize、筛选器联动、项目保存/恢复。

---

## 11. 风险

| 风险 | 缓解 |
|------|------|
| `react-grid-layout` 与 React 19 peer 依赖冲突 | 优先验证；冲突则自研 CSS Grid + @dnd-kit（项目已依赖） |
| 多卡片同时请求后端，性能抖动 | 前端 150ms 去抖 + 卡片级 figure 缓存 + loading 态 |
| 筛选器字段被 dtype 转换后失效 | 筛选器绑定 `datasetId` + `field`，dataset 变更时提示失效 |
| 项目旧 manifest（无 dashboards）加载 | `loadProject` 对缺失字段做空数组兜底，不报错 |
| 布局坐标系跨窗口尺寸变化 | 网格用固定 `cols=12` 相对坐标，`rowHeight` 存 px，随画布缩放自适应 |

---

## 12. 决策摘要

- 新增独立 `dashboardStore`（Zustand + persist），不污染 chartStore
- `activeTab` 扩展为 `'data' | 'chart' | 'dashboard'`，Dashboard 是固定 Tab
- 后端新增 `FilterSpec`（`range` / `in` 两类），`ChartPreviewRequest.filters: list[FilterSpec]`，保留 `selection` 向后兼容
- Dashboard 卡片独立拉取 figure（不复用全局 `previewFigure`）
- 网格布局首选 `react-grid-layout`，备选自研 CSS Grid + @dnd-kit
- Dashboard 布局 + 筛选器随 `.metricstudio` manifest 持久化（version 0.3.0）
- 第一期聚焦「布局 + 全局筛选器 + 持久化」闭环，brush 联动与导出列为第二期
