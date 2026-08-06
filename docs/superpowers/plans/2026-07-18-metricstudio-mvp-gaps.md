# MetricStudio MVP Gap-Filling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-subagent-driven-development (recommended) or superpowers-executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close remaining MVP gaps — verify fixes already applied, fix snake_case/camelCase mismatch in chart models, add Chart JSON download, add Undo UI, improve empty/loading states, and harden error handling.

**Architecture:** This plan covers the frontend React components, backend Python Pydantic models, and API client. It does NOT touch Tauri shell (blocked by missing Rust toolchain) or backend core/data logic. Each gap is isolated; tasks can be executed in any order within the verification/fix phases.

**Tech Stack:** React 19 + TypeScript, Zustand, @tanstack/react-table, @hero-ui/react, Plotly.js, Python FastAPI + Pydantic v2, Pandas

---

## File Inventory

### Files to verify (no changes expected):
| File | What to check |
|------|---------------|
| `src/components/data/DataTable.tsx` | Hooks before early returns |
| `src/components/layout/StatusBar.tsx` | `fmt()` safe number formatting |
| `src/components/common/ErrorBoundary.tsx` | Class-based error boundary |
| `src/components/layout/CenterArea.tsx` | ErrorBoundary wrapping tabs |
| `src/App.tsx` | ErrorBoundary at root + DndContext |
| `index.html` | Plotly loaded from `/plotly.min.js` (local) |
| `public/plotly.min.js` | File exists |
| `backend/models/chart.py` | `ChartEncoding.chart_type` → needs alias fix |
| `backend/models/transform.py` | `UndoRequest.to_index` → needs CBaseModel consistency |
| `backend/api/data.py` | `response_model_by_alias=True` on all routes |
| `backend/api/transform.py` | `response_model_by_alias=True` on all POST routes |

### Files to modify:
| File | Change |
|------|--------|
| `backend/models/transform.py` | Change `BaseModel` → import and use `CBaseModel` for all request models |
| `backend/models/chart.py` | Change `BaseModel` → `CBaseModel` for all request models |
| `backend/models/data.py` | Remove deprecated `validate_by_name` from `CBaseModel.model_config` |
| `src/components/chart/ChartCanvas.tsx` | Add `handleExportJson` handler + wire to Download button |
| `src/components/data/TransformPanel.tsx` | Add Undo button that calls `api.undo()` |
| `src/components/chart/PlotlyRenderer.tsx` | Add error state display when Plotly fails to render |
| `src/components/layout/CenterArea.tsx` | Show welcome empty state when no dataset loaded |
| `src/api/client.ts` | Add `downloadChartJson` method for JSON export |

### Files to create:
| File | Purpose |
|------|---------|
| `src/components/common/LoadingSpinner.tsx` | Reusable loading spinner with optional message |

---

## Phase 1: Verification (5 tasks)

### Task 1: Verify snake_case/camelCase alias chain

**Files:** Read-only verification

- [ ] **Step 1: Verify `CBaseModel` has correct config**

Read `backend/models/data.py` lines 13-20. Confirm `model_config` has:
- `alias_generator = to_camel`
- `populate_by_name = True`
- NO `validate_by_name` (deprecated in Pydantic v2)

If `validate_by_name` is present, it will be removed in Task 6.

- [ ] **Step 2: Verify data API routes use `response_model_by_alias=True`**

Read `backend/api/data.py`. Confirm every route with `response_model=` also has `response_model_by_alias=True`:
- `POST /import`: ✓ (line 13)
- `GET /list`: ✓ (line 28)
- `GET /{dataset_id}`: ✓ (line 33)
- `GET /{dataset_id}/preview`: ✓ (line 41)
- `GET /{dataset_id}/columns`: ✓ (line 51)
- `GET /{dataset_id}/describe`: ✓ (line 59)

Run: `grep -n "response_model_by_alias" backend/api/data.py`
Expected: 6 matches, one per route.

- [ ] **Step 3: Verify transform API routes use `response_model_by_alias=True`**

Run: `grep -n "response_model_by_alias" backend/api/transform.py`
Expected: 7 matches (filter, sort, dropna, fillna, rename, dtype, undo).

- [ ] **Step 4: Verify chart models do NOT use CBaseModel (this is the bug)**

Read `backend/models/chart.py` line 1. Confirm it imports `BaseModel` from pydantic, NOT `CBaseModel`. This is the mismatch — frontend sends `chartType` but backend expects `chart_type`.

Run: `grep -n "class.*BaseModel" backend/models/chart.py`
Expected output: `class EncodingChannel(BaseModel):` and `class ChartEncoding(BaseModel):` etc.

- [ ] **Step 5: Verify frontend API client sends camelCase body for chart preview**

Read `src/api/client.ts` lines 107-111. Confirm `previewChart` sends `encoding` object that contains `chartType` (camelCase) from the `ChartEncoding` TypeScript type.

```typescript
// At line 107-111, expected:
previewChart: (datasetId: string, encoding: ChartEncoding) =>
    fetchJson<PlotlyFigure>('/api/v1/chart/preview', {
      method: 'POST',
      body: JSON.stringify({ dataset_id: datasetId, encoding }),
    }),
```

The variable `encoding` will serialize as `"chartType"` due to the TypeScript type definition in `src/types/encoding.ts` line 21: `chartType: ChartType`.

---

### Task 2: Verify DataTable hook ordering

**Files:** `src/components/data/DataTable.tsx` (read-only)

- [ ] **Step 1: Confirm `useReactTable()` is called unconditionally before any early returns**

Read lines 15-108. Verify the call flow:
1. `useMemo` for columns (line 20-31) — always called
2. `useMemo` for data (line 33-44) — always called
3. `useReactTable` (line 46-50) — always called
4. Early returns (line 53-67) — AFTER all hooks

The key: `const table = useReactTable(...)` on line 46 MUST appear BEFORE the `if (loading && !preview)` on line 53 and the `if (!preview)` on line 61.

Run: `python3 -c "
content = open('src/components/data/DataTable.tsx').read()
hook_pos = content.index('useReactTable')
early_return_1 = content.index('if (loading && !preview)')
assert hook_pos < early_return_1, 'useReactTable called AFTER early return!'
print('OK: useReactTable before early returns')
"`

Expected: `OK: useReactTable before early returns`

---

### Task 3: Verify StatusBar `fmt()` safe number formatting

**Files:** `src/components/layout/StatusBar.tsx` (read-only)

- [ ] **Step 1: Confirm `fmt()` guards against non-number input**

Read lines 5-8:
```typescript
function fmt(n: unknown): string {
  if (typeof n !== 'number') return '0'
  return n.toLocaleString()
}
```

Confirm signature is `(n: unknown)` (not `(n: number)`) and the `typeof` guard exists.

Run: `grep -n "function fmt" src/components/layout/StatusBar.tsx`
Expected: `5: function fmt(n: unknown): string {`

---

### Task 4: Verify ErrorBoundary placement

**Files:** `src/App.tsx`, `src/components/layout/CenterArea.tsx` (read-only)

- [ ] **Step 1: Confirm App-level ErrorBoundary**

Read `src/App.tsx` lines 45-51:
```tsx
return (
  <ErrorBoundary>
    <DndContext onDragEnd={handleDragEnd}>
      <AppShell />
    </DndContext>
  </ErrorBoundary>
)
```

`ErrorBoundary` is the outermost wrapper.

- [ ] **Step 2: Confirm CenterArea-level ErrorBoundary**

Read `src/components/layout/CenterArea.tsx` lines 25-28:
```tsx
<div className="min-h-0 flex-1 p-2">
  <ErrorBoundary>
    {activeTab === 'data' ? <DataView /> : <ChartCanvas />}
  </ErrorBoundary>
</div>
```

The ErrorBoundary wraps the tab content (DataView/ChartCanvas), protecting the center area from crashes.

- [ ] **Step 3: Confirm ErrorBoundary component exists**

Read `src/components/common/ErrorBoundary.tsx`. Confirm it's a class component with:
- `getDerivedStateFromError` (static)
- `componentDidCatch`
- A fallback UI with danger-styled error card
- Accepts optional `fallback` prop

---

### Task 5: Verify Plotly.js loads locally (not CDN)

**Files:** `index.html`, `public/plotly.min.js` (read-only)

- [ ] **Step 1: Confirm script tag points to local file**

Read `index.html` line 11:
```html
<script src="/plotly.min.js" charset="utf-8"></script>
```

The path `/plotly.min.js` must NOT be a CDN URL.

Run: `python3 -c "
html = open('index.html').read()
assert 'cdn.plot.ly' not in html, 'Found CDN reference in index.html!'
assert 'src=\"/plotly.min.js\"' in html, 'Missing local plotly.min.js script tag'
print('OK: Plotly loaded from local file')
"`

Expected: `OK: Plotly loaded from local file`

- [ ] **Step 2: Confirm plotly.min.js exists in public/**

Run: `ls -lh public/plotly.min.js`
Expected: Shows file size (should be several MB, e.g. 5-8 MB). If file doesn't exist or is 0 bytes, this needs remediation.

- [ ] **Step 3: Confirm plotly.min.js is not a placeholder**

Run: `head -c 200 public/plotly.min.js`
Expected: First bytes should be JavaScript (e.g., `/*! Plotly.js ...` or minified JS). NOT "PLACEHOLDER" or a message.

---

## Phase 2: Fix Remaining Gaps (6 tasks)

### Task 6: Fix snake_case/camelCase mismatch in chart and transform models

**Files:**
- Modify: `backend/models/data.py:16-20` — remove deprecated `validate_by_name`
- Modify: `backend/models/transform.py:1-2` — import CBaseModel instead of BaseModel
- Modify: `backend/models/chart.py:1-2` — import CBaseModel instead of BaseModel

**Background:** The chart Pydantic model `ChartEncoding` has field `chart_type` but the frontend sends `chartType` (camelCase). The CBaseModel with `alias_generator = to_camel` and `populate_by_name = True` will accept both. Currently, `chart.py` and `transform.py` models use plain `BaseModel`.

- [ ] **Step 1: Remove deprecated `validate_by_name` from CBaseModel**

In `backend/models/data.py`, find:
```python
class CBaseModel(BaseModel):
    """Pydantic base model that serializes with camelCase aliases."""
    model_config = {
        "alias_generator": to_camel,
        "populate_by_name": True,
        "validate_by_name": True,
    }
```

Remove the `"validate_by_name": True,` line (deprecated in Pydantic v2, `populate_by_name=True` already covers it):

```python
class CBaseModel(BaseModel):
    """Pydantic base model that serializes with camelCase aliases."""
    model_config = {
        "alias_generator": to_camel,
        "populate_by_name": True,
    }
```

- [ ] **Step 2: Import CBaseModel in transform models**

In `backend/models/transform.py:1-2`, change:
```python
from pydantic import BaseModel
from typing import Optional, Literal
```

To:
```python
from backend.models.data import CBaseModel
from typing import Optional, Literal
```

Now change every class declaration from `(BaseModel)` to `(CBaseModel)`:
- `class FilterRequest(BaseModel):` → `class FilterRequest(CBaseModel):`
- `class SortRequest(BaseModel):` → `class SortRequest(CBaseModel):`
- `class DropNaRequest(BaseModel):` → `class DropNaRequest(CBaseModel):`
- `class FillNaRequest(BaseModel):` → `class FillNaRequest(CBaseModel):`
- `class RenameRequest(BaseModel):` → `class RenameRequest(CBaseModel):`
- `class DTypeRequest(BaseModel):` → `class DTypeRequest(CBaseModel):`
- `class UndoRequest(BaseModel):` → `class UndoRequest(CBaseModel):`

- [ ] **Step 3: Import CBaseModel in chart models**

In `backend/models/chart.py:1-2`, change:
```python
from pydantic import BaseModel
from typing import Optional, Literal
```

To:
```python
from backend.models.data import CBaseModel
from typing import Optional, Literal
```

And change every class declaration:
- `class EncodingChannel(BaseModel):` → `class EncodingChannel(CBaseModel):`
- `class ChartEncoding(BaseModel):` → `class ChartEncoding(CBaseModel):`
- `class ChartPreviewRequest(BaseModel):` → `class ChartPreviewRequest(CBaseModel):`
- `class AggregateRequest(BaseModel):` → `class AggregateRequest(CBaseModel):`

- [ ] **Step 4: Verify backend starts and loads models correctly**

Run: `.venv/bin/python -c "
from backend.models.data import CBaseModel, DataFrameMeta
from backend.models.transform import FilterRequest, UndoRequest
from backend.models.chart import ChartEncoding, ChartPreviewRequest
m = ChartEncoding(chartType='scatter', x={'field': 'col', 'type': 'quantitative'})
print(f'chartType=\"{m.chart_type}\" (expected \"scatter\")')
assert m.chart_type == 'scatter', 'chart_type not populated from chartType alias!'
assert m.x is not None and m.x.field == 'col'
print('OK: Chart models accept camelCase input via CBaseModel')
"`

Expected:
```
chartType="scatter" (expected "scatter")
OK: Chart models accept camelCase input via CBaseModel
```

- [ ] **Step 5: Verify publish_by_name also works (backward compat)**

Run: `.venv/bin/python -c "
from backend.models.chart import ChartEncoding
m = ChartEncoding(chart_type='bar', x={'field': 'col', 'type': 'nominal'})
assert m.chart_type == 'bar'
print('OK: snake_case input still works')
"`

Expected: `OK: snake_case input still works`

---

### Task 7: Add Chart JSON download button functionality

**Files:**
- Modify: `src/components/chart/ChartCanvas.tsx` — add `handleExportJson` handler + wire to button

- [ ] **Step 1: Add `handleExportJson` function in ChartCanvas**

In `src/components/chart/ChartCanvas.tsx`, after the `handleExportPng` function (after line 61, before the return), add:

```typescript
const handleExportJson = () => {
  if (!previewFigure) return
  try {
    const json = JSON.stringify(previewFigure, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'chart.json'
    a.click()
    URL.revokeObjectURL(url)
    addNotification('success', 'Chart JSON exported')
  } catch (err) {
    addNotification('error', err instanceof Error ? err.message : 'JSON export failed')
  }
}
```

- [ ] **Step 2: Wire the Download button to `handleExportJson`**

Find the Download button at lines 90-92:
```tsx
<Button isIconOnly size="sm" variant="light" aria-label="Download plotly JSON">
  <Download className="h-4 w-4" />
</Button>
```

Add `onPress={handleExportJson}`:
```tsx
<Button
  isIconOnly
  size="sm"
  variant="light"
  aria-label="Download plotly JSON"
  onPress={handleExportJson}
>
  <Download className="h-4 w-4" />
</Button>
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -40`
Expected: No errors related to `ChartCanvas.tsx`. The file should compile without issues.

If errors appear, fix them. Common issues: `handleExportJson` not properly closed, or a missing semicolon.

---

### Task 8: Add Undo button in TransformPanel

**Files:**
- Modify: `src/components/data/TransformPanel.tsx` — add Undo section

- [ ] **Step 1: Add undo handler and UI section in TransformPanel**

In `src/components/data/TransformPanel.tsx`, add an import for `RotateCcw` icon at the top with the other lucide imports (currently at line 1 — there's no lucide import; the file uses Button/Input/Select from @heroui/react). Check the imports and add:

Add `RotateCcw` to the existing lucide import if one exists, or add a new import line. Looking at the file, there's no direct lucide import. Add it after the existing imports at the top of the file:

```typescript
import { RotateCcw } from 'lucide-react'
```

- [ ] **Step 2: Add undo state variable and handler**

After the `loading` state at line 30:
```typescript
const [undoing, setUndoing] = useState(false)
```

Add the `handleUndo` method after `handleRename` (after line 91, before the `if (!activeId)` early return):

```typescript
const handleUndo = async () => {
  if (!activeId) return
  setUndoing(true)
  try {
    const preview = await api.undo(activeId)
    updatePreview(preview)
    useDataStore.getState().refreshActiveDataFrame()
    addNotification('success', 'Undo applied')
  } catch (err) {
    addNotification('error', err instanceof Error ? err.message : 'Undo failed')
  } finally {
    setUndoing(false)
  }
}
```

- [ ] **Step 3: Add Undo button in the UI**

After the Rename section (after the `</CardBody>` closing), add an Undo section inside the CardBody:

Inside the `<CardBody className="gap-3">` block, after the Rename div (which ends at line 199), add:

```tsx
<div className="flex flex-col gap-1">
  <span className="text-[10px] uppercase text-muted">Undo</span>
  <Button
    size="sm"
    color="warning"
    variant="flat"
    isLoading={undoing}
    startContent={<RotateCcw className="h-3 w-3" />}
    onPress={handleUndo}
  >
    Undo Last Operation
  </Button>
</div>
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -40`
Expected: No errors. If `RotateCcw` is not recognized, check that `lucide-react` version (0.510.0) exports it — it should. The icon was introduced in lucide-react v0.20+, and 0.510.0 is well above that.

Also verify the `undoing` state variable name doesn't conflict with `loading` (line 30). They are different variables — correct.

---

### Task 9: Better empty/loading states

**Files:**
- Create: `src/components/common/LoadingSpinner.tsx`
- Modify: `src/components/layout/CenterArea.tsx` — add welcome empty state
- Modify: `src/components/chart/ChartCanvas.tsx` — handle no-chart download buttons

- [ ] **Step 1: Create LoadingSpinner component**

Create `src/components/common/LoadingSpinner.tsx`:

```typescript
import { Spinner } from '@heroui/react'

interface LoadingSpinnerProps {
  message?: string
  className?: string
}

export function LoadingSpinner({ message = 'Loading...', className = '' }: LoadingSpinnerProps) {
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-2 ${className}`}>
      <Spinner size="sm" />
      <p className="text-xs text-muted">{message}</p>
    </div>
  )
}
```

- [ ] **Step 2: Add empty state to CenterArea when no dataset loaded**

In `src/components/layout/CenterArea.tsx`, add import for the stores at top (already imports `useWorkspaceStore`). Add import for `useDataStore` and the `Database` icon:

```typescript
import { Database } from 'lucide-react'
import { useDataStore } from '@/stores/dataStore'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
```

Then, in the component, add an early return before the tabs when no dataset is loaded:

```typescript
export function CenterArea() {
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const dataFrames = useDataStore((s) => s.dataFrames)
  const loading = useDataStore((s) => s.loading)

  if (loading && dataFrames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <LoadingSpinner message="Loading datasets..." />
      </div>
    )
  }

  if (dataFrames.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-muted">
        <Database className="h-12 w-12 opacity-20" />
        <p className="text-sm">No dataset loaded</p>
        <p className="text-xs">Import a CSV, Excel, or Parquet file to get started.</p>
      </div>
    )
  }

  // ...existing tabs and content...
```

- [ ] **Step 3: Disable download buttons when no chart is active**

In `src/components/chart/ChartCanvas.tsx`, add `isDisabled` to the download buttons when there's no `previewFigure` or `activeChart`:

Find the toolbar div at lines 84-92 and modify:

```tsx
<div className="flex items-center gap-1">
  {activeDataFrameId && (
    <Button size="sm" color="primary" onPress={() => createChart(activeDataFrameId)}>
      New Chart
    </Button>
  )}
  <Button
    isIconOnly
    size="sm"
    variant="light"
    isDisabled={!previewFigure}
    onPress={handleExportHtml}
    aria-label="Export HTML"
  >
    <FileCode className="h-4 w-4" />
  </Button>
  <Button
    isIconOnly
    size="sm"
    variant="light"
    isDisabled={!previewFigure}
    onPress={handleExportPng}
    aria-label="Export PNG"
  >
    <Image className="h-4 w-4" />
  </Button>
  <Button
    isIconOnly
    size="sm"
    variant="light"
    isDisabled={!previewFigure}
    onPress={handleExportJson}
    aria-label="Download plotly JSON"
  >
    <Download className="h-4 w-4" />
  </Button>
</div>
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -40`
Expected: No errors.

---

### Task 10: Better error handling throughout

**Files:**
- Modify: `src/components/chart/PlotlyRenderer.tsx` — add error state
- Modify: `src/api/client.ts` — improve error message formatting

- [ ] **Step 1: Add error state to PlotlyRenderer**

In `src/components/chart/PlotlyRenderer.tsx`, add an `error` state and catch render errors:

Add to the state declarations (after line 17 `const [ready, setReady] = useState(false)`):
```typescript
const [renderError, setRenderError] = useState<string | null>(null)
```

Modify the Plotly.react useEffect (lines 35-65). In the try block, add `setRenderError(null)` and in the catch block, set the error state:

```typescript
useEffect(() => {
  if (!containerRef.current || !figure || !ready) return

  const el = containerRef.current
  try {
    setRenderError(null)
    Plotly.react(el, figure.data, figure.layout, {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
    })
  } catch (err) {
    setRenderError(err instanceof Error ? err.message : 'Plotly render failed')
  }

  const handleResize = () => {
    try {
      Plotly.Plots.resize(el)
    } catch {
      // ignore resize errors
    }
  }
  window.addEventListener('resize', handleResize)
  return () => {
    window.removeEventListener('resize', handleResize)
    try {
      Plotly.purge(el)
    } catch {
      // ignore
    }
  }
}, [figure, ready])
```

Add an error state render block before the normal render:

```typescript
if (renderError) {
  return (
    <div className={`flex items-center justify-center ${className}`}>
      <div className="rounded border border-danger bg-danger/10 p-3 text-center text-xs text-danger">
        <p className="font-semibold">Chart render error</p>
        <p className="mt-1">{renderError}</p>
      </div>
    </div>
  )
}
```

Place this after the `if (!ready)` check and before the `if (!figure)` check.

- [ ] **Step 2: Improve API client error messages**

In `src/api/client.ts`, update the `fetchJson` function (lines 26-36) to include more context:

```typescript
async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body.detail || JSON.stringify(body)
    } catch {
      detail = await response.text().catch(() => 'Unknown error')
    }
    throw new Error(`${response.status} ${response.statusText}: ${path} — ${detail}`)
  }
  return response.json() as Promise<T>
}
```

Similarly update `postForm` (lines 38-48):

```typescript
async function postForm<T>(path: string, formData: FormData): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body.detail || JSON.stringify(body)
    } catch {
      detail = await response.text().catch(() => 'Unknown error')
    }
    throw new Error(`${response.status} ${response.statusText}: ${path} — ${detail}`)
  }
  return response.json() as Promise<T>
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `pnpm tsc --noEmit --pretty 2>&1 | head -40`
Expected: No errors.

---

## Phase 3: End-to-End Verification

### Task 11: Run backend and verify all fixes

**Files:** None (verification only)

- [ ] **Step 1: Start the backend server**

Run: `.venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8123 &`
(Press Enter after it starts, or use `nohup`)

Wait 3 seconds, then verify:
```bash
curl -s http://127.0.0.1:8123/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 2: Test chart preview API with camelCase input**

Run: `curl -s -X POST http://127.0.0.1:8123/api/v1/chart/preview -H "Content-Type: application/json" -d '{"dataset_id":"nonexistent","encoding":{"chartType":"scatter","x":{"field":"col","type":"quantitative"}}}'`

Expected: A 404 error response (dataset doesn't exist), but critically NOT a 422 validation error about `chartType`. A 404 means the model accepted `chartType` as input.

```bash
# Check if we get 422 (validation error) - that would mean alias isn't working
curl -s -X POST http://127.0.0.1:8123/api/v1/chart/preview -H "Content-Type: application/json" -d '{"dataset_id":"nonexistent","encoding":{"chartType":"scatter","x":{"field":"col","type":"quantitative"}}}' | python3 -c "import sys,json; d=json.load(sys.stdin); print('Status:', d.get('detail','')[:100])"
```

If the output starts with "Dataset not found", the alias is working. If it starts with a validation error mentioning `chart_type`, the fix in Task 6 failed.

- [ ] **Step 3: Test data API with camelCase response**

Run: `curl -s http://127.0.0.1:8123/api/v1/data/list | python3 -m json.tool`

If empty, expected: `[]` (no datasets loaded, but properly formatted JSON).

If datasets exist, verify keys are camelCase:
```bash
curl -s http://127.0.0.1:8123/api/v1/data/list | python3 -c "
import sys, json
data = json.load(sys.stdin)
if data:
    keys = list(data[0].keys())
    camel = ['id','name','engine','rows','cols','columns','createdAt']
    for k in camel:
        assert k in keys, f'Missing camelCase key: {k}'
    print('OK: All keys are camelCase:', keys)
else:
    print('No data (empty list) - endpoint works')
"
```

- [ ] **Step 4: Start frontend dev server**

Run: `pnpm dev`

Wait 5 seconds, then verify:
```bash
curl -s http://localhost:5173 | head -5
```

Expected: HTML response with `<div id="root"></div>`.

- [ ] **Step 5: Verify frontend loads without runtime errors**

In the browser (or using a headless check), open `http://localhost:5173`. Open devtools console. Expected: No "Uncaught TypeError" or "React hook" warnings.

```bash
# Check dev server is running
curl -s -o /dev/null -w "%{http_code}" http://localhost:5173
```

Expected: `200`

- [ ] **Step 6: Kill background processes**

```bash
# Kill backend uvicorn
pkill -f "uvicorn backend.main:app" 2>/dev/null || true
# Kill frontend vite
pkill -f "vite" 2>/dev/null || true
```

---

## Summary

| # | Task | Files Changed | Type |
|---|------|---------------|------|
| 1 | Verify snake_case/camelCase chain | Read-only | Verification |
| 2 | Verify DataTable hook ordering | Read-only | Verification |
| 3 | Verify StatusBar fmt() | Read-only | Verification |
| 4 | Verify ErrorBoundary placement | Read-only | Verification |
| 5 | Verify Plotly local loading | Read-only | Verification |
| 6 | Fix snake_case/camelCase in chart/transform models | `backend/models/data.py`, `transform.py`, `chart.py` | Fix |
| 7 | Add Chart JSON download | `src/components/chart/ChartCanvas.tsx` | Feature |
| 8 | Add Undo button in TransformPanel | `src/components/data/TransformPanel.tsx` | Feature |
| 9 | Better empty/loading states | `LoadingSpinner.tsx` (new), `CenterArea.tsx`, `ChartCanvas.tsx` | Polish |
| 10 | Better error handling | `PlotlyRenderer.tsx`, `api/client.ts` | Polish |
| 11 | End-to-end verification | None | Verification |

**Total: 11 tasks** — 5 read-only verification + 5 implementation (fix/feature/polish) + 1 end-to-end verification
