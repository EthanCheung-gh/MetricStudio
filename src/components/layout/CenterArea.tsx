import { useTranslation } from 'react-i18next'
import { Database, X, Plus, SlidersHorizontal, LayoutDashboard, Sparkles } from 'lucide-react'
import { Button } from '@heroui/react'
import { DataView } from '@/components/data/DataView'
import { ChartCanvas } from '@/components/chart/ChartCanvas'
import { DashboardView } from '@/components/dashboard/DashboardView'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import { LoadingSpinner } from '@/components/common/LoadingSpinner'
import { useWorkspaceStore } from '@/stores/workspaceStore'
import { useDataStore } from '@/stores/dataStore'
import { useChartStore } from '@/stores/chartStore'
import { useDashboardStore } from '@/stores/dashboardStore'
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
  const backendConnected = useUIStore((s) => s.backendConnected)
  const sampleWizardDismissed = useUIStore((s) => s.sampleWizardDismissed)
  const setSampleWizardDismissed = useUIStore((s) => s.setSampleWizardDismissed)
  const addNotification = useUIStore((s) => s.addNotification)
  const importSample = useDataStore((s) => s.importSample)
  const dashboards = useDashboardStore((s) => s.dashboards)

  const startSampleTour = async () => {
    try {
      const sample = await importSample()
      let chart = useChartStore.getState().charts.find((item) => item.datasetId === sample.id && item.name === t('sample.chartName'))
      if (!chart) {
        chart = useChartStore.getState().createChart(sample.id, t('sample.chartName'))
        useChartStore.getState().updateEncoding(chart.id, {
          chartType: 'bar',
          x: { field: 'category', type: 'nominal' },
          yFields: [{ field: 'value', type: 'quantitative', aggregate: 'sum', axis: 'left', normalize: 'none' }],
          color: { field: 'region', type: 'nominal' },
        })
      }
      let dashboard = useDashboardStore.getState().dashboards.find((item) => item.items.some((entry) => entry.chartId === chart.id))
      if (!dashboard) dashboard = useDashboardStore.getState().createDashboard()
      useDashboardStore.getState().addItem(dashboard.id, chart.id)
      useWorkspaceStore.getState().openChartTab(chart.id)
      useWorkspaceStore.getState().setActiveTab('chart')
      setSampleWizardDismissed(true)
      addNotification('success', t('sample.ready'))
    } catch (error) {
      addNotification('error', error instanceof Error ? error.message : t('sample.failed'))
    }
  }

  if (loading && dataFrames.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <LoadingSpinner message={t('layout.loadingDatasets')} />
      </div>
    )
  }

  if (dataFrames.length === 0) {
    const showWizard = !sampleWizardDismissed && charts.length === 0 && dashboards.length === 0
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background px-6 text-muted">
        <Database className="h-12 w-12 opacity-20" />
        <p className="text-sm font-semibold text-foreground">{showWizard ? t('sample.welcome') : t('layout.noDataset')}</p>
        <p className="max-w-lg text-center text-xs">{showWizard ? t('sample.description') : t('layout.importHint')}</p>
        <div className="flex gap-2">
          <Button
            color="primary"
            startContent={<Sparkles className="h-4 w-4" />}
            isDisabled={!backendConnected}
            isLoading={loading}
            onPress={startSampleTour}
          >
            {t('sample.start')}
          </Button>
          <Button variant="light" onPress={() => useUIStore.getState().setImportModalOpen(true)}>
            {t('sample.importOwn')}
          </Button>
          {showWizard && <Button variant="light" onPress={() => setSampleWizardDismissed(true)}>{t('sample.skip')}</Button>}
        </div>
        {!backendConnected && <p className="text-xs text-warning">{t('sample.backendRequired')}</p>}
        {showWizard && (
          <div className="mt-2 grid max-w-2xl grid-cols-3 gap-3 text-xs">
            {[t('sample.stepData'), t('sample.stepChart'), t('sample.stepDashboard')].map((step, index) => (
              <div key={step} className="rounded border border-border bg-surface p-3 text-center">
                <div className="mb-1 font-semibold text-primary">{index + 1}</div>
                <div>{step}</div>
              </div>
            ))}
          </div>
        )}
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
