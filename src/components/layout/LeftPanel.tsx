import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Copy, Database, ListTree, Pencil, SlidersHorizontal, Trash2, Upload, Sparkles } from 'lucide-react'
import { Button, Card, CardBody } from '@heroui/react'
import { DataExplorer } from '@/components/data/DataExplorer'
import { DatasetList } from '@/components/data/DatasetList'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useChartStore } from '@/stores/chartStore'
import { useDataStore } from '@/stores/dataStore'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useUIStore } from '@/stores/uiStore'
import { api } from '@/api/client'
import type { ChartRecommendation } from '@/types/encoding'
import { CollapsedIconBarItem } from './CollapsedIconBar'

export function LeftPanel() {
  const { t } = useTranslation()
  const toggle = useWorkspaceStore((s) => s.togglePanel)
  const activeSection = useWorkspaceStore((s) => s.leftActiveSection)

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex h-9 items-center justify-between border-b border-border px-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">
          {activeSection === 'charts' ? t('nav.charts') : activeSection === 'datasets' ? t('nav.datasets') : t('nav.explorer')}
        </span>
        <Button isIconOnly size="sm" variant="light" onPress={() => toggle('left')} aria-label={t('layout.collapseSidebar')}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto p-2">
        {activeSection === 'charts' && <ChartsSection />}
        {activeSection === 'datasets' && <DatasetList />}
        {!activeSection && (
          <>
            <DataExplorer />
            <div className="my-2" />
            <DatasetList />
          </>
        )}
      </div>
    </div>
  )
}

function ChartsSection() {
  const { t } = useTranslation()
  const charts = useChartStore((s) => s.charts)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const createChart = useChartStore((s) => s.createChart)
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const updateName = useChartStore((s) => s.updateName)
  const setActiveChart = useChartStore((s) => s.setActiveChart)
  const removeChart = useChartStore((s) => s.removeChart)
  const duplicateChart = useChartStore((s) => s.duplicateChart)
  const openChartTab = useWorkspaceStore((s) => s.openChartTab)
  const closeChartTab = useWorkspaceStore((s) => s.closeChartTab)
  const setChartConfigDialogOpen = useUIStore((s) => s.setChartConfigDialogOpen)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const [recs, setRecs] = useState<ChartRecommendation[] | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const startRename = (chartId: string, currentName: string) => {
    setRenamingId(chartId)
    setRenameValue(currentName)
  }

  const commitRename = (chartId: string) => {
    const name = renameValue.trim()
    if (name) updateName(chartId, name)
    setRenamingId(null)
  }

  // Load chart recommendations for the active dataset when no charts exist yet.
  useEffect(() => {
    setRecs(null)
    if (!activeDataFrameId || charts.length > 0) return
    api
      .chartRecommendations(activeDataFrameId)
      .then((r) => setRecs(r.recommendations))
      .catch(() => setRecs(null))
  }, [activeDataFrameId, charts.length])

  const createFromRecommendation = (rec: ChartRecommendation) => {
    if (!activeDataFrameId) return
    const chart = createChart(activeDataFrameId)
    updateEncoding(chart.id, rec.encoding)
    openChartTab(chart.id)
    setActiveChart(chart.id)
  }

  const handleDuplicateChart = (id: string) => {
    const copy = duplicateChart(id)
    if (copy) openChartTab(copy.id)
  }

  const handleDeleteChart = (id: string) => {
    // Close its tab if open and remove it from any dashboards it belongs to.
    closeChartTab(id)
    const dashboards = useDashboardStore.getState().dashboards
    for (const d of dashboards) {
      if (d.items.some((i) => i.chartId === id)) {
        useDashboardStore.getState().removeItem(d.id, id)
        useDashboardStore.getState().clearBrushSelection(d.id, id)
      }
    }
    removeChart(id)
  }

  if (charts.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {!activeDataFrameId && (
          <div className="rounded border border-border bg-surface-elevated p-3 text-center text-xs text-muted">
            {t('layout.importForChartRecs')}
          </div>
        )}
        {activeDataFrameId && recs && recs.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
              <Sparkles className="h-3 w-3" /> {t('panel.suggestedCharts')}
            </div>
            {recs.map((rec) => (
              <button
                key={rec.chart_type}
                className="flex flex-col gap-0.5 rounded border border-border bg-surface-elevated p-2 text-left transition-colors hover:border-primary/40"
                onClick={() => createFromRecommendation(rec)}
              >
                <span className="text-[11px] font-semibold capitalize">{rec.chart_type}</span>
                <span className="text-[10px] text-muted">{rec.reason}</span>
              </button>
            ))}
          </div>
        )}
        {activeDataFrameId && !recs && (
          <div className="rounded border border-border bg-surface-elevated p-3 text-center text-xs text-muted">
            {t('layout.noCharts')}
          </div>
        )}
      </div>
    )
  }

  return (
    <Card className="bg-surface-elevated border-border">
      <CardBody className="gap-1">
        <div className="text-xs font-semibold text-muted">{t('nav.charts')}</div>
        <div className="flex flex-col gap-0.5">
          {charts.map((chart) => (
            <div
              key={chart.id}
              className={`group flex items-center gap-2 rounded px-2 py-1.5 text-xs cursor-pointer transition-colors ${
                activeChartId === chart.id ? 'bg-primary/20 text-primary' : 'hover:bg-surface'
              }`}
              onClick={() => {
                setActiveChart(chart.id)
                openChartTab(chart.id)
              }}
            >
              <ListTree className="h-3 w-3 shrink-0" />
              {renamingId === chart.id ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-primary/60 bg-surface px-1 py-0.5 text-xs outline-none"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename(chart.id)
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={() => commitRename(chart.id)}
                  aria-label={t('chart.rename')}
                />
              ) : (
                <span
                  className="truncate flex-1"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    startRename(chart.id, chart.name)
                  }}
                >
                  {chart.name}
                </span>
              )}
              {chart.encoding.yFields?.length > 0 && (
                <span className="text-[10px] text-muted shrink-0">
                  {chart.encoding.yFields.length}Y
                </span>
              )}
              {renamingId !== chart.id && (
                <button
                  className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-primary/20 hover:text-primary shrink-0"
                  aria-label={t('chart.rename')}
                  onClick={(e) => {
                    e.stopPropagation()
                    startRename(chart.id, chart.name)
                  }}
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
              <button
                className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-primary/20 hover:text-primary shrink-0"
                aria-label={`Duplicate ${chart.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  handleDuplicateChart(chart.id)
                }}
              >
                <Copy className="h-3 w-3" />
              </button>
              <button
                className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-primary/20 hover:text-primary shrink-0"
                aria-label={`Configure ${chart.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveChart(chart.id)
                  openChartTab(chart.id)
                  setChartConfigDialogOpen(true)
                }}
              >
                <SlidersHorizontal className="h-3 w-3" />
              </button>
              <button
                className="rounded p-0.5 text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:bg-danger/20 hover:text-danger shrink-0"
                aria-label={t('common.delete')}
                onClick={(e) => {
                  e.stopPropagation()
                  handleDeleteChart(chart.id)
                }}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}

export function LeftPanelCollapsed() {
  const { t } = useTranslation()
  const toggle = useWorkspaceStore((s) => s.togglePanel)
  const activateSection = useWorkspaceStore((s) => s.activatePanelSection)
  const setImportModalOpen = useUIStore((s) => s.setImportModalOpen)
  const activeSection = useWorkspaceStore((s) => s.leftActiveSection)

  return (
    <div className="flex h-full w-10 flex-col items-center border-r border-border bg-surface py-2">
      <CollapsedIconBarItem
        icon={ChevronRight}
        label={t('layout.expandSidebar')}
        onClick={() => toggle('left')}
        tooltip={t('layout.expandSidebar')}
      />
      <CollapsedIconBarItem
        icon={ListTree}
        label={t('nav.charts')}
        active={activeSection === 'charts'}
        onClick={() => activateSection('left', 'charts')}
        tooltip={t('layout.chartsList')}
      />
      <CollapsedIconBarItem
        icon={Database}
        label={t('nav.datasets')}
        active={activeSection === 'datasets'}
        onClick={() => activateSection('left', 'datasets')}
        tooltip={t('nav.datasets')}
      />
      <CollapsedIconBarItem
        icon={Upload}
        label={t('layout.importData')}
        onClick={() => setImportModalOpen(true)}
        tooltip={t('layout.importData')}
      />
    </div>
  )
}
