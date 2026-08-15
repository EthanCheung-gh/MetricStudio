import { useTranslation } from 'react-i18next'
import { Database, X, Plus, SlidersHorizontal, LayoutDashboard } from 'lucide-react'
import { Button } from '@heroui/react'
import { DataView } from '@/components/data/DataView'
import { ChartCanvas } from '@/components/chart/ChartCanvas'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useDataStore } from '@/stores/dataStore'
import { useChartStore } from '@/stores/chartStore'
import { useUIStore } from '@/stores/uiStore'

export function CenterArea() {
  const { t } = useTranslation()
  const activeTab = useWorkspaceStore((s) => s.activeTab)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const dataFrames = useDataStore((s) => s.dataFrames)
  const loading = useDataStore((s) => s.loading)
  const openChartTabs = useWorkspaceStore((s) => s.openChartTabs)
  const activeChartTabIdx = useWorkspaceStore((s) => s.activeChartTabIdx)
  const setActiveChartTab = useWorkspaceStore((s) => s.setActiveChartTab)
  const closeChartTab = useWorkspaceStore((s) => s.closeChartTab)
  const createChart = useChartStore((s) => s.createChart)
  const setActiveChart = useChartStore((s) => s.setActiveChart)
  const charts = useChartStore((s) => s.charts)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const setChartConfigDialogOpen = useUIStore((s) => s.setChartConfigDialogOpen)

  if (loading && dataFrames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <LoadingSpinner message={t('layout.loadingDatasets')} />
      </div>
    )
  }

  if (dataFrames.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-muted">
        <Database className="h-12 w-12 opacity-20" />
        <p className="text-sm">{t('layout.noDataset')}</p>
        <p className="text-xs">{t('layout.importHint')}</p>
      </div>
    )
  }

  const isDataTab = activeTab === 'data'

  return (
    <div className="flex h-full flex-col bg-background">
      {/* Chart tabs bar */}
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border bg-surface px-2 overflow-x-auto">
        {/* Data tab */}
        <button
          className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
            isDataTab ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
          }`}
          onClick={() => {
            setActiveTab('data')
          }}
        >
          <Database className="h-3 w-3" />
          {t('nav.data')}
        </button>

        {/* Dashboard tab */}
        <button
          className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap transition-colors ${
            activeTab === 'dashboard' ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
          }`}
          onClick={() => {
            setActiveTab('dashboard')
          }}
        >
          <LayoutDashboard className="h-3 w-3" />
          Dashboard
        </button>

        {/* Chart tabs */}
        {openChartTabs.map((chartId, idx) => {
          const chart = charts.find((c) => c.id === chartId)
          const isActive = !isDataTab && activeChartTabIdx === idx
          return (
            <div
              key={chartId}
              className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs whitespace-nowrap cursor-pointer transition-colors ${
                isActive ? 'bg-primary/20 text-primary' : 'text-muted hover:text-foreground'
              }`}
              onClick={() => {
                setActiveTab('chart')
                setActiveChartTab(idx)
                setActiveChart(chartId)
              }}
            >
              <span>{chart?.name || `Chart ${idx + 1}`}</span>
              <button
                className="ml-0.5 rounded p-0.5 hover:bg-danger/20 hover:text-danger"
                onClick={(e) => {
                  e.stopPropagation()
                  closeChartTab(chartId)
                  // Keep the canvas in sync: if the closed chart was active,
                  // move to the newly active tab (or clear when none remain)
                  const ws = useWorkspaceStore.getState()
                  const cs = useChartStore.getState()
                  if (cs.activeChartId === chartId) {
                    cs.setActiveChart(ws.openChartTabs.length > 0 ? ws.openChartTabs[ws.activeChartTabIdx] : null)
                  }
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )
        })}

        {/* New chart button */}
        {activeDataFrameId && (
          <Button
            isIconOnly
            size="sm"
            variant="light"
            className="h-6 w-6 min-w-0 ml-1"
            onPress={() => {
              const chart = createChart(activeDataFrameId)
              setActiveTab('chart')
              useWorkspaceStore.getState().openChartTab(chart.id)
            }}
            aria-label="New chart"
          >
            <Plus className="h-3 w-3" />
          </Button>
        )}

        {/* Re-configure active chart */}
        {!isDataTab && openChartTabs.length > 0 && (
          <Button
            size="sm"
            variant="light"
            className="ml-auto h-6 min-w-0 px-2 text-xs text-muted"
            startContent={<SlidersHorizontal className="h-3 w-3" />}
            onPress={() => setChartConfigDialogOpen(true)}
            aria-label="Configure chart"
          >
            Configure
          </Button>
        )}
      </div>

      {/* Tab content */}
      <div className="min-h-0 flex-1 p-2">
        <ErrorBoundary>
          {isDataTab ? (
            <DataView />
          ) : activeTab === 'dashboard' ? (
            <DashboardView />
          ) : (
            <ChartCanvas />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )
}
