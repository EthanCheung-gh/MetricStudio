import { useState } from 'react'
import GridLayout, { WidthProvider } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import { Button } from '@heroui/react'
import { Download, Plus, Save, X } from 'lucide-react'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useChartStore } from '@/stores/chartStore'
import { useDataStore } from '@/stores/dataStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'
import { DashboardChartCard, type DashboardCardFilter } from './DashboardChartCard'
import { DashboardFilterBar } from './DashboardFilterBar'

const Grid = WidthProvider(GridLayout)

export function DashboardView() {
  const dashboards = useDashboardStore((s) => s.dashboards)
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId)
  const createDashboard = useDashboardStore((s) => s.createDashboard)
  const setActiveDashboard = useDashboardStore((s) => s.setActiveDashboard)
  const addItem = useDashboardStore((s) => s.addItem)
  const removeItem = useDashboardStore((s) => s.removeItem)
  const moveItem = useDashboardStore((s) => s.moveItem)
  const resizeItem = useDashboardStore((s) => s.resizeItem)
  const brushSelections = useDashboardStore((s) => s.brushSelections)
  const setBrushSelection = useDashboardStore((s) => s.setBrushSelection)
  const clearBrushSelection = useDashboardStore((s) => s.clearBrushSelection)
  const clearAllBrushes = useDashboardStore((s) => s.clearAllBrushes)
  const layoutTemplates = useDashboardStore((s) => s.layoutTemplates)
  const saveLayoutTemplate = useDashboardStore((s) => s.saveLayoutTemplate)
  const applyLayoutTemplate = useDashboardStore((s) => s.applyLayoutTemplate)
  const charts = useChartStore((s) => s.charts)
  const setActiveChart = useChartStore((s) => s.setActiveChart)
  const columns = useDataStore((s) => s.columns)
  const preview = useDataStore((s) => s.preview)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const openChartTab = useWorkspaceStore((s) => s.openChartTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const addNotification = useUIStore((s) => s.addNotification)
  const [exporting, setExporting] = useState(false)

  const dashboard = dashboards.find((d) => d.id === activeDashboardId) ?? dashboards[0]
  const activeBrushes = dashboard ? (brushSelections[dashboard.id] ?? {}) : {}

  if (!dashboard) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
        <p className="text-sm">No dashboard yet</p>
        <Button size="sm" color="primary" startContent={<Plus className="h-3 w-3" />} onPress={() => createDashboard()}>
          New Dashboard
        </Button>
      </div>
    )
  }

  const layout = dashboard.items.map((i) => ({
    i: i.chartId,
    x: i.x,
    y: i.y,
    w: i.w,
    h: i.h,
    minW: 3,
    minH: 3,
  }))

  const filters: DashboardCardFilter[] = dashboard.filters
    .map((f): DashboardCardFilter | null => {
      if (f.value === null || f.value === undefined) return null
      if (f.kind === 'category') {
        const values = f.value as string[]
        return values.length > 0 ? { field: f.field, op: 'in', values } : null
      }
      const range = f.value as [string, string]
      if (range.length !== 2 || (range[0] === '' && range[1] === '')) return null
      return { field: f.field, op: 'range', range }
    })
    .filter((f): f is DashboardCardFilter => f !== null)

  const availableCharts = charts.filter((c) => !dashboard.items.some((i) => i.chartId === c.id))

  const handleExportHtml = async () => {
    setExporting(true)
    try {
      const figures = []
      for (const item of dashboard.items) {
        const chart = charts.find((c) => c.id === item.chartId)
        if (!chart) continue
        const externalBrushes = dashboard.items
          .filter((i) => i.chartId !== item.chartId)
          .map((i) => activeBrushes[i.chartId])
          .filter((b): b is NonNullable<typeof b> => Boolean(b))
        const figure = await api.previewChart(
          chart.datasetId,
          chart.encoding,
          undefined,
          filters,
          externalBrushes,
        )
        figures.push({ name: chart.name, figure })
      }
      const { html } = await api.generateReport({
        title: dashboard.name,
        dataset_id: activeDataFrameId ?? undefined,
        charts: figures,
        notes: '',
        include_insights: false,
      })
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${dashboard.name.replace(/[^\w-]+/g, '_')}.html`
      a.click()
      URL.revokeObjectURL(url)
      addNotification('success', `Dashboard exported with ${figures.length} chart(s)`)
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : 'Dashboard export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex h-full flex-col gap-2 p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            className="rounded border border-border bg-surface px-2 py-1 text-sm font-semibold"
            value={dashboard.id}
            onChange={(e) => setActiveDashboard(e.target.value)}
          >
            {dashboards.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="light" startContent={<Plus className="h-3 w-3" />} onPress={() => createDashboard()}>
            New
          </Button>
          {Object.keys(activeBrushes).length > 0 && (
            <button
              className="flex items-center gap-1 rounded bg-primary/15 px-2 py-1 text-[11px] text-primary hover:bg-primary/25"
              onClick={() => clearAllBrushes(dashboard.id)}
            >
              <X className="h-3 w-3" />
              Clear brushes ({Object.keys(activeBrushes).length})
            </button>
          )}
          {dashboard.items.length > 0 && (
            <Button
              size="sm"
              variant="light"
              startContent={<Save className="h-3 w-3" />}
              onPress={() => saveLayoutTemplate(dashboard.id, `Layout ${layoutTemplates.length + 1}`)}
            >
              Save layout
            </Button>
          )}
          <Button
            size="sm"
            variant="light"
            isDisabled={dashboard.items.length === 0}
            isLoading={exporting}
            startContent={<Download className="h-3 w-3" />}
            onPress={handleExportHtml}
          >
            Export
          </Button>
          {layoutTemplates.length > 0 && (
            <select
              className="rounded border border-border bg-surface px-2 py-1 text-[11px]"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  applyLayoutTemplate(dashboard.id, e.target.value)
                  e.target.value = ''
                }
              }}
            >
              <option value="">
                <span className="text-muted">Apply layout…</span>
              </option>
              {layoutTemplates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {availableCharts.length > 0 && (
          <select
            className="rounded border border-border bg-surface px-2 py-1 text-xs"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                addItem(dashboard.id, e.target.value)
                e.target.value = ''
              }
            }}
          >
            <option value="">+ Add chart…</option>
            {availableCharts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <DashboardFilterBar
        dashboardId={dashboard.id}
        filters={dashboard.filters}
        columns={columns}
        preview={preview}
        datasetId={activeDataFrameId}
      />

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
              if (!item) return
              if (item.x !== li.x || item.y !== li.y) moveItem(dashboard.id, li.i, li.x, li.y)
              if (item.w !== li.w || item.h !== li.h) resizeItem(dashboard.id, li.i, li.w, li.h)
            })
          }}
        >
          {dashboard.items.map((item) => {
            const chart = charts.find((c) => c.id === item.chartId)
            if (!chart) return <div key={item.chartId} />
            return (
              <div key={item.chartId} className="h-full">
                <DashboardChartCard
                  chart={chart}
                  filters={filters}
                  externalBrushes={dashboard.items
                    .filter((i) => i.chartId !== item.chartId)
                    .map((i) => activeBrushes[i.chartId])
                    .filter((b): b is NonNullable<typeof b> => Boolean(b))}
                  onRemove={() => removeItem(dashboard.id, item.chartId)}
                  onEdit={() => {
                    setActiveChart(chart.id)
                    openChartTab(chart.id)
                    setActiveTab('chart')
                  }}
                  onBrushChange={(sel) => {
                    if (sel) setBrushSelection(dashboard.id, item.chartId, sel)
                    else clearBrushSelection(dashboard.id, item.chartId)
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
