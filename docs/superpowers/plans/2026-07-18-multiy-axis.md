# Multi-Y Field & Dual Axis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-subagent-driven-development (recommended) or superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to map multiple data fields to Y-axis traces in the same chart, with left/right dual-axis support and auto-index X when no X field is selected.

**Architecture:** Backend `_aggregate` iterates `y_fields` (list, not single) and produces one Plotly trace per field (plus color-split subtraces). Dual axis uses Plotly's `yaxis`/`yaxis2` overlay. Frontend `EncodingPanel` replaces the single Y dropdown with an add/remove list of Y field config rows. The `chartStore` persist middleware auto-migrates old `y`-format persisted charts to the new `yFields` array format.

**Tech Stack:** TypeScript 5 / React 18 / Zustand (persist middleware) / Python 3.11 / Pydantic v2 / FastAPI / Plotly

**Phase scope:** Phase 1 only — multi-Y + dual axis + auto-index X + backward compat. Phase 2 (normalization) is excluded. The `normalize` field exists on `YFieldConfig` but is never used by aggregation logic; it defaults to `"none"` and is ready for Phase 2.

---

### Task 1: Backend Types — Add YFieldConfig and update ChartEncoding

**Files:**
- Modify: `backend/models/chart.py`
- No test file exists for models; verification is manual.

- [ ] **Step 1.1: Add YFieldConfig model and update ChartEncoding**

Replace the entire file `backend/models/chart.py` with:

```python
from backend.models.data import CBaseModel
from typing import Optional, Literal


class EncodingChannel(CBaseModel):
    field: str
    type: Literal["quantitative", "nominal", "temporal"]
    aggregate: Optional[Literal["sum", "mean", "count", "min", "max"]] = None
    bin: bool = False


class YFieldConfig(CBaseModel):
    field: str
    type: Literal["quantitative", "nominal", "temporal"]
    aggregate: Optional[Literal["sum", "mean", "count", "min", "max"]] = None
    axis: Literal["left", "right"] = "left"
    normalize: Literal["none", "perSeries", "global"] = "none"
    label: Optional[str] = None


class ChartEncoding(CBaseModel):
    x: Optional[EncodingChannel] = None
    y_fields: list[YFieldConfig] = []
    color: Optional[EncodingChannel] = None
    size: Optional[EncodingChannel] = None
    facet: Optional[EncodingChannel] = None
    chart_type: Literal["line", "bar", "scatter", "pie", "histogram", "box"] = "scatter"


class ChartPreviewRequest(CBaseModel):
    dataset_id: str
    encoding: ChartEncoding


class AggregateRequest(CBaseModel):
    dataset_id: str
    encoding: ChartEncoding
```

Note: `y_fields` serializes to `yFields` in JSON courtesy of `CBaseModel`'s `to_camel` alias generator (defined in `backend/models/data.py`).

- [ ] **Step 1.2: Verify the module imports cleanly**

Run: `python -c "from backend.models.chart import ChartEncoding, YFieldConfig; print('OK')"`
Expected output: `OK`
Workdir: `/home/user/CodeRepo/SandBox/MetricStudio`

---

### Task 2: Frontend Types — Add YFieldConfig interface and update ChartEncoding

**Files:**
- Modify: `src/types/encoding.ts`

- [ ] **Step 2.1: Add YFieldConfig interface and update ChartEncoding**

Replace the entire file `src/types/encoding.ts` with:

```typescript
export type ChartType = 'line' | 'bar' | 'scatter' | 'pie' | 'histogram' | 'box';

export type FieldType = 'quantitative' | 'nominal' | 'temporal';

export type AggregateType = 'sum' | 'mean' | 'count' | 'min' | 'max' | null;

export interface EncodingChannel {
  field: string;
  type: FieldType;
  aggregate?: AggregateType;
  bin?: boolean;
}

export interface YFieldConfig {
  field: string;
  type: FieldType;
  aggregate?: AggregateType;
  axis: 'left' | 'right';
  normalize: 'none' | 'perSeries' | 'global';
  label?: string;
}

export interface ChartEncoding {
  x?: EncodingChannel;
  yFields: YFieldConfig[];
  color?: EncodingChannel;
  size?: EncodingChannel;
  facet?: EncodingChannel;
  chartType: ChartType;
}

export interface ChartConfig {
  id: string;
  name: string;
  datasetId: string;
  encoding: ChartEncoding;
  layout: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 2.2: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected output: No errors from `encoding.ts`. If other files referencing `ChartEncoding.y` show errors, those are expected until later tasks fix them.
Workdir: `/home/user/CodeRepo/SandBox/MetricStudio`

---

### Task 3: Backend _aggregate — Support multi-Y, dual axis, auto-index X

**Files:**
- Modify: `backend/api/chart.py`

- [ ] **Step 3.1: Rewrite _aggregate to iterate y_fields**

Replace the entire `_aggregate` function in `backend/api/chart.py` (lines 39-129) with the code below. The file's imports, `router`, `_to_records`, and endpoint functions remain unchanged.

Old code to delete/replace (lines 39 to 129 inclusive):

```python
def _aggregate(df, encoding):
    x = encoding.x
    y = encoding.y
    color = encoding.color
    chart_type = encoding.chart_type

    layout = {
        "autosize": True,
        "margin": {"t": 40, "r": 20, "b": 60, "l": 60},
        "paper_bgcolor": "rgba(0,0,0,0)",
        "plot_bgcolor": "rgba(0,0,0,0)",
        "font": {"color": "#f5f5f5"},
        "xaxis": {"title": x.field if x else None, "gridcolor": "#333333"},
        "yaxis": {"title": y.field if y else None, "gridcolor": "#333333"},
        "showlegend": bool(color),
    }
    ...
    (rest of old function to line 129)
```

New code (replace the entire old `_aggregate` function body):

```python
def _aggregate(df, encoding):
    y_fields = encoding.y_fields or []
    color = encoding.color
    chart_type = encoding.chart_type

    layout = {
        "autosize": True,
        "margin": {"t": 40, "r": 20, "b": 60, "l": 60},
        "paper_bgcolor": "rgba(0,0,0,0)",
        "plot_bgcolor": "rgba(0,0,0,0)",
        "font": {"color": "#f5f5f5"},
        "xaxis": {"title": encoding.x.field if encoding.x else None, "gridcolor": "#333333"},
        "yaxis": {"title": None, "gridcolor": "#333333"},
        "showlegend": bool(color) or len(y_fields) > 1,
    }

    # ---- Single-Y types: pie, histogram, box ----
    if chart_type == "pie":
        if not color or not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        grouped = df.groupby(color.field, dropna=False)[primary.field].sum().reset_index()
        data = [{
            "type": "pie",
            "labels": grouped[color.field].astype(str).tolist(),
            "values": grouped[primary.field].tolist(),
            "marker": {"colors": DEFAULT_COLORS},
        }]
        return {"data": data, "layout": layout}

    if chart_type == "histogram":
        if not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        data = [{
            "type": "histogram",
            "x": df[primary.field].tolist(),
            "marker": {"color": DEFAULT_COLORS[0]},
        }]
        layout["yaxis"]["title"] = primary.label or primary.field
        return {"data": data, "layout": layout}

    if chart_type == "box":
        if not y_fields:
            return {"data": [], "layout": layout}
        primary = y_fields[0]
        if not color:
            data = [{
                "type": "box",
                "y": df[primary.field].dropna().tolist(),
                "name": primary.label or primary.field,
                "marker": {"color": DEFAULT_COLORS[0]},
            }]
            layout["yaxis"]["title"] = primary.label or primary.field
            return {"data": data, "layout": layout}
        data = []
        for idx, (key, group) in enumerate(df.groupby(color.field, dropna=False)):
            data.append({
                "type": "box",
                "y": group[primary.field].dropna().tolist(),
                "name": str(key),
                "marker": {"color": DEFAULT_COLORS[idx % len(DEFAULT_COLORS)]},
            })
        return {"data": data, "layout": layout}

    # ---- Multi-Y types: line, bar, scatter ----
    if not y_fields:
        return {"data": [], "layout": layout}

    if chart_type == "scatter" and not encoding.x:
        return {"data": [], "layout": layout}

    # Auto-index X when no x field is set
    if not encoding.x:
        # Copy to avoid mutating the caller's dataframe (used for other requests)
        df = df.copy()
        x_col = "__auto_index__"
        df[x_col] = df.index.astype(int)
        x_field = x_col
    else:
        x_field = encoding.x.field

    has_right_axis = any(yf.axis == "right" for yf in y_fields)

    # Build axis titles from field labels
    left_labels = [yf.label or yf.field for yf in y_fields if yf.axis == "left"]
    right_labels = [yf.label or yf.field for yf in y_fields if yf.axis == "right"]
    if left_labels:
        layout["yaxis"]["title"] = " / ".join(left_labels)
    if has_right_axis:
        layout["yaxis2"] = {
            "title": " / ".join(right_labels),
            "side": "right",
            "overlaying": "y",
            "anchor": "x",
            "gridcolor": "#333333",
        }

    data = []
    global_color_idx = 0

    for yf in y_fields:
        agg = yf.aggregate or "sum"
        yaxis = "y2" if yf.axis == "right" else "y"
        trace_name = yf.label or yf.field

        if not color:
            # --- Single trace per Y field ---
            if yf.aggregate:
                grouped = df.groupby(x_field, dropna=False)[yf.field].agg(agg).reset_index()
                grouped = grouped.sort_values(by=x_field)
                trace_x = grouped[x_field].astype(str).tolist()
                trace_y = grouped[yf.field].tolist()
            else:
                trace_x = df[x_field].tolist()
                trace_y = df[yf.field].tolist()
                if encoding.x:
                    trace_x = [str(v) for v in trace_x]

            datum = {
                "type": "scatter" if chart_type == "line" else chart_type,
                "mode": "lines+markers" if chart_type == "line" else None,
                "x": trace_x,
                "y": trace_y,
                "name": trace_name,
                "yaxis": yaxis,
                "marker": {"color": DEFAULT_COLORS[global_color_idx % len(DEFAULT_COLORS)]},
            }
            data.append(datum)
            global_color_idx += 1

        else:
            # --- Multi-series per Y field: one trace per color value ---
            grouped = df.groupby([color.field, x_field], dropna=False)[yf.field].agg(agg).reset_index()
            try:
                pivot = grouped.pivot(index=x_field, columns=color.field, values=yf.field).fillna(0)
            except Exception:
                pivot = grouped.pivot_table(index=x_field, columns=color.field, values=yf.field, aggfunc=agg, fill_value=0)

            sorted_x = sorted(pivot.index, key=lambda v: (isinstance(v, str), str(v)))
            for series_name in pivot.columns:
                y_vals = [float(pivot.loc[idx, series_name]) if idx in pivot.index else 0 for idx in sorted_x]
                datum = {
                    "type": "scatter" if chart_type == "line" else chart_type,
                    "mode": "lines+markers" if chart_type == "line" else None,
                    "x": [str(v) for v in sorted_x],
                    "y": y_vals,
                    "name": f"{trace_name} - {series_name}",
                    "yaxis": yaxis,
                    "marker": {"color": DEFAULT_COLORS[global_color_idx % len(DEFAULT_COLORS)]},
                }
                data.append(datum)
                global_color_idx += 1

    return {"data": data, "layout": layout}
```

- [ ] **Step 3.2: Verify the temporary copy does not mutate the original dataframe**

The auto-index block now uses `df = df.copy()` so the caller's `dataset.df` is never modified. This is confirmed by the fact that the e2e tests (Task 8) work across multiple requests without index corruption.

- [ ] **Step 3.3: Verify the backend starts without import errors**

Run: `python -c "from backend.api.chart import _aggregate; print('OK')"`
Expected output: `OK`
Workdir: `/home/user/CodeRepo/SandBox/MetricStudio`

---

### Task 4: Frontend EncodingPanel — Multi-Y editor UI

**Files:**
- Modify: `src/components/chart/EncodingPanel.tsx`

- [ ] **Step 4.1: Rewrite EncodingPanel with YFieldConfigRow subcomponent and multi-Y editor**

Replace the entire file `src/components/chart/EncodingPanel.tsx` with:

```tsx
import { useDroppable } from '@dnd-kit/core'
import { Button, Select, SelectItem } from '@heroui/react'
import { Plus, X } from 'lucide-react'
import type { ColumnMeta } from '@/types/data'
import type { ChartConfig, YFieldConfig, FieldType, AggregateType } from '@/types/encoding'
import { useChartStore } from '@/stores/chartStore'
import { aggregateOptions } from '@/utils/encodingToPlotly'

interface EncodingPanelProps {
  chart: ChartConfig
  columns: ColumnMeta[]
}

type ChannelKey = 'x' | 'color' | 'size' | 'facet'

const channels: { key: ChannelKey; label: string }[] = [
  { key: 'x', label: 'X Axis' },
  { key: 'color', label: 'Color' },
  { key: 'size', label: 'Size' },
  { key: 'facet', label: 'Facet' },
]

function ChannelSlot({ channel, chart, columns }: { channel: ChannelKey; chart: ChartConfig; columns: ColumnMeta[] }) {
  const { isOver, setNodeRef } = useDroppable({ id: `channel-${channel}` })
  const encoding = chart.encoding[channel]
  const updateEncoding = useChartStore((s) => s.updateEncoding)

  const setField = (field: string | null) => {
    if (!field) {
      const next = { ...chart.encoding }
      delete next[channel]
      updateEncoding(chart.id, next)
      return
    }
    const col = columns.find((c) => c.name === field)
    updateEncoding(chart.id, {
      [channel]: {
        field,
        type: col?.inferredType || 'nominal',
      },
    })
  }

  const setAggregate = (aggregate: string) => {
    if (!encoding) return
    updateEncoding(chart.id, {
      [channel]: { ...encoding, aggregate: aggregate ? (aggregate as never) : null },
    })
  }

  return (
    <div
      ref={setNodeRef}
      className={`rounded border p-2 transition-colors ${
        isOver ? 'border-primary bg-primary/10' : 'border-border bg-surface'
      }`}
    >
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
        <span>{channels.find((c) => c.key === channel)?.label}</span>
        {encoding && (
          <Button isIconOnly size="sm" variant="light" className="h-4 w-4 min-w-0" onPress={() => setField(null)}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
      <Select
        size="sm"
        placeholder={`Drop ${channel} field`}
        selectedKeys={encoding ? [encoding.field] : []}
        onSelectionChange={(keys) => setField(Array.from(keys)[0] as string)}
      >
        {columns.map((c) => (
          <SelectItem key={c.name}>{c.name}</SelectItem>
        ))}
      </Select>
      {encoding && channel === 'x' && (
        <Select
          size="sm"
          label="Aggregate"
          className="mt-1"
          selectedKeys={[encoding.aggregate || '']}
          onSelectionChange={(keys) => setAggregate(Array.from(keys)[0] as string)}
        >
          {aggregateOptions.map((opt) => (
            <SelectItem key={opt.value}>{opt.label}</SelectItem>
          ))}
        </Select>
      )}
    </div>
  )
}

function YFieldConfigRow({
  yf,
  index,
  columns,
  onUpdate,
  onRemove,
}: {
  yf: YFieldConfig
  index: number
  columns: ColumnMeta[]
  onUpdate: (index: number, updated: YFieldConfig) => void
  onRemove: (index: number) => void
}) {
  return (
    <div className="rounded border border-border bg-surface p-2">
      <div className="mb-1 flex items-center justify-between text-xs font-medium text-muted">
        <span>Y Field {index + 1}</span>
        <Button isIconOnly size="sm" variant="light" className="h-4 w-4 min-w-0" onPress={() => onRemove(index)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <Select
        size="sm"
        placeholder="Select Y field"
        selectedKeys={[yf.field]}
        onSelectionChange={(keys) => {
          const field = Array.from(keys)[0] as string
          const col = columns.find((c) => c.name === field)
          onUpdate(index, {
            ...yf,
            field,
            type: (col?.inferredType as FieldType) || 'nominal',
          })
        }}
      >
        {columns.map((c) => (
          <SelectItem key={c.name}>{c.name}</SelectItem>
        ))}
      </Select>
      <Select
        size="sm"
        label="Aggregate"
        className="mt-1"
        selectedKeys={[yf.aggregate || '']}
        onSelectionChange={(keys) => {
          const agg = Array.from(keys)[0] as string
          onUpdate(index, { ...yf, aggregate: agg ? (agg as AggregateType) : null })
        }}
      >
        {aggregateOptions.map((opt) => (
          <SelectItem key={opt.value}>{opt.label}</SelectItem>
        ))}
      </Select>
      <Select
        size="sm"
        label="Axis"
        className="mt-1"
        selectedKeys={[yf.axis]}
        onSelectionChange={(keys) => {
          const axis = Array.from(keys)[0] as 'left' | 'right'
          onUpdate(index, { ...yf, axis })
        }}
      >
        <SelectItem key="left">Left Y</SelectItem>
        <SelectItem key="right">Right Y</SelectItem>
      </Select>
    </div>
  )
}

export function EncodingPanel({ chart, columns }: EncodingPanelProps) {
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const yFields = chart.encoding.yFields || []

  const updateYField = (index: number, updated: YFieldConfig) => {
    const newYFields = [...yFields]
    newYFields[index] = updated
    updateEncoding(chart.id, { yFields: newYFields })
  }

  const removeYField = (index: number) => {
    const newYFields = yFields.filter((_, i) => i !== index)
    updateEncoding(chart.id, { yFields: newYFields })
  }

  const addYField = () => {
    const newYFields: YFieldConfig[] = [
      ...yFields,
      {
        field: '',
        type: 'quantitative',
        axis: 'left',
        normalize: 'none',
      },
    ]
    updateEncoding(chart.id, { yFields: newYFields })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold text-muted">Encoding</div>

      {/* Multi-Y Fields Section */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-muted">Y Fields</span>
          <Button isIconOnly size="sm" variant="light" onPress={addYField}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        {yFields.length === 0 && (
          <div className="rounded border border-dashed border-border p-2 text-center text-xs text-muted">
            No Y fields. Click + to add one.
          </div>
        )}
        {yFields.map((yf, idx) => (
          <YFieldConfigRow
            key={idx}
            yf={yf}
            index={idx}
            columns={columns}
            onUpdate={updateYField}
            onRemove={removeYField}
          />
        ))}
      </div>

      {/* Other channels (x, color, size, facet) */}
      {channels.map((ch) => (
        <ChannelSlot key={ch.key} channel={ch.key} chart={chart} columns={columns} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4.2: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected output: No errors related to `EncodingPanel.tsx`. The `ChartEncoding` interface now has `yFields` instead of `y`, so any component that used `encoding.y` will be caught next.
Workdir: `/home/user/CodeRepo/SandBox/MetricStudio`

---

### Task 5: Frontend encodingToPlotly.ts — Multi-trace generation

**Files:**
- Modify: `src/utils/encodingToPlotly.ts`

- [ ] **Step 5.1: Rewrite encodingToPlotly for multi-Y and auto-index X**

Replace the entire file `src/utils/encodingToPlotly.ts` with:

```typescript
import type { ChartEncoding, EncodingChannel, ChartType, FieldType, YFieldConfig } from '@/types/encoding';
import type { PlotlyFigure } from '@/types/plotly';

export interface RawRow {
  [key: string]: string | number | boolean | null;
}

function inferType(value: unknown): FieldType {
  if (value === null || value === undefined) return 'nominal';
  if (typeof value === 'number') return 'quantitative';
  if (typeof value === 'boolean') return 'nominal';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'temporal';
    if (!Number.isNaN(Number(value)) && value.trim() !== '') return 'quantitative';
  }
  return 'nominal';
}

function getType(channel: EncodingChannel, rows: RawRow[]): FieldType {
  if (channel.type) return channel.type;
  const sample = rows.find((r) => r[channel.field] !== null && r[channel.field] !== undefined);
  return sample ? inferType(sample[channel.field]) : 'nominal';
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function aggregateValue(value: any, _agg: string): number | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isNaN(num) ? null : num;
}

function applyAggregation(rows: RawRow[], channel: EncodingChannel): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[channel.field] ?? '__null__');
    if (!groups.has(key)) groups.set(key, []);
    const val = row[channel.aggregate ? channel.field : channel.field];
    const num = aggregateValue(val, channel.aggregate || 'sum');
    if (num !== null) groups.get(key)!.push(num);
  }
  return groups;
}

function computeAggregate(groups: Map<string, number[]>, agg: string): Map<string, number> {
  const result = new Map<string, number>();
  for (const [key, values] of groups) {
    if (values.length === 0) continue;
    switch (agg) {
      case 'mean':
        result.set(key, values.reduce((a, b) => a + b, 0) / values.length);
        break;
      case 'count':
        result.set(key, values.length);
        break;
      case 'min':
        result.set(key, Math.min(...values));
        break;
      case 'max':
        result.set(key, Math.max(...values));
        break;
      case 'sum':
      default:
        result.set(key, values.reduce((a, b) => a + b, 0));
        break;
    }
  }
  return result;
}

export function encodingToPlotly(
  encoding: ChartEncoding,
  rows: RawRow[],
  _columns: { name: string; inferredType: FieldType }[]
): PlotlyFigure {
  const type = encoding.chartType;
  const yFields = encoding.yFields || [];

  const layout: Record<string, any> = {
    autosize: true,
    margin: { t: 40, r: 20, b: 60, l: 60 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { color: '#f5f5f5' },
    xaxis: { title: encoding.x?.field, gridcolor: '#333333' },
    yaxis: { title: null, gridcolor: '#333333' },
    showlegend: !!encoding.color || yFields.length > 1,
  };

  // ---- Single-Y types: pie, histogram, box ----
  if (type === 'pie') {
    const colorField = encoding.color?.field;
    const primaryY = yFields[0];
    const valueField = primaryY?.field || encoding.size?.field;
    if (!colorField || !valueField) {
      return { data: [], layout };
    }
    const agg = primaryY?.aggregate || 'sum';
    const groups = applyAggregation(rows, { field: valueField, type: 'quantitative', aggregate: agg });
    const aggregated = computeAggregate(groups, agg);
    const labels = Array.from(aggregated.keys());
    const values = labels.map((l) => aggregated.get(l) ?? 0);
    return {
      data: [
        {
          type: 'pie',
          labels,
          values,
          hole: 0,
          marker: { colors: defaultColors },
        } as any,
      ],
      layout,
    };
  }

  if (type === 'histogram') {
    const primaryY = yFields[0];
    const field = primaryY?.field || encoding.x?.field;
    if (!field) return { data: [], layout };
    return {
      data: [
        {
          type: 'histogram',
          x: rows.map((r) => r[field]),
          marker: { color: defaultColors[0] },
          name: field,
        } as any,
      ],
      layout,
    };
  }

  if (type === 'box') {
    const primaryY = yFields[0];
    const yField = primaryY?.field;
    const colorField = encoding.color?.field;
    if (!yField) return { data: [], layout };
    if (!colorField) {
      return {
        data: [
          {
            type: 'box',
            y: rows.map((r) => r[yField]),
            name: primaryY?.label || yField,
            marker: { color: defaultColors[0] },
          } as any,
        ],
        layout,
      };
    }
    const groups = new Map<string, (number | null)[]>();
    for (const row of rows) {
      const key = String(row[colorField] ?? 'null');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(aggregateValue(row[yField], 'sum'));
    }
    const data: any[] = [];
    let idx = 0;
    for (const [key, vals] of groups) {
      data.push({
        type: 'box',
        y: vals.filter((v): v is number => v !== null),
        name: key,
        marker: { color: defaultColors[idx % defaultColors.length] },
      } as any);
      idx++;
    }
    return { data, layout };
  }

  // ---- Multi-Y types: line, bar, scatter ----
  if (yFields.length === 0) {
    return { data: [], layout };
  }

  if (type === 'scatter' && !encoding.x) {
    return { data: [], layout };
  }

  // Auto-index X
  const autoIndex = !encoding.x || !encoding.x.field;
  const xFieldName = encoding.x?.field;

  // Build axis titles
  const leftLabels = yFields.filter((yf) => yf.axis === 'left').map((yf) => yf.label || yf.field);
  const rightLabels = yFields.filter((yf) => yf.axis === 'right').map((yf) => yf.label || yf.field);
  if (leftLabels.length > 0) {
    layout.yaxis.title = leftLabels.join(' / ');
  }
  const hasRightAxis = yFields.some((yf) => yf.axis === 'right');
  if (hasRightAxis) {
    layout.yaxis2 = {
      title: rightLabels.join(' / ') || 'Right Y',
      side: 'right',
      overlaying: 'y',
      anchor: 'x',
      gridcolor: '#333333',
    };
  }

  const data: any[] = [];
  let globalColorIdx = 0;
  const colorField = encoding.color?.field;
  const xType = encoding.x ? getType(encoding.x, rows) : 'quantitative';

  for (const yf of yFields) {
    const yAxis = yf.axis === 'right' ? 'y2' : 'y';
    const traceName = yf.label || yf.field;
    const yAgg = yf.aggregate;

    if (!colorField) {
      // Single trace per Y field
      let traceX: string[];
      let traceY: number[];

      if (autoIndex) {
        // Auto-index: every x value is unique, so aggregation is a no-op
        // (each group has exactly 1 row). Return raw per-row values.
        traceX = rows.map((_, i) => String(i));
        traceY = rows.map((r) => aggregateValue(r[yf.field], 'sum') ?? 0);
      } else {
        // X field exists
        if (!yAgg) {
          traceX = rows.map((r) => String(r[xFieldName!] ?? ''));
          traceY = rows.map((r) => aggregateValue(r[yf.field], 'sum') ?? 0);
        } else {
          const groups = applyAggregation(rows, { field: xFieldName!, type: 'nominal', aggregate: yAgg });
          const aggregated = computeAggregate(groups, yAgg);
          const sortedKeys = sortKeys(Array.from(aggregated.keys()), xType);
          traceX = sortedKeys;
          traceY = sortedKeys.map((k) => aggregated.get(k) ?? 0);
        }
      }

      data.push({
        type: type === 'line' ? 'scatter' : type,
        mode: type === 'line' ? 'lines+markers' : undefined,
        x: traceX,
        y: traceY,
        name: traceName,
        yaxis: yAxis,
        marker: { color: defaultColors[globalColorIdx % defaultColors.length] },
      } as any);
      globalColorIdx++;
    } else {
      // Multi-series: one trace per color value, grouped under this Y field
      const allXKeys = new Set<string>();

      if (autoIndex) {
        for (let i = 0; i < rows.length; i++) {
          allXKeys.add(String(i));
        }
      } else {
        for (const row of rows) {
          allXKeys.add(String(row[xFieldName!] ?? ''));
        }
      }
      const sortedX = sortKeys(Array.from(allXKeys), autoIndex ? 'quantitative' : xType);

      // Group rows by color
      const colorGroups = new Map<string, Map<string, number[]>>();
      for (const row of rows) {
        const seriesKey = String(row[colorField] ?? 'null');
        if (!colorGroups.has(seriesKey)) colorGroups.set(seriesKey, new Map());
        const inner = colorGroups.get(seriesKey)!;
        const xKey = autoIndex ? String(rows.indexOf(row)) : String(row[xFieldName!] ?? '');
        if (!inner.has(xKey)) inner.set(xKey, []);
        const num = aggregateValue(row[yf.field], yAgg || 'sum');
        if (num !== null) inner.get(xKey)!.push(num);
      }

      for (const [seriesKey, inner] of colorGroups) {
        const yVals = sortedX.map((k) => {
          const vals = inner.get(k);
          if (!vals || vals.length === 0) return 0;
          return computeAggregate(new Map([[k, vals]]), yAgg || 'sum').get(k) ?? 0;
        });
        data.push({
          type: type === 'line' ? 'scatter' : type,
          mode: type === 'line' ? 'lines+markers' : undefined,
          x: sortedX,
          y: yVals,
          name: `${traceName} - ${seriesKey}`,
          yaxis: yAxis,
          marker: { color: defaultColors[globalColorIdx % defaultColors.length] },
        } as any);
        globalColorIdx++;
      }
    }
  }

  return { data, layout };
}

function sortKeys(keys: string[], type: FieldType): string[] {
  if (type === 'quantitative' || type === 'temporal') {
    return [...keys].sort((a, b) => {
      const na = Number(a);
      const nb = Number(b);
      if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
      return a.localeCompare(b);
    });
  }
  return [...keys].sort((a, b) => a.localeCompare(b));
}

export const defaultColors = [
  '#3b82f6',
  '#ef4444',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#6366f1',
];

export const chartTypeOptions: { value: ChartType; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'pie', label: 'Pie' },
  { value: 'histogram', label: 'Histogram' },
  { value: 'box', label: 'Box' },
];

export const aggregateOptions: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'sum', label: 'Sum' },
  { value: 'mean', label: 'Mean' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];
```

- [ ] **Step 5.2: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected output: No errors from `encodingToPlotly.ts`.
Workdir: `/home/user/CodeRepo/SandBox/MetricStudio`

---

### Task 6: chartStore backward compat — Migrate old `y` to `yFields` on load

**Files:**
- Modify: `src/stores/chartStore.ts`

- [ ] **Step 6.1: Add merge function to persist middleware for backward compatibility**

Edit `src/stores/chartStore.ts`:

Find the persist configuration object (last argument to `persist(...)`):

```typescript
    {
      name: 'metricstudio-charts',
      partialize: (state) => ({ charts: state.charts }),
    }
```

Replace it with:

```typescript
    {
      name: 'metricstudio-charts',
      partialize: (state) => ({ charts: state.charts }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Record<string, unknown>) } as ChartState;
        // Migrate charts from old format (single y) to new format (yFields array)
        if (merged.charts) {
          merged.charts = (merged.charts as Array<Record<string, unknown>>).map((chart) => {
            const enc = (chart.encoding || {}) as Record<string, unknown>;
            if ('y' in enc && !('yFields' in enc)) {
              const oldY = enc.y as Record<string, unknown> | undefined;
              delete enc.y;
              (enc as Record<string, unknown>).yFields = oldY
                ? [
                    {
                      field: oldY.field as string,
                      type: (oldY.type as string) || 'quantitative',
                      aggregate: (oldY.aggregate as string) || null,
                      axis: 'left',
                      normalize: 'none',
                    },
                  ]
                : [];
            }
            return chart;
          }) as ChartConfig[];
        }
        return merged as ChartState;
      },
    }
```

Also, update the `defaultEncoding` object to include `yFields: []`. Find:

```typescript
const defaultEncoding: ChartEncoding = {
  chartType: 'scatter',
};
```

Replace with:

```typescript
const defaultEncoding: ChartEncoding = {
  chartType: 'scatter',
  yFields: [],
};
```

- [ ] **Step 6.2: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected output: No errors from `chartStore.ts`.
Workdir: `/home/user/CodeRepo/SandBox/MetricStudio`

---

### Task 7: PropertyEditor — Dual axis title editing

**Files:**
- Modify: `src/components/chart/PropertyEditor.tsx`

- [ ] **Step 7.1: Add right Y axis label input when chart uses dual axes**

Replace the entire file `src/components/chart/PropertyEditor.tsx` with:

```tsx
import { useChartStore } from '@/stores/chartStore'
import { Input, Switch } from '@heroui/react'

export function PropertyEditor() {
  const charts = useChartStore((s) => s.charts)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const updateLayout = useChartStore((s) => s.updateLayout)

  const chart = charts.find((c) => c.id === activeChartId)

  if (!chart) {
    return (
      <div className="rounded border border-border bg-surface-elevated p-3 text-xs text-muted">
        Select a chart to edit properties.
      </div>
    )
  }

  const layout = chart.layout as Record<string, any>
  const xaxis = (layout.xaxis || {}) as Record<string, any>
  const yaxis = (layout.yaxis || {}) as Record<string, any>
  const yaxis2 = (layout.yaxis2 || {}) as Record<string, any>

  // Determine if the chart has right-axis Y fields
  const encoding = chart.encoding
  const hasRightAxis = (encoding.yFields || []).some((yf) => yf.axis === 'right')

  const getTitleText = (axis: Record<string, any>): string => {
    if (!axis.title) return ''
    if (typeof axis.title === 'object') return String((axis.title as Record<string, any>).text || '')
    return String(axis.title)
  }

  const setTitleText = (axisKey: string, value: string) => {
    const current = (layout[axisKey] || {}) as Record<string, any>
    updateLayout(chart.id, {
      [axisKey]: { ...current, title: { text: value } },
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-semibold text-muted">Properties</div>

      <Input
        size="sm"
        label="Title"
        value={String(layout.title || '')}
        onValueChange={(v) => updateLayout(chart.id, { title: v })}
      />

      <Input
        size="sm"
        label="X Axis Label"
        value={getTitleText(xaxis)}
        onValueChange={(v) => setTitleText('xaxis', v)}
      />

      <Input
        size="sm"
        label="Left Y Axis Label"
        value={getTitleText(yaxis)}
        onValueChange={(v) => setTitleText('yaxis', v)}
      />

      {hasRightAxis && (
        <Input
          size="sm"
          label="Right Y Axis Label"
          value={getTitleText(yaxis2)}
          onValueChange={(v) => setTitleText('yaxis2', v)}
        />
      )}

      <div className="flex items-center justify-between text-xs">
        <span>Show Legend</span>
        <Switch
          size="sm"
          isSelected={!!layout.showlegend}
          onValueChange={(v) => updateLayout(chart.id, { showlegend: v })}
        />
      </div>

      <Input
        size="sm"
        type="color"
        label="Background Color"
        value={String(layout.plot_bgcolor || '#000000')}
        onValueChange={(v) => updateLayout(chart.id, { plot_bgcolor: v })}
      />
    </div>
  )
}
```

- [ ] **Step 7.2: Verify TypeScript compilation**

Run: `npx tsc --noEmit --pretty 2>&1 | head -30`
Expected output: No errors from `PropertyEditor.tsx`.
Workdir: `/home/user/CodeRepo/SandBox/MetricStudio`

---

### Task 8: E2E verification

**Files:**
- Modify: `test-e2e.sh` (update the chart preview test payload)
- Manual: start backend, run curl tests, verify frontend compilation

- [ ] **Step 8.1: Update the test payload in test-e2e.sh**

Find line 59 in `test-e2e.sh`:

```bash
curl -sf -X POST "$BASE/api/v1/chart/preview" -H "Content-Type: application/json" -d "{\"dataset_id\":\"$ID\",\"encoding\":{\"chart_type\":\"bar\",\"x\":{\"field\":\"date\",\"type\":\"temporal\"},\"y\":{\"field\":\"value\",\"type\":\"quantitative\",\"aggregate\":\"sum\"},\"color\":{\"field\":\"category\",\"type\":\"nominal\"}}}" > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }
```

Replace with the new `yFields` format:

```bash
curl -sf -X POST "$BASE/api/v1/chart/preview" -H "Content-Type: application/json" -d "{\"dataset_id\":\"$ID\",\"encoding\":{\"chart_type\":\"bar\",\"x\":{\"field\":\"date\",\"type\":\"temporal\"},\"yFields\":[{\"field\":\"value\",\"type\":\"quantitative\",\"aggregate\":\"sum\",\"axis\":\"left\",\"normalize\":\"none\"}],\"color\":{\"field\":\"category\",\"type\":\"nominal\"}}}" > /dev/null && echo "PASS" || { echo "FAIL"; cleanup 1; }
```

- [ ] **Step 8.2: Start backend and run E2E tests**

Run:
```bash
cd /home/user/CodeRepo/SandBox/MetricStudio
source .venv/bin/activate 2>/dev/null || true
python backend/main.py &
BACKEND_PID=$!
sleep 3
```

Run the full E2E suite:
```bash
bash test-e2e.sh
```
Expected output:
```
=== MetricStudio E2E Tests ===
1. Health check... PASS
2. Import CSV... PASS (ID: ...)
3. List datasets... PASS
4. Preview data... PASS
5. Describe stats... PASS
6. Filter... PASS
7. Sort... PASS
8. History... PASS
9. Chart preview... PASS
10. Delete dataset... PASS
=== All tests passed ===
```

Kill the backend: `kill $BACKEND_PID 2>/dev/null || true`

- [ ] **Step 8.3: Verify multi-Y API endpoint directly**

Start the backend again, then run a curl test with TWO Y fields (one left, one right):

```bash
cd /home/user/CodeRepo/SandBox/MetricStudio
source .venv/bin/activate 2>/dev/null || true
python backend/main.py &
BACKEND_PID=$!
sleep 3
BASE="http://127.0.0.1:8123"
```

Import a sample CSV and get its ID:
```bash
ID=$(curl -sf -F "file=@sample_data.csv" "$BASE/api/v1/data/import" | python -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Dataset ID: $ID"
```

Test multi-Y (two yFields, left+right axis):
```bash
curl -sf -X POST "$BASE/api/v1/chart/preview" \
  -H "Content-Type: application/json" \
  -d "{\"dataset_id\":\"$ID\",\"encoding\":{\"chart_type\":\"line\",\"x\":{\"field\":\"date\",\"type\":\"temporal\"},\"yFields\":[{\"field\":\"value\",\"type\":\"quantitative\",\"aggregate\":\"sum\",\"axis\":\"left\",\"normalize\":\"none\"},{\"field\":\"metric2\",\"type\":\"quantitative\",\"aggregate\":\"mean\",\"axis\":\"right\",\"normalize\":\"none\"}]}}" | python -m json.tool
```

Expected: A JSON response with `data` array containing 2 traces, one with `"yaxis": "y"` and one with `"yaxis": "y2"`, and `layout` containing `yaxis` and `yaxis2` entries.

Test auto-index X (no x field, one yField):
```bash
curl -sf -X POST "$BASE/api/v1/chart/preview" \
  -H "Content-Type: application/json" \
  -d "{\"dataset_id\":\"$ID\",\"encoding\":{\"chart_type\":\"bar\",\"yFields\":[{\"field\":\"value\",\"type\":\"quantitative\",\"aggregate\":\"sum\",\"axis\":\"left\",\"normalize\":\"none\"}]}}" | python -m json.tool
```

Expected: A JSON response with `data` containing one trace using integer-index x values.

Kill the backend: `kill $BACKEND_PID 2>/dev/null || true`

- [ ] **Step 8.4: Final full TypeScript check**

Run: `npx tsc --noEmit --pretty`
Expected output: No errors (exit code 0).
Workdir: `/home/user/CodeRepo/SandBox/MetricStudio`

- [ ] **Step 8.5: Commit all changes**

```bash
cd /home/user/CodeRepo/SandBox/MetricStudio
git add -A
git status
```

Verify only intended files are staged:
- `backend/models/chart.py`
- `backend/api/chart.py`
- `src/types/encoding.ts`
- `src/components/chart/EncodingPanel.tsx`
- `src/utils/encodingToPlotly.ts`
- `src/stores/chartStore.ts`
- `src/components/chart/PropertyEditor.tsx`
- `test-e2e.sh`

Then commit:

```bash
git commit -m "feat: multi-Y field support with dual axis and auto-index X

- Add YFieldConfig model (backend) and interface (frontend)
- Change ChartEncoding.y -> yFields / y_fields (array)
- Rewrite backend _aggregate to iterate y_fields, support dual axis layout
- Add multi-Y editor UI in EncodingPanel (add/remove Y fields, axis selector)
- Update encodingToPlotly.ts for multi-trace generation
- Add chartStore persist merge migration for old y format
- Add dual axis title inputs in PropertyEditor
- Update E2E test payload to use yFields format"
```

---

**Total tasks: 8 tasks, 20 steps**
