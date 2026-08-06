# Multi-Y Field & Dual Axis 设计规范

> 在 Chart Builder 中支持多 Y 字段、双轴、归一化与 auto-index X
> 日期: 2026-07-18
> 状态: 草案

---

## 1. 目标

在 MetricStudio Chart Builder 中，用户可以将多个数据字段映射到同一个图表的多条折线/柱状图，支持左右双 Y 轴和归一化显示。同时，当用户未选择 X 轴时，自动使用行号（index）作为 X 轴。

## 2. 非目标

- 多 sheet 联合图表（第二期实现）
- 多 X 轴（单 X 轴双 Y 轴已足够）
- 3D 图表
- 图表叠加类型混排（如折线+柱状混合在同一图表 — 需更复杂的 trace 管理）

## 3. 架构

### 3.1 核心数据结构

当前 `ChartEncoding.y` 是单字段，改为多字段列表：

```typescript
// 新增：Y 轴字段配置
interface YFieldConfig {
  field: string;
  type: FieldType;
  aggregate?: AggregateType;
  axis: 'left' | 'right';          // 绑定到左轴还是右轴
  normalize: 'none' | 'perSeries' | 'global';  // 归一化
  label?: string;                   // 显示名，缺省用 field
}

// 修改后
interface ChartEncoding {
  x?: EncodingChannel;              // 可选 — 不传时 auto-index
  yFields: YFieldConfig[];          // 允许多个 Y 字段
  color?: EncodingChannel;
  size?: EncodingChannel;
  facet?: EncodingChannel;
  chartType: ChartType;             // line / bar / scatter（pie/histogram/box 忽略多 Y）
}
```

```python
# 后端 Pydantic 模型
class YFieldConfig(CBaseModel):
    field: str
    type: Literal["quantitative", "nominal", "temporal"]
    aggregate: Optional[Literal["sum", "mean", "count", "min", "max"]] = None
    axis: Literal["left", "right"] = "left"
    normalize: Literal["none", "perSeries", "global"] = "none"
    label: Optional[str] = None

class ChartEncoding(CBaseModel):
    x: Optional[EncodingChannel] = None  # None → auto-index
    y_fields: list[YFieldConfig] = []
    color: Optional[EncodingChannel] = None
    size: Optional[EncodingChannel] = None
    facet: Optional[EncodingChannel] = None
    chart_type: Literal["line", "bar", "scatter", "pie", "histogram", "box"] = "scatter"
```

### 3.2 后端聚合逻辑（`_aggregate`）

对 `y_fields` 中每个字段，独立聚合，生成独立 trace：

```
for each yf in y_fields:
  1. 如果 X 为空 → 使用行号 range(len(df)) 作为 X
  2. 如果有 aggregate → groupby(x) + agg
  3. 如果有 normalize == 'perSeries' → 除自身 max
  4. 如果有 normalize == 'global' → 除所有 y_fields 中全局 max
  5. 根据 axis 决定绑定 yaxis='y' 或 'y2'
  6. 追加到 data[]
```

Plotly 双轴布局：

```python
layout = {
    "yaxis": {"title": "left axis title", "side": "left"},
    "yaxis2": {
        "title": "right axis title",
        "side": "right",
        "overlaying": "y",
        "anchor": "x",
    },
}
```

### 3.3 前端改动

| 组件 | 改动 |
|------|------|
| `EncodingPanel` | 替换单 Y Select → 多 Y 列表 + 添加/删除按钮 |
| `YFieldConfigRow`（新增） | 单个 Y 字段配置：字段选择、聚合、轴方向、归一化 |
| `PropertyEditor` | 左右轴分别编辑标题/范围 |
| `ChartEncoding` type | `y` → `yFields: YFieldConfig[]` |
| `encodingToPlotly.ts` | 支持多 Y trace 生成 |
| `chartStore` | `updateEncoding` 兼容新结构 |

### 3.4 向后兼容

旧版本 `y` 字段会在加载时自动转为 `yFields: [{field, type, aggregate, axis:'left', normalize:'none'}]`，保证已保存的图表不报错。

---

## 4. 分期

### 第一期：多 Y + 双轴 + auto-index

| # | 内容 | 涉及文件 |
|---|------|---------|
| 1 | 新增 `YFieldConfig` 模型（前后端） | `types/encoding.ts`, `models/chart.py` |
| 2 | 修改 `ChartEncoding`: `y` → `yFields` + 向后兼容 | 同上 |
| 3 | 后端 `_aggregate` 支持多 Y + 双轴布局 | `api/chart.py` |
| 4 | 后端 `_aggregate` 支持 X 为空时 auto-index | `api/chart.py` |
| 5 | 前端 `EncodingPanel` 多 Y 编辑 UI | `EncodingPanel.tsx` |
| 6 | 前端 `encodingToPlotly.ts` 多 trace 生成 | `utils/encodingToPlotly.ts` |
| 7 | `chartStore` 兼容新 encoding 格式 | `stores/chartStore.ts` |
| 8 | 前端 `PropertyEditor` 双轴标题编辑 | `PropertyEditor.tsx` |

### 第二期：归一化

| # | 内容 |
|---|------|
| 9 | 后端 `_aggregate` 加 perSeries/global 归一化 |
| 10 | 前端 YFieldConfigRow 加 normalize 下拉 |
| 11 | 图例/轴标题显示归一化标注 |

---

## 5. 数据流示例

```
用户选择 Y 字段 ["sales", "profit"]
  → EncodingPanel 生成 yFields: [
      {field:"sales", axis:"left", normalize:"none"},
      {field:"profit", axis:"right", normalize:"perSeries"}
    ]
  → POST /api/v1/chart/preview { dataset_id, encoding }
  → 后端聚合:
      - sales → trace1 (yaxis='y'), 无归一化
      - profit → trace2 (yaxis='y2'), perSeries 归一化
  → 返回 Plotly JSON:
      data: [trace1, trace2]
      layout: { yaxis: {side:"left"}, yaxis2: {side:"right", overlaying:"y"} }
```

---

## 6. 排除的图表类型

| 类型 | 行为 |
|------|------|
| pie / histogram / box | 忽略多 Y 字段，只取 `yFields[0]`，或保持单 Y 行为 |
| scatter | 仅当 X 和至少一个 Y 存在时可用 |

---

## 7. 风险

| 风险 | 缓解 |
|------|------|
| 旧 chart JSON 不兼容新 `yFields` 格式 | chartStore 加载时自动迁移 `y` → `yFields` |
| 双轴图表布局拥挤 | Plotly 自动缩放，PropertyEditor 可调范围 |
| 归一化后数值含义不直观 | 图例标注 "(normalized)" |

---

## 8. 决策摘要

- `y: EncodingChannel` → `yFields: YFieldConfig[]`，允许 0-N 个
- X 为空时使用 `range(len(df))` 作为 X（auto-index）
- 双轴通过 Plotly 原生 `yaxis` / `yaxis2` 实现
- 归一化分 `perSeries`（每列除自身 max）和 `global`（所有列除全局 max）
- 旧数据自动迁移，不破坏已有图表
