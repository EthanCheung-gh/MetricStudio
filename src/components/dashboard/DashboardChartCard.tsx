import { useEffect, useMemo, useState } from 'react'
import { Card, CardBody } from '@heroui/react'
import { Lock, Settings2, Unlock, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PlotlyRenderer, type PlotlySelection } from '@/components/chart/PlotlyRenderer'
import type { ChartConfig, SelectionFilter } from '@/types/encoding'
import type { DashboardDataFilter } from '@/types/dashboard'
import type { PlotlyFigure } from '@/types/plotly'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'

export interface DashboardChartCardProps {
  chart: ChartConfig
  filters: DashboardDataFilter[]
  /** Brushes from OTHER cards in the dashboard (applied as selections). */
  externalBrushes: SelectionFilter[]
  /** false in view mode: editing chrome is hidden. */
  editing: boolean
  /** Mirrors the owning grid item's locked flag. */
  locked?: boolean
  onToggleLock: () => void
  onRemove: () => void
  onEdit: () => void
  onBrushChange: (sel: SelectionFilter | null) => void
}

export function DashboardChartCard({
  chart,
  filters,
  externalBrushes,
  editing,
  locked,
  onToggleLock,
  onRemove,
  onEdit,
  onBrushChange,
}: DashboardChartCardProps) {
  const { t } = useTranslation()
  const [figure, setFigure] = useState<PlotlyFigure | null>(null)
  const dataVersion = useDataStore((state) => state.dataVersions[chart.datasetId] || 0)
  const [highlight, setHighlight] = useState(false)
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters])
  const brushesKey = useMemo(() => JSON.stringify(externalBrushes), [externalBrushes])

  useEffect(() => {
    setHighlight(true)
    const timer = setTimeout(() => setHighlight(false), 600)
    return () => clearTimeout(timer)
  }, [filtersKey, brushesKey])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .previewChart(
          chart.datasetId,
          chart.encoding,
          undefined,
          filters.filter((f) => !f.datasetId || f.datasetId === chart.datasetId),
          externalBrushes,
        )
        .then((f) => {
          if (!cancelled) setFigure(f)
        })
        .catch(() => {
          if (!cancelled) setFigure(null)
        })
    }, 150)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chart.datasetId, chart.encoding, filtersKey, brushesKey, dataVersion])

  const handleSelected = (sel: PlotlySelection) => {
    if (!sel.xRange && !sel.yRange) return
    onBrushChange({
      xField: chart.encoding.x?.field,
      yField: chart.encoding.yFields?.[0]?.field,
      xRange: sel.xRange,
      yRange: sel.yRange,
    })
  }

  return (
    <Card className={`h-full border-border bg-surface transition-colors ${highlight ? 'border-primary/60' : ''}`}>
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
        <span className="drag-handle flex-1 cursor-grab truncate text-xs font-medium">{chart.name}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          {editing && (
            <>
              <button
                className="rounded p-0.5 hover:bg-surface-elevated"
                onClick={onToggleLock}
                aria-label={locked ? t('dashboard.unlockCard') : t('dashboard.lockCard')}
              >
                {locked ? <Lock className="h-3.5 w-3.5 text-warning" /> : <Unlock className="h-3.5 w-3.5 text-muted" />}
              </button>
              {!locked && (
                <>
                  <button className="rounded p-0.5 hover:bg-surface-elevated" onClick={onEdit} aria-label={t('dashboard.editChart')}>
                    <Settings2 className="h-3.5 w-3.5 text-muted" />
                  </button>
                  <button className="rounded p-0.5 hover:bg-danger/20 hover:text-danger" onClick={onRemove} aria-label={t('dashboard.removeCard')}>
                    <X className="h-3.5 w-3.5 text-muted" />
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <CardBody className="min-h-0 flex-1 p-0">
        <PlotlyRenderer
          figure={figure}
          userLayout={chart.layout}
          className="h-full w-full"
          onSelected={handleSelected}
          onClearSelection={() => onBrushChange(null)}
        />
      </CardBody>
    </Card>
  )
}
