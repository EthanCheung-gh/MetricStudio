# MetricStudio Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-subagent-driven-development (recommended) or superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an interactive dashboard: a grid canvas rendering multiple charts simultaneously, driven by a global filter bar (category multi-select / numeric range / date range), with drag-resize layout and project-file persistence.

**Architecture:** New `dashboardStore` (Zustand + persist) holds dashboard layout + filters. A fixed "Dashboard" tab in `CenterArea` renders `DashboardView`, which lays out `DashboardChartCard`s on a `react-grid-layout` grid. Each card independently fetches its figure via `api.previewChart(..., filters)`. Backend gains `FilterSpec` (`range`/`in`) applied before `_aggregate`; `.metricstudio` manifest gains `dashboards`.

**Tech Stack:** TypeScript 5 / React 19 / Zustand 5 / HeroUI / Tailwind 4 / react-grid-layout / Python FastAPI + Pydantic v2 + Pandas.

**Phase scope:** Phase 1 only — grid layout + global filters + multi-chart render + persistence. Phase 2 (in-canvas brush linking, layout templates, interactive HTML export) is excluded.

---

## File Inventory

### Files to create:
| File | Purpose |
|------|---------|
| `src/types/dashboard.ts` | DashboardConfig / DashboardItem / DashboardFilter types |
| `src/stores/dashboardStore.ts` | Dashboard state + actions + persist |
| `src/components/dashboard/DashboardView.tsx` | Dashboard toolbar + filter bar + grid |
| `src/components/dashboard/DashboardChartCard.tsx` | Per-chart card with independent figure fetch |
| `src/components/dashboard/DashboardFilterBar.tsx` | Category/range/date filter controls |

### Files to modify:
| File | Change |
|------|--------|
| `backend/models/chart.py` | Add `FilterSpec`; `ChartPreviewRequest.filters` |
| `backend/api/chart.py` | Add `_filter_by_filters`; apply in `preview_chart` |
| `backend/api/project.py` | Manifest `dashboards` + version 0.3.0 |
| `src/api/client.ts` | `previewChart(filters)`; `saveProject/loadProject` dashboards |
| `src/stores/workspaceStore.ts` | `activeTab` → add `'dashboard'` |
| `src/components/layout/CenterArea.tsx` | Dashboard tab + render `DashboardView` |
| `src/components/layout/TitleBar.tsx` | `handleSave` passes dashboards |
| `src/utils/project.ts` | Restore dashboards on load |

### Dependency:
| Package | Note |
|---------|------|
| `react-grid-layout` + `@types/react-grid-layout` | First choice; verify React 19 peer compat in Task 4.1, fallback to self-built CSS Grid + @dnd-kit |

---

## Task 1: Frontend types + dashboardStore

**Files:** Create `src/types/dashboard.ts`, `src/stores/dashboardStore.ts`

- [ ] **Step 1.1: Create `src/types/dashboard.ts`**

```typescript
export interface DashboardItem {
  chartId: string
  x: number
  y: number
  w: number
  h: number
}

export type DashboardFilterKind = 'category' | 'range' | 'date'

export interface DashboardFilter {
  id: string
  field: string
  label: string
  kind: DashboardFilterKind
  datasetId: string
  value: unknown   // category: string[] | null; range/date: [string, string] | null
}

export interface DashboardConfig {
  id: string
  name: string
  items: DashboardItem[]
  filters: DashboardFilter[]
  cols: number
  rowHeight: number
  createdAt: string
  updatedAt: string
}
```

- [ ] **Step 1.2: Create `src/stores/dashboardStore.ts`**

```typescript
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { DashboardConfig, DashboardFilter, DashboardItem } from '@/types/dashboard'
import { generateId } from '@/utils/id'

interface DashboardState {
  dashboards: DashboardConfig[]
  activeDashboardId: string | null

  createDashboard: () => DashboardConfig
  removeDashboard: (id: string) => void
  renameDashboard: (id: string, name: string) => void
  setActiveDashboard: (id: string | null) => void
  addItem: (dashboardId: string, chartId: string) => void
  removeItem: (dashboardId: string, chartId: string) => void
  moveItem: (dashboardId: string, chartId: string, x: number, y: number) => void
  resizeItem: (dashboardId: string, chartId: string, w: number, h: number) => void
  addFilter: (dashboardId: string, filter: Omit<DashboardFilter, 'id'>) => void
  updateFilter: (dashboardId: string, filterId: string, patch: Partial<DashboardFilter>) => void
  removeFilter: (dashboardId: string, filterId: string) => void
  loadDashboards: (dashboards: DashboardConfig[]) => void
}

function touch(list: DashboardConfig[], id: string, fn: (d: DashboardConfig) => DashboardConfig): DashboardConfig[] {
  return list.map((d) => (d.id === id ? fn(d) : d))
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      dashboards: [],
      activeDashboardId: null,

      createDashboard: () => {
        const now = new Date().toISOString()
        const dashboard: DashboardConfig = {
          id: generateId(),
          name: `Dashboard ${get().dashboards.length + 1}`,
          items: [],
          filters: [],
          cols: 12,
          rowHeight: 80,
          createdAt: now,
          updatedAt: now,
        }
        set((s) => ({ dashboards: [...s.dashboards, dashboard], activeDashboardId: dashboard.id }))
        return dashboard
      },

      removeDashboard: (id) =>
        set((s) => ({
          dashboards: s.dashboards.filter((d) => d.id !== id),
          activeDashboardId: s.activeDashboardId === id ? null : s.activeDashboardId,
        })),

      renameDashboard: (id, name) =>
        set((s) => ({ dashboards: touch(s.dashboards, id, (d) => ({ ...d, name, updatedAt: new Date().toISOString() })) })),

      setActiveDashboard: (id) => set({ activeDashboardId: id }),

      addItem: (dashboardId, chartId) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => {
            if (d.items.some((i) => i.chartId === chartId)) return d
            const item: DashboardItem = { chartId, x: 0, y: Infinity, w: 6, h: 4 }
            return { ...d, items: [...d.items, item], updatedAt: new Date().toISOString() }
          }),
        })),

      removeItem: (dashboardId, chartId) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            items: d.items.filter((i) => i.chartId !== chartId),
            updatedAt: new Date().toISOString(),
          })),
        })),

      moveItem: (dashboardId, chartId, x, y) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            items: d.items.map((i) => (i.chartId === chartId ? { ...i, x, y } : i)),
            updatedAt: new Date().toISOString(),
          })),
        })),

      resizeItem: (dashboardId, chartId, w, h) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            items: d.items.map((i) => (i.chartId === chartId ? { ...i, w, h } : i)),
            updatedAt: new Date().toISOString(),
          })),
        })),

      addFilter: (dashboardId, filter) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            filters: [...d.filters, { ...filter, id: generateId() }],
            updatedAt: new Date().toISOString(),
          })),
        })),

      updateFilter: (dashboardId, filterId, patch) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            filters: d.filters.map((f) => (f.id === filterId ? { ...f, ...patch } : f)),
            updatedAt: new Date().toISOString(),
          })),
        })),

      removeFilter: (dashboardId, filterId) =>
        set((s) => ({
          dashboards: touch(s.dashboards, dashboardId, (d) => ({
            ...d,
            filters: d.filters.filter((f) => f.id !== filterId),
            updatedAt: new Date().toISOString(),
          })),
        })),

      loadDashboards: (dashboards) => set({ dashboards }),
    }),
    { name: 'metricstudio-dashboards', partialize: (s) => ({ dashboards: s.dashboards }) }
  )
)
```

- [ ] **Step 1.3: Verify TypeScript**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -30`
Expected: no errors from the two new files.

---

## Task 2: Backend — FilterSpec + filter application

**Files:** Modify `backend/models/chart.py`, `backend/api/chart.py`

- [ ] **Step 2.1: Add `FilterSpec` and extend `ChartPreviewRequest` in `backend/models/chart.py`**

Add after `SelectionFilter` (around line 75):

```python
class FilterSpec(CBaseModel):
    """One dashboard filter applied to a dataset before aggregation."""
    field: str
    op: Literal["range", "in"] = "range"
    range: Optional[list] = None      # op=range: [lo, hi]
    values: Optional[list] = None     # op=in: category values


class ChartPreviewRequest(CBaseModel):
    dataset_id: str
    encoding: ChartEncoding
    selection: Optional[SelectionFilter] = None
    filters: Optional[list[FilterSpec]] = None
```

- [ ] **Step 2.2: Add `_filter_by_filters` in `backend/api/chart.py`**

Place next to `_filter_by_selection` (around line 782):

```python
def _filter_by_filters(df: pd.DataFrame, filters: list["FilterSpec"]) -> pd.DataFrame:
    """Apply dashboard filters (range / in) to dataset rows before aggregation."""
    out = df
    for f in filters or []:
        if f.field not in out.columns:
            continue
        series = out[f.field]
        if f.op == "in":
            vals = {str(v) for v in (f.values or [])}
            out = out[series.astype(str).isin(vals)]
        else:
            rng = f.range
            if not rng or len(rng) != 2:
                continue
            lo, hi = rng[0], rng[1]
            numeric = pd.to_numeric(series, errors="coerce")
            if numeric.notna().any():
                out = out[(numeric >= float(lo)) & (numeric <= float(hi))]
            else:
                dt = pd.to_datetime(series, errors="coerce")
                if dt.notna().any():
                    out = out[(dt >= pd.to_datetime(lo)) & (dt <= pd.to_datetime(hi))]
    return out
```

- [ ] **Step 2.3: Apply filters in `preview_chart`**

Replace the `preview_chart` body (lines 814-826):

```python
@router.post("/preview")
async def preview_chart(request: ChartPreviewRequest):
    try:
        dataset = session.get(request.dataset_id)
        df = dataset.df
        if request.filters:
            df = _filter_by_filters(df, request.filters)
        if request.selection:
            df = _filter_by_selection(df, request.selection)
        figure = _aggregate(df, request.encoding)
        return figure
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
```

- [ ] **Step 2.4: Verify backend imports**

Run: `python -c "from backend.api.chart import _filter_by_filters; from backend.models.chart import FilterSpec, ChartPreviewRequest; print('OK')"`
Expected: `OK`

---

## Task 3: API client — filters + project dashboards

**Files:** Modify `src/api/client.ts`

- [ ] **Step 3.1: Extend `previewChart` with `filters`**

Replace `previewChart` (lines 183-187):

```typescript
previewChart: (
  datasetId: string,
  encoding: ChartEncoding,
  selection?: SelectionFilter,
  filters?: { field: string; op: 'range' | 'in'; range?: [string, string]; values?: string[] }[],
) =>
  fetchJson<PlotlyFigure>('/api/v1/chart/preview', {
    method: 'POST',
    body: JSON.stringify({ dataset_id: datasetId, encoding, selection: selection ?? undefined, filters: filters ?? undefined }),
  }),
```

- [ ] **Step 3.2: Add `dashboards` to project save/load**

Add `DashboardConfig` to the import from `@/types/dashboard` (new import line), then update:

```typescript
export interface LoadProjectResponse {
  project: {
    name?: string
    version?: string
    data_sources: { id: string; name: string; rows: number; cols: number }[]
    charts: ChartConfig[]
    dashboards?: DashboardConfig[]
  }
  restored: string[]
  datasets: DataFrameMeta[]
  charts: ChartConfig[]
  dashboards: DashboardConfig[]
}
```

Update `saveProject`:

```typescript
saveProject: (payload: { path: string; name: string; charts?: ChartConfig[]; dashboards?: DashboardConfig[] }) =>
  fetchJson<{ path: string; datasets: number }>('/api/v1/project/save', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
```

- [ ] **Step 3.3: Verify TypeScript**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -30`
Expected: no new errors (note: `project.ts` and `TitleBar.tsx` will need Task 6 before `dashboards` flows through, but TS should still compile since fields are optional).

---

## Task 4: Dashboard UI components

**Files:** Create `src/components/dashboard/DashboardView.tsx`, `DashboardChartCard.tsx`, `DashboardFilterBar.tsx`

- [ ] **Step 4.1: Install and verify `react-grid-layout`**

Run:
```bash
pnpm add react-grid-layout
pnpm add -D @types/react-grid-layout
pnpm tsc --noEmit --pretty 2>&1 | head -20
```

If `react-grid-layout` errors on React 19 peer deps, fall back: implement a self-built grid (CSS Grid, 12 columns; drag via existing `@dnd-kit/core`, resize via a bottom-right handle) and continue the rest of the plan with that in place of the `GridLayout` calls.

- [ ] **Step 4.2: Create `src/components/dashboard/DashboardChartCard.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { Card, CardBody } from '@heroui/react'
import { Settings2, X } from 'lucide-react'
import { PlotlyRenderer } from '@/components/chart/PlotlyRenderer'
import type { ChartConfig } from '@/types/encoding'
import type { PlotlyFigure } from '@/types/plotly'
import { api } from '@/api/client'

export interface DashboardChartCardProps {
  chart: ChartConfig
  filters: { field: string; op: 'range' | 'in'; range?: [string, string]; values?: string[] }[]
  onRemove: () => void
  onEdit: () => void
}

export function DashboardChartCard({ chart, filters, onRemove, onEdit }: DashboardChartCardProps) {
  const [figure, setFigure] = useState<PlotlyFigure | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const timer = setTimeout(() => {
      api.previewChart(chart.datasetId, chart.encoding, undefined, filters)
        .then((f) => { if (!cancelled) setFigure(f) })
        .catch(() => { if (!cancelled) setFigure(null) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 150) // debounce filter changes
    return () => { cancelled = true; clearTimeout(timer) }
  }, [chart.datasetId, chart.encoding, JSON.stringify(filters)])

  return (
    <Card className="h-full border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="truncate text-xs font-medium">{chart.name}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button className="rounded p-0.5 hover:bg-surface-elevated" onClick={onEdit} aria-label="Edit chart">
            <Settings2 className="h-3.5 w-3.5 text-muted" />
          </button>
          <button className="rounded p-0.5 hover:bg-danger/20 hover:text-danger" onClick={onRemove} aria-label="Remove from dashboard">
            <X className="h-3.5 w-3.5 text-muted" />
          </button>
        </div>
      </div>
      <CardBody className="p-0">
        <PlotlyRenderer figure={figure} userLayout={chart.layout} className="h-full w-full" />
      </CardBody>
      {loading && <div className="absolute right-2 top-8 text-[10px] text-muted">…</div>}
    </Card>
  )
}
```

- [ ] **Step 4.3: Create `src/components/dashboard/DashboardFilterBar.tsx`**

```tsx
import { Button, Input, Select, SelectItem } from '@heroui/react'
import { Plus, X } from 'lucide-react'
import type { DashboardFilter } from '@/types/dashboard'
import { useDashboardStore } from '@/stores/dashboardStore'

export function DashboardFilterBar({ dashboardId, filters, columns }: {
  dashboardId: string
  filters: DashboardFilter[]
  columns: { name: string; inferredType: string }[]
}) {
  const addFilter = useDashboardStore((s) => s.addFilter)
  const updateFilter = useDashboardStore((s) => s.updateFilter)
  const removeFilter = useDashboardStore((s) => s.removeFilter)

  const addCategory = () => {
    if (columns.length === 0) return
    const col = columns[0]
    addFilter(dashboardId, { field: col.name, label: col.name, kind: 'category', datasetId: '', value: null })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => (
        <div key={f.id} className="flex items-center gap-1 rounded border border-border bg-surface px-2 py-1">
          <span className="text-[10px] uppercase text-muted">{f.label}</span>
          {f.kind === 'category' ? (
            <Select
              size="sm"
              className="w-40"
              selectionMode="multiple"
              selectedKeys={new Set((f.value as string[]) || [])}
              onSelectionChange={(keys) => updateFilter(dashboardId, f.id, { value: Array.from(keys) as string[] })}
            >
              {columns.filter((c) => c.name === f.field).map((c) => (
                <SelectItem key={c.name}>{c.name}</SelectItem>
              ))}
            </Select>
          ) : (
            <div className="flex items-center gap-1">
              <Input size="sm" className="w-24" placeholder="min" />
              <Input size="sm" className="w-24" placeholder="max" />
            </div>
          )}
          <button className="rounded p-0.5 hover:bg-danger/20" onClick={() => removeFilter(dashboardId, f.id)}>
            <X className="h-3 w-3 text-muted" />
          </button>
        </div>
      ))}
      <Button size="sm" variant="light" startContent={<Plus className="h-3 w-3" />} onPress={addCategory}>
        Filter
      </Button>
    </div>
  )
}
```

- [ ] **Step 4.4: Create `src/components/dashboard/DashboardView.tsx`**

```tsx
import { useMemo, useState } from 'react'
import { Button } from '@heroui/react'
import GridLayout, { WidthProvider } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Plus } from 'lucide-react'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useChartStore } from '@/stores/chartStore'
import { useDataStore } from '@/stores/dataStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { DashboardChartCard } from './DashboardChartCard'
import { DashboardFilterBar } from './DashboardFilterBar'

const Grid = WidthProvider(GridLayout)

export function DashboardView() {
  const dashboards = useDashboardStore((s) => s.dashboards)
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId)
  const createDashboard = useDashboardStore((s) => s.createDashboard)
  const addItem = useDashboardStore((s) => s.addItem)
  const removeItem = useDashboardStore((s) => s.removeItem)
  const moveItem = useDashboardStore((s) => s.moveItem)
  const resizeItem = useDashboardStore((s) => s.resizeItem)
  const charts = useChartStore((s) => s.charts)
  const setActiveChart = useChartStore((s) => s.setActiveChart)
  const columns = useDataStore((s) => s.columns)
  const openChartTab = useWorkspaceStore((s) => s.openChartTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)

  const dashboard = dashboards.find((d) => d.id === activeDashboardId) ?? dashboards[0]

  if (!dashboard) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <p className="text-sm">No dashboard yet</p>
        <Button size="sm" color="primary" startContent={<Plus className="h-3 w-3" />} onPress={createDashboard}>
          New Dashboard
        </Button>
      </div>
    )
  }

  const layout = dashboard.items.map((i) => ({ i: i.chartId, x: i.x, y: i.y, w: i.w, h: i.h, minW: 3, minH: 3 }))

  const filters = dashboard.filters
    .filter((f) => f.value !== null && f.value !== undefined)
    .map((f) =>
      f.kind === 'category'
        ? { field: f.field, op: 'in' as const, values: (f.value as string[]) }
        : { field: f.field, op: 'range' as const, range: (f.value as [string, string]) }
    )

  const availableCharts = charts.filter((c) => !dashboard.items.some((i) => i.chartId === c.id))

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{dashboard.name}</span>
          <Button size="sm" variant="light" startContent={<Plus className="h-3 w-3" />} onPress={createDashboard}>
            New
          </Button>
        </div>
        {availableCharts.length > 0 && (
          <select
            className="rounded border border-border bg-surface px-2 py-1 text-xs"
            value=""
            onChange={(e) => {
              if (e.target.value) { addItem(dashboard.id, e.target.value); e.target.value = '' }
            }}
          >
            <option value="">+ Add chart…</option>
            {availableCharts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
      </div>

      <DashboardFilterBar dashboardId={dashboard.id} filters={dashboard.filters} columns={columns} />

      <div className="min-h-0 flex-1 overflow-auto">
        <Grid
          className="layout"
          layout={layout}
          cols={dashboard.cols}
          rowHeight={dashboard.rowHeight}
          margin={[8, 8]}
          draggableHandle=".drag-handle"
          onLayoutChange={(l) => {
            l.forEach((li) => {
              const item = dashboard.items.find((i) => i.chartId === li.i)
              if (item && (item.x !== li.x || item.y !== li.y)) moveItem(dashboard.id, li.i, li.x, li.y)
              if (item && (item.w !== li.w || item.h !== li.h)) resizeItem(dashboard.id, li.i, li.w, li.h)
            })
          }}
        >
          {dashboard.items.map((item) => {
            const chart = charts.find((c) => c.id === item.chartId)
            if (!chart) return <div key={item.chartId} />
            return (
              <div key={item.chartId} className="drag-handle">
                <DashboardChartCard
                  chart={chart}
                  filters={filters}
                  onRemove={() => removeItem(dashboard.id, item.chartId)}
                  onEdit={() => {
                    setActiveChart(chart.id)
                    openChartTab(chart.id)
                    setActiveTab('chart')
                  }}
                />
              </div>
            )
          })}
        </Grid>
      </div>
    </div>
  )
}
```

- [ ] **Step 4.5: Verify TypeScript**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -40`
Expected: no errors from the three new files.

---

## Task 5: View switch — Dashboard tab

**Files:** Modify `src/stores/workspaceStore.ts`, `src/components/layout/CenterArea.tsx`

- [ ] **Step 5.1: Extend `activeTab` type in `workspaceStore.ts`**

Change `activeTab: 'data' | 'chart'` to `activeTab: 'data' | 'chart' | 'dashboard'` (both the interface field and the initial state `'data'` remain; only the type widens).

- [ ] **Step 5.2: Add Dashboard tab in `CenterArea.tsx`**

Add import `LayoutDashboard` from `lucide-react`, import `DashboardView` and `useDashboardStore`. Then in the tab bar, after the Data tab button and before the chart tabs, add:

```tsx
<button
  className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
    activeTab === 'dashboard' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
  }`}
  onClick={() => setActiveTab('dashboard')}
>
  <LayoutDashboard className="h-3 w-3" />
  Dashboard
</button>
```

And change the tab content render to:

```tsx
{isDataTab ? (
  <DataView />
) : activeTab === 'dashboard' ? (
  <DashboardView />
) : (
  <ChartCanvas />
)}
```

- [ ] **Step 5.3: Verify TypeScript**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -30`
Expected: no errors.

---

## Task 6: Project persistence — dashboards in manifest

**Files:** Modify `backend/api/project.py`, `src/components/layout/TitleBar.tsx`, `src/utils/project.ts`

- [ ] **Step 6.1: Add `dashboards` to save/load in `backend/api/project.py`**

In `save_project`, change `charts = payload.get("charts", [])` and add `dashboards = payload.get("dashboards", [])`; in the manifest dict add `"dashboards": dashboards` and bump `"version": "0.3.0"`.

In `load_project`, return `dashboards` from manifest with a safe default:

```python
return {
    "project": manifest,
    "restored": restored,
    "datasets": [ds.to_meta() for ds in session.list_datasets()],
    "charts": manifest.get("charts", []),
    "dashboards": manifest.get("dashboards", []),
}
```

- [ ] **Step 6.2: Pass dashboards when saving in `TitleBar.tsx`**

In `handleSave`, after `const charts = useChartStore.getState().charts`, add:

```typescript
const dashboards = useDashboardStore.getState().dashboards
const result = await api.saveProject({ path: projectPath, name: projectName, charts, dashboards })
```

(Add `import { useDashboardStore } from '@/stores/dashboardStore'`.)

- [ ] **Step 6.3: Restore dashboards on load in `src/utils/project.ts`**

In `loadProjectByPath`, after `useChartStore.getState().loadCharts(result.charts)`, add:

```typescript
if (result.dashboards && result.dashboards.length > 0) {
  useDashboardStore.getState().loadDashboards(result.dashboards)
}
```

(Add `import { useDashboardStore } from '@/stores/dashboardStore'`.)

- [ ] **Step 6.4: Verify TypeScript**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -30`
Expected: no errors.

---

## Task 7: Verification

- [ ] **Step 7.1: Backend filter tests**

Create `backend/tests/test_dashboard_filters.py`:

```python
import pandas as pd
from backend.api.chart import _filter_by_filters
from backend.models.chart import FilterSpec


def test_range_numeric():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5]})
    out = _filter_by_filters(df, [FilterSpec(field="a", op="range", range=[2, 4])])
    assert out["a"].tolist() == [2, 3, 4]


def test_range_date():
    df = pd.DataFrame({"d": pd.to_datetime(["2024-01-01", "2024-01-02", "2024-01-03"])})
    out = _filter_by_filters(df, [FilterSpec(field="d", op="range", range=["2024-01-02", "2024-01-03"])])
    assert len(out) == 2


def test_in_category():
    df = pd.DataFrame({"c": ["North", "South", "East"]})
    out = _filter_by_filters(df, [FilterSpec(field="c", op="in", values=["North", "East"])])
    assert set(out["c"].tolist()) == {"North", "East"}
```

Run: `pnpm test:backend backend/tests/test_dashboard_filters.py -q`
Expected: 3 passed.

- [ ] **Step 7.2: Full TypeScript check**

Run: `pnpm tsc --noEmit --pretty`
Expected: exit 0.

- [ ] **Step 7.3: Manual smoke (dev)**

Run backend + frontend (`pnpm backend:dev` and `pnpm dev`), then verify:
1. Create a chart, open Dashboard tab, create a dashboard, add charts via "+ Add chart".
2. Drag/resize cards; add a category filter; verify all cards re-render.
3. Save project; reload; verify dashboard layout + filters restore.

---

## Summary

| # | Task | Files | Type |
|---|------|-------|------|
| 1 | Types + dashboardStore | `dashboard.ts`, `dashboardStore.ts` (new) | Feature |
| 2 | Backend FilterSpec + filter apply | `models/chart.py`, `api/chart.py` | Feature |
| 3 | API client filters + dashboards | `api/client.ts` | Feature |
| 4 | Dashboard UI components | `DashboardView/Card/FilterBar.tsx` (new) | Feature |
| 5 | Dashboard tab view switch | `workspaceStore.ts`, `CenterArea.tsx` | Feature |
| 6 | Project persistence | `project.py`, `TitleBar.tsx`, `project.ts` | Feature |
| 7 | Verification | `test_dashboard_filters.py` (new) | Test |

**Total: 7 tasks.** Phase 1 scope only; Phase 2 (in-canvas brush linking, layout templates, interactive HTML export) excluded.
