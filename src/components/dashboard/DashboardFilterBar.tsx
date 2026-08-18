import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, Select, SelectItem } from '@heroui/react'
import { Eraser, X } from 'lucide-react'
import { api } from '@/api/client'
import type { ColumnMeta, DataFrameMeta } from '@/types/data'
import type { DashboardFilter, DashboardFilterKind } from '@/types/dashboard'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useDataStore } from '@/stores/dataStore'

function kindForType(t: ColumnMeta['inferredType']): DashboardFilterKind {
  if (t === 'temporal') return 'date'
  if (t === 'quantitative') return 'range'
  return 'category'
}

function hasFilterValue(filter: DashboardFilter): boolean {
  if (!Array.isArray(filter.value)) return filter.value !== null && filter.value !== undefined
  return filter.value.some((value) => value !== null && value !== undefined && value !== '')
}

function RangeInputs({
  value,
  onChange,
  type = 'text',
}: {
  value: [string, string]
  onChange: (range: [string, string]) => void
  type?: 'text' | 'date'
}) {
  const [draft, setDraft] = useState(value)
  const onChangeRef = useRef(onChange)
  const externalKey = `${value[0]}\u0000${value[1]}`

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    setDraft(externalKey.split('\u0000') as [string, string])
  }, [externalKey])

  useEffect(() => {
    if (draft[0] === value[0] && draft[1] === value[1]) return
    const timer = setTimeout(() => onChangeRef.current(draft), 300)
    return () => clearTimeout(timer)
  }, [draft, value])

  return (
    <div className="flex items-center gap-1">
      <Input
        size="sm"
        type={type}
        className={type === 'date' ? 'w-36' : 'w-24'}
        placeholder={type === 'date' ? undefined : 'min'}
        aria-label={type === 'date' ? 'Start date' : 'Minimum value'}
        value={draft[0]}
        onValueChange={(v) => setDraft([v, draft[1]])}
      />
      <Input
        size="sm"
        type={type}
        className={type === 'date' ? 'w-36' : 'w-24'}
        placeholder={type === 'date' ? undefined : 'max'}
        aria-label={type === 'date' ? 'End date' : 'Maximum value'}
        value={draft[1]}
        onValueChange={(v) => setDraft([draft[0], v])}
      />
    </div>
  )
}

export function DashboardFilterBar({
  dashboardId,
  filters,
  datasets,
}: {
  dashboardId: string
  filters: DashboardFilter[]
  datasets: DataFrameMeta[]
}) {
  const { t } = useTranslation()
  const addFilter = useDashboardStore((s) => s.addFilter)
  const updateFilter = useDashboardStore((s) => s.updateFilter)
  const removeFilter = useDashboardStore((s) => s.removeFilter)
  const clearAllFilters = useDashboardStore((s) => s.clearAllFilters)
  const dataVersions = useDataStore((s) => s.dataVersions)
  const [valuesByField, setValuesByField] = useState<Record<string, string[]>>({})
  const fieldOptions = useMemo(
    () => datasets.flatMap((dataset) => dataset.columns.map((column) => ({ dataset, column }))),
    [datasets],
  )
  const categorySourceKey = JSON.stringify(
    Array.from(new Map(
      filters
        .filter((filter) => filter.kind === 'category' && filter.datasetId)
        .map((filter) => [
          `${filter.datasetId}:${filter.field}`,
          { datasetId: filter.datasetId, field: filter.field, version: dataVersions[filter.datasetId] || 0 },
        ]),
    ).values()).sort((left, right) =>
      `${left.datasetId}:${left.field}`.localeCompare(`${right.datasetId}:${right.field}`),
    ),
  )

  useEffect(() => {
    const sources = JSON.parse(categorySourceKey) as { datasetId: string; field: string; version: number }[]
    let cancelled = false
    Promise.all(
      sources.map(async ({ datasetId, field }) => {
        const key = `${datasetId}:${field}`
        try {
          return [key, (await api.distinctValues(datasetId, field)).values] as const
        } catch {
          return [key, []] as const
        }
      }),
    ).then((entries) => {
      if (!cancelled) setValuesByField(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [categorySourceKey])

  const addForField = (optionKey: string) => {
    const option = fieldOptions.find(({ dataset, column }) => `${dataset.id}:${column.name}` === optionKey)
    if (!option) return
    addFilter(dashboardId, {
      field: option.column.name,
      label: option.column.name,
      kind: kindForType(option.column.inferredType),
      datasetId: option.dataset.id,
      value: null,
    })
  }

  const activeCount = filters.filter(hasFilterValue).length

  return (
    <div className="flex flex-wrap items-center gap-2">
      {activeCount > 0 && (
        <button
          className="flex items-center gap-1 rounded bg-primary/15 px-2 py-1 text-[11px] text-primary hover:bg-primary/25"
          onClick={() => clearAllFilters(dashboardId)}
        >
          <Eraser className="h-3 w-3" />
          {t('dashboard.clearFilters', { count: activeCount })}
        </button>
      )}
      {filters.map((f) => {
        const values = valuesByField[`${f.datasetId}:${f.field}`] || []
        const active = hasFilterValue(f)
        const datasetName = datasets.find((dataset) => dataset.id === f.datasetId)?.name
        return (
          <div
            key={f.id}
            className={`flex items-center gap-1.5 rounded border bg-surface px-2 py-1 ${
              active ? 'border-primary/60' : 'border-border'
            }`}
          >
            <span className="text-[10px] uppercase tracking-wide text-muted" title={datasetName}>
              {datasetName ? `${datasetName} · ${f.label}` : f.label}
            </span>
            {f.kind === 'category' ? (
              <Select
                size="sm"
                className="w-44"
                selectionMode="multiple"
                selectedKeys={new Set((f.value as string[]) || [])}
                onSelectionChange={(keys) =>
                  updateFilter(dashboardId, f.id, { value: Array.from(keys) as string[] })
                }
              >
                {values.map((v) => (
                  <SelectItem key={v}>{v}</SelectItem>
                ))}
              </Select>
            ) : (
              <RangeInputs
                type={f.kind === 'date' ? 'date' : 'text'}
                value={(f.value as [string, string]) || ['', '']}
                onChange={(range) => updateFilter(dashboardId, f.id, { value: range })}
              />
            )}
            <button
              className="rounded p-0.5 hover:bg-danger/20"
              onClick={() => removeFilter(dashboardId, f.id)}
              aria-label={t('dashboard.removeFilter')}
            >
              <X className="h-3 w-3 text-muted" />
            </button>
          </div>
        )
      })}
      <select
        className="rounded border border-border bg-surface px-2 py-1 text-xs"
        value=""
        onChange={(e) => {
          if (e.target.value) addForField(e.target.value)
        }}
      >
        <option value="">{t('dashboard.addFilter')}</option>
        {datasets.map((dataset) => (
          <optgroup key={dataset.id} label={dataset.name}>
            {dataset.columns.map((column) => (
              <option key={`${dataset.id}:${column.name}`} value={`${dataset.id}:${column.name}`}>
                {column.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  )
}
