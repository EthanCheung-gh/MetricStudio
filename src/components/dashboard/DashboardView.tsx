import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import GridLayout, { WidthProvider } from 'react-grid-layout/legacy'
import 'react-grid-layout/css/styles.css'
import { Button, Input, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react'
import { Check, Download, Pencil, Plus, Presentation, Save, Trash2, X } from 'lucide-react'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useChartStore } from '@/stores/chartStore'
import { useDataStore } from '@/stores/dataStore'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'
import { DashboardChartCard } from './DashboardChartCard'
import type { DashboardDataFilter } from '@/types/dashboard'
import { applyPlotlyUserStyle } from '@/utils/plotlyLayout'
import { DashboardFilterBar } from './DashboardFilterBar'
import { KpiCard } from './KpiCard'
import { TextCard } from './TextCard'

const Grid = WidthProvider(GridLayout)

export function DashboardView() {
  const { t } = useTranslation()
  const dashboards = useDashboardStore((s) => s.dashboards)
  const activeDashboardId = useDashboardStore((s) => s.activeDashboardId)
  const createDashboard = useDashboardStore((s) => s.createDashboard)
  const removeDashboard = useDashboardStore((s) => s.removeDashboard)
  const renameDashboard = useDashboardStore((s) => s.renameDashboard)
  const setActiveDashboard = useDashboardStore((s) => s.setActiveDashboard)
  const addItem = useDashboardStore((s) => s.addItem)
  const addKpiItem = useDashboardStore((s) => s.addKpiItem)
  const addTextItem = useDashboardStore((s) => s.addTextItem)
  const updateItemText = useDashboardStore((s) => s.updateItemText)
  const updateItemKpi = useDashboardStore((s) => s.updateItemKpi)
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
  const removeLayoutTemplate = useDashboardStore((s) => s.removeLayoutTemplate)
  const charts = useChartStore((s) => s.charts)
  const setActiveChart = useChartStore((s) => s.setActiveChart)
  const dataFrames = useDataStore((s) => s.dataFrames)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const openChartTab = useWorkspaceStore((s) => s.openChartTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const addNotification = useUIStore((s) => s.addNotification)
  const [exporting, setExporting] = useState(false)
  const [selectedChart, setSelectedChart] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [presenting, setPresenting] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [dashboardName, setDashboardName] = useState('')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const dashboard = dashboards.find((d) => d.id === activeDashboardId) ?? dashboards[0]
  const activeBrushes = dashboard ? (brushSelections[dashboard.id] ?? {}) : {}

  useEffect(() => {
    setEditingName(false)
    setDashboardName(dashboard?.name ?? '')
    setDeleteOpen(false)
  }, [dashboard?.id, dashboard?.name])

  // Presentation mode: fullscreen the canvas, auto-cycle dashboards, hide chrome.
  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setPresenting(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  useEffect(() => {
    if (!presenting || dashboards.length < 2) return
    const timer = setInterval(() => {
      const idx = dashboards.findIndex((d) => d.id === activeDashboardId)
      setActiveDashboard(dashboards[(idx + 1) % dashboards.length].id)
    }, 8000)
    return () => clearInterval(timer)
  }, [presenting, dashboards, activeDashboardId, setActiveDashboard])

  const togglePresent = async () => {
    if (!presenting) {
      try {
        await containerRef.current?.requestFullscreen()
        setPresenting(true)
      } catch {
        // Fullscreen unavailable; ignore.
      }
    } else {
      await document.exitFullscreen().catch(() => {})
      setPresenting(false)
    }
  }

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

  const filters: DashboardDataFilter[] = dashboard.filters
    .map((f): DashboardDataFilter | null => {
      if (f.value === null || f.value === undefined) return null
      if (f.kind === 'category') {
        const values = f.value as string[]
        return values.length > 0 ? { datasetId: f.datasetId, field: f.field, op: 'in', values } : null
      }
      const range = f.value as [string, string]
      if (range.length !== 2 || (range[0] === '' && range[1] === '')) return null
      return { datasetId: f.datasetId, field: f.field, op: 'range', range }
    })
    .filter((f): f is DashboardDataFilter => f !== null)

  const availableCharts = charts.filter((c) => !dashboard.items.some((i) => i.chartId === c.id))

  const commitDashboardName = () => {
    const name = dashboardName.trim()
    if (name && name !== dashboard.name) renameDashboard(dashboard.id, name)
    else setDashboardName(dashboard.name)
    setEditingName(false)
  }

  const handleExportHtml = async () => {
    setExporting(true)
    try {
      const figures = []
      const kpis = []
      const textCards = []
      for (const item of dashboard.items) {
        if (item.kind === 'kpi' && item.kpi?.field) {
          const relevantFilters = filters.filter((filter) => filter.datasetId === item.kpi?.datasetId)
          const result = await api.aggregateValue(
            item.kpi.datasetId,
            item.kpi.field,
            item.kpi.aggregate,
            relevantFilters,
          )
          kpis.push({
            label: item.kpi.label || item.kpi.field,
            value: result.value === null ? '—' : String(result.value),
            detail: `${item.kpi.aggregate} · ${item.kpi.field}`,
          })
          continue
        }
        if (item.kind === 'text') {
          if (item.text?.trim()) textCards.push({ text: item.text })
          continue
        }
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
          filters.filter((filter) => filter.datasetId === chart.datasetId),
          externalBrushes,
        )
        figures.push({ name: chart.name, figure: applyPlotlyUserStyle(figure, chart.layout) })
      }
      const { html } = await api.generateReport({
        title: dashboard.name,
        dataset_id: activeDataFrameId ?? undefined,
        charts: figures,
        kpis,
        text_cards: textCards,
        notes: '',
        include_insights: false,
        locale: useUIStore.getState().language,
      })
      const blob = new Blob([html], { type: 'text/html' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${dashboard.name.replace(/[^\w-]+/g, '_')}.html`
      a.click()
      URL.revokeObjectURL(url)
      addNotification('success', t('dashboard.exported', { charts: figures.length, kpis: kpis.length, texts: textCards.length }))
    } catch (err) {
      addNotification('error', err instanceof Error ? err.message : t('dashboard.exportFailed'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div ref={containerRef} className="relative flex h-full flex-col gap-2 bg-surface p-2">
      {presenting && (
        <button
          className="absolute right-3 top-3 z-10 rounded bg-surface-elevated p-1.5 text-muted hover:text-foreground"
          onClick={togglePresent}
          aria-label="Exit presentation"
        >
          <X className="h-4 w-4" />
        </button>
      )}
      {!presenting && (
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {editingName ? (
            <div className="flex items-center gap-1">
              <Input
                size="sm"
                value={dashboardName}
                onValueChange={setDashboardName}
                aria-label={t('dashboard.name')}
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitDashboardName()
                  if (event.key === 'Escape') {
                    setDashboardName(dashboard.name)
                    setEditingName(false)
                  }
                }}
              />
              <Button isIconOnly size="sm" variant="light" onPress={commitDashboardName} aria-label={t('dashboard.saveName')}>
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
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
              <Button isIconOnly size="sm" variant="light" onPress={() => setEditingName(true)} aria-label={t('dashboard.rename')}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button isIconOnly size="sm" variant="light" onPress={() => setDeleteOpen(true)} aria-label={t('dashboard.delete')}>
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </div>
          )}
          <Button size="sm" variant="light" startContent={<Plus className="h-3 w-3" />} onPress={() => createDashboard()}>
            {t('dashboard.new')}
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
          <Button
            size="sm"
            variant="light"
            isDisabled={dashboard.items.length === 0}
            startContent={<Presentation className="h-3 w-3" />}
            onPress={togglePresent}
          >
            Present
          </Button>
          {layoutTemplates.length > 0 && (
            <div className="flex items-center gap-1">
              <select
                className="rounded border border-border bg-surface px-2 py-1 text-[11px]"
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
              >
                <option value="">{t('dashboard.chooseLayout')}</option>
                {layoutTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="light"
                isDisabled={!selectedTemplate}
                onPress={() => selectedTemplate && applyLayoutTemplate(dashboard.id, selectedTemplate)}
              >
                {t('dashboard.applyLayout')}
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                isDisabled={!selectedTemplate}
                onPress={() => {
                  if (selectedTemplate) removeLayoutTemplate(selectedTemplate)
                  setSelectedTemplate('')
                }}
                aria-label={t('dashboard.deleteLayout')}
              >
                <Trash2 className="h-3.5 w-3.5 text-danger" />
              </Button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="light"
            isDisabled={!activeDataFrameId}
            onPress={() =>
              activeDataFrameId &&
              addKpiItem(dashboard.id, { datasetId: activeDataFrameId, field: '', aggregate: 'sum' })
            }
          >
            + KPI
          </Button>
          <Button size="sm" variant="light" onPress={() => addTextItem(dashboard.id)}>
            + Text
          </Button>
          {availableCharts.length > 0 && (
            <select
              className="rounded border border-border bg-surface px-2 py-1 text-xs"
              value={selectedChart}
              onChange={(e) => {
                if (e.target.value) {
                  addItem(dashboard.id, e.target.value)
                }
                setSelectedChart('')
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
      </div>
      )}

      {!presenting && (
      <DashboardFilterBar
        dashboardId={dashboard.id}
        filters={dashboard.filters}
        datasets={dataFrames}
      />
      )}

      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)}>
        <ModalContent>
          <ModalHeader>{t('dashboard.deleteTitle')}</ModalHeader>
          <ModalBody>
            <p className="text-sm text-muted">{t('dashboard.deleteConfirm', { name: dashboard.name })}</p>
          </ModalBody>
          <ModalFooter>
            <Button variant="light" onPress={() => setDeleteOpen(false)}>{t('common.cancel')}</Button>
            <Button
              color="danger"
              onPress={() => {
                removeDashboard(dashboard.id)
                setDeleteOpen(false)
              }}
            >
              {t('common.delete')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

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
            const kind = item.kind ?? 'chart'
            if (kind === 'kpi') {
              return (
                <div key={item.chartId} className="h-full">
                  <KpiCard
                    item={item}
                    filters={filters}
                    onRemove={() => removeItem(dashboard.id, item.chartId)}
                    onConfigure={(kpi) => updateItemKpi(dashboard.id, item.chartId, kpi)}
                  />
                </div>
              )
            }
            if (kind === 'text') {
              return (
                <div key={item.chartId} className="h-full">
                  <TextCard
                    item={item}
                    onRemove={() => removeItem(dashboard.id, item.chartId)}
                    onChange={(text) => updateItemText(dashboard.id, item.chartId, text)}
                  />
                </div>
              )
            }
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
