import { useEffect, useState } from 'react'
import { Card, CardBody } from '@heroui/react'
import { Settings2, X } from 'lucide-react'
import { useDataStore } from '@/stores/dataStore'
import { api } from '@/api/client'
import type { DashboardItem, KpiAggregate, KpiItemConfig } from '@/types/dashboard'
import type { ColumnMeta } from '@/types/data'

const AGGS: KpiAggregate[] = ['sum', 'mean', 'count', 'min', 'max', 'nunique']

export interface KpiCardProps {
  item: DashboardItem
  onRemove: () => void
  onConfigure: (kpi: Partial<KpiItemConfig>) => void
}

function formatValue(v: number | null): string {
  if (v === null || v === undefined) return '—'
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (Math.abs(v) >= 10_000) return (v / 1_000).toFixed(1) + 'K'
  if (Number.isInteger(v)) return String(v)
  return v.toFixed(2)
}

const selectCls = 'rounded border border-border bg-surface px-2 py-1 text-xs'

export function KpiCard({ item, onRemove, onConfigure }: KpiCardProps) {
  const kpi = item.kpi
  const dataFrames = useDataStore((s) => s.dataFrames)
  const dataVersion = useDataStore((s) => (kpi?.datasetId ? s.dataVersions[kpi.datasetId] || 0 : 0))
  const [value, setValue] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [configuring, setConfiguring] = useState(!item.kpi?.field)
  const [columns, setColumns] = useState<ColumnMeta[]>([])

  // Fetch the aggregate whenever the KPI config changes.
  useEffect(() => {
    if (!kpi?.datasetId || !kpi?.field) {
      setValue(null)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .aggregateValue(kpi.datasetId, kpi.field, kpi.aggregate)
      .then((r) => { if (!cancelled) setValue(r.value) })
      .catch(() => { if (!cancelled) setValue(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [kpi?.datasetId, kpi?.field, kpi?.aggregate, dataVersion])

  // Load the dataset's columns only while the config panel is open.
  useEffect(() => {
    if (!configuring || !kpi?.datasetId) return
    api.getColumns(kpi.datasetId).then(setColumns).catch(() => setColumns([]))
  }, [configuring, kpi?.datasetId])

  const numericCols = columns.filter((c) => /int|float|double|decimal|number/i.test(c.dtype))

  return (
    <Card className="h-full border-border bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border px-2 py-1">
        <span className="drag-handle flex-1 cursor-grab truncate text-xs font-medium">
          {kpi?.label || kpi?.field || 'KPI'}
        </span>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            className="rounded p-0.5 hover:bg-surface-elevated"
            onClick={() => setConfiguring((c) => !c)}
            aria-label="Configure KPI"
          >
            <Settings2 className="h-3.5 w-3.5 text-muted" />
          </button>
          <button
            className="rounded p-0.5 hover:bg-danger/20 hover:text-danger"
            onClick={onRemove}
            aria-label="Remove from dashboard"
          >
            <X className="h-3.5 w-3.5 text-muted" />
          </button>
        </div>
      </div>
      <CardBody className="min-h-0 flex-1 justify-center overflow-auto p-3">
        {configuring ? (
          <div className="flex flex-col gap-2">
            <select
              className={selectCls}
              value={kpi?.datasetId ?? ''}
              onChange={(e) => onConfigure({ datasetId: e.target.value, field: '' })}
            >
              <option value="">Dataset…</option>
              {dataFrames.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              className={selectCls}
              value={kpi?.field ?? ''}
              onChange={(e) => onConfigure({ field: e.target.value })}
            >
              <option value="">Field…</option>
              {numericCols.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
            <select
              className={selectCls}
              value={kpi?.aggregate ?? 'sum'}
              onChange={(e) => onConfigure({ aggregate: e.target.value as KpiAggregate })}
            >
              {AGGS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-1">
            <span className="text-3xl font-bold">{loading ? '…' : formatValue(value)}</span>
            <span className="text-[10px] uppercase tracking-wide text-muted">
              {kpi?.aggregate} · {kpi?.field}
            </span>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
