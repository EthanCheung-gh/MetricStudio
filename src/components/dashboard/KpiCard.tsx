import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card, CardBody } from '@heroui/react'
import { Lock, Settings2, Unlock, X } from 'lucide-react'
import { useDataStore } from '@/stores/dataStore'
import { api } from '@/api/client'
import type { DashboardDataFilter, DashboardItem, KpiAggregate, KpiItemConfig } from '@/types/dashboard'
import type { ColumnMeta } from '@/types/data'

const AGGS: KpiAggregate[] = ['sum', 'mean', 'count', 'min', 'max', 'nunique']

export interface KpiCardProps {
  item: DashboardItem
  filters: DashboardDataFilter[]
  /** false in view mode: editing chrome is hidden. */
  editing: boolean
  onToggleLock: () => void
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

export function KpiCard({ item, filters, editing, onToggleLock, onRemove, onConfigure }: KpiCardProps) {
  const { t } = useTranslation()
  const kpi = item.kpi
  const dataFrames = useDataStore((s) => s.dataFrames)
  const dataVersion = useDataStore((s) => (kpi?.datasetId ? s.dataVersions[kpi.datasetId] || 0 : 0))
  const [value, setValue] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [configuring, setConfiguring] = useState(!item.kpi?.field)
  const [columns, setColumns] = useState<ColumnMeta[]>([])
  const applicableFilters = useMemo(
    () => filters.filter((filter) => filter.datasetId === kpi?.datasetId),
    [filters, kpi?.datasetId],
  )
  const filtersKey = useMemo(() => JSON.stringify(applicableFilters), [applicableFilters])

  // Fetch the aggregate whenever the KPI config or dashboard filters change.
  useEffect(() => {
    if (!kpi?.datasetId || !kpi?.field) {
      setValue(null)
      return
    }
    let cancelled = false
    setLoading(true)
    api
      .aggregateValue(kpi.datasetId, kpi.field, kpi.aggregate, applicableFilters)
      .then((r) => { if (!cancelled) setValue(r.value) })
      .catch(() => { if (!cancelled) setValue(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [kpi?.datasetId, kpi?.field, kpi?.aggregate, applicableFilters, filtersKey, dataVersion])

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
          {editing && (
            <>
              <button
                className="rounded p-0.5 hover:bg-surface-elevated"
                onClick={onToggleLock}
                aria-label={item.locked ? t('dashboard.unlockCard') : t('dashboard.lockCard')}
              >
                {item.locked ? <Lock className="h-3.5 w-3.5 text-warning" /> : <Unlock className="h-3.5 w-3.5 text-muted" />}
              </button>
              {!item.locked && (
                <>
                  <button
                    className="rounded p-0.5 hover:bg-surface-elevated"
                    onClick={() => setConfiguring((c) => !c)}
                    aria-label={t('dashboard.configureKpi')}
                  >
                    <Settings2 className="h-3.5 w-3.5 text-muted" />
                  </button>
                  <button
                    className="rounded p-0.5 hover:bg-danger/20 hover:text-danger"
                    onClick={onRemove}
                    aria-label={t('dashboard.removeCard')}
                  >
                    <X className="h-3.5 w-3.5 text-muted" />
                  </button>
                </>
              )}
            </>
          )}
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
              <option value="">{t('dashboard.datasetPlaceholder')}</option>
              {dataFrames.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            <select
              className={selectCls}
              value={kpi?.field ?? ''}
              onChange={(e) => onConfigure({ field: e.target.value })}
            >
              <option value="">{t('dashboard.fieldPlaceholder')}</option>
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
