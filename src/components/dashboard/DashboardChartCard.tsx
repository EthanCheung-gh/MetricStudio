import { useEffect, useMemo, useState } from 'react'
import { Card, CardBody } from '@heroui/react'
import { Settings2, X } from 'lucide-react'
import { PlotlyRenderer } from '@/components/chart/PlotlyRenderer'
import type { ChartConfig } from '@/types/encoding'
import type { PlotlyFigure } from '@/types/plotly'
import { api } from '@/api/client'

export type DashboardCardFilter = {
  field: string
  op: 'range' | 'in'
  range?: [string, string]
  values?: string[]
}

export interface DashboardChartCardProps {
  chart: ChartConfig
  filters: DashboardCardFilter[]
  onRemove: () => void
  onEdit: () => void
}

export function DashboardChartCard({ chart, filters, onRemove, onEdit }: DashboardChartCardProps) {
  const [figure, setFigure] = useState<PlotlyFigure | null>(null)
  const filtersKey = useMemo(() => JSON.stringify(filters), [filters])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      api
        .previewChart(chart.datasetId, chart.encoding, undefined, filters)
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
  }, [chart.datasetId, chart.encoding, filtersKey])

  return (
    <Card className="h-full border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
        <span className="drag-handle flex-1 cursor-grab truncate text-xs font-medium">{chart.name}</span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button className="rounded p-0.5 hover:bg-surface-elevated" onClick={onEdit} aria-label="Edit chart">
            <Settings2 className="h-3.5 w-3.5 text-muted" />
          </button>
          <button className="rounded p-0.5 hover:bg-danger/20 hover:text-danger" onClick={onRemove} aria-label="Remove from dashboard">
            <X className="h-3.5 w-3.5 text-muted" />
          </button>
        </div>
      </div>
      <CardBody className="min-h-0 flex-1 p-0">
        <PlotlyRenderer figure={figure} userLayout={chart.layout} className="h-full w-full" />
      </CardBody>
    </Card>
  )
}
