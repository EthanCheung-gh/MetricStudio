import { useTranslation } from 'react-i18next'
import { useDataStore } from '@/stores/dataStore'
import { useChartStore } from '@/stores/chartStore'
import { EncodingPanel } from './EncodingPanel'
import { ChartTypeSelector } from './ChartTypeSelector'

export function ChartBuilder() {
  const { t } = useTranslation()
  const activeId = useDataStore((s) => s.activeDataFrameId)
  const columns = useDataStore((s) => s.columns)
  const charts = useChartStore((s) => s.charts)
  const activeChartId = useChartStore((s) => s.activeChartId)

  const activeChart = charts.find((c) => c.id === activeChartId)

  if (!activeId) {
    return (
      <div className="rounded border border-border bg-surface-elevated p-3 text-xs text-muted">
        {t('chart.selectDatasetHint')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {activeChart ? (
        <>
          <ChartTypeSelector
            value={activeChart.encoding.chartType}
            onChange={(type) => useChartStore.getState().updateEncoding(activeChart.id, { chartType: type })}
          />
          <EncodingPanel chart={activeChart} columns={columns} />
        </>
      ) : (
        <div className="rounded border border-border bg-surface-elevated p-3 text-xs text-muted">
          {t('chart.createChartHint')}
        </div>
      )}
    </div>
  )
}
