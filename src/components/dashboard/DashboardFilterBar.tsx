import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input, Select, SelectItem } from '@heroui/react'
import { Eraser, Search, X } from 'lucide-react'
import { api } from '@/api/client'
import type { ColumnMeta, DataFrameMeta } from '@/types/data'
import type { DashboardFilter, DashboardFilterKind } from '@/types/dashboard'
import { useDashboardStore } from '@/stores/dashboardStore'
import { useDataStore } from '@/stores/dataStore'

/** Above this unique-count a category column is served by server-side search. */
const HIGH_CARDINALITY_THRESHOLD = 200
/** Page size for both bulk (low-cardinality) and searched value fetches. */
const VALUE_PAGE_SIZE = 200

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

interface CategorySource {
  key: string
  datasetId: string
  field: string
  version: number
  highCardinality: boolean
}

interface LazyValues {
  input: string
  query: string
  values: string[]
  filteredTotal: number | null
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
  const [bulkValues, setBulkValues] = useState<Record<string, string[]>>({})
  const [lazy, setLazy] = useState<Record<string, LazyValues>>({})
  const fieldOptions = useMemo(
    () => datasets.flatMap((dataset) => dataset.columns.map((column) => ({ dataset, column }))),
    [datasets],
  )

  const findColumn = (datasetId: string, field: string): ColumnMeta | undefined =>
    fieldOptions.find(({ dataset, column }) => dataset.id === datasetId && column.name === field)?.column

  const categorySources = useMemo<CategorySource[]>(() => {
    const map = new Map<string, CategorySource>()
    for (const filter of filters) {
      if (filter.kind !== 'category' || !filter.datasetId) continue
      const key = `${filter.datasetId}:${filter.field}`
      if (!map.has(key)) {
        map.set(key, {
          key,
          datasetId: filter.datasetId,
          field: filter.field,
          version: dataVersions[filter.datasetId] || 0,
          highCardinality: (findColumn(filter.datasetId, filter.field)?.uniqueCount ?? 0) > HIGH_CARDINALITY_THRESHOLD,
        })
      }
    }
    return Array.from(map.values())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, dataVersions, fieldOptions])

  // Low-cardinality fields: one cached bulk fetch keeps the existing dropdown UX.
  const bulkSourceKey = JSON.stringify(categorySources.filter((source) => !source.highCardinality))
  useEffect(() => {
    const sources = JSON.parse(bulkSourceKey) as Omit<CategorySource, 'highCardinality'>[]
    let cancelled = false
    Promise.all(
      sources.map(async ({ key, datasetId, field }) => {
        try {
          return [key, (await api.distinctValues(datasetId, field, { limit: 1000 })).values] as const
        } catch {
          return [key, []] as const
        }
      }),
    ).then((entries) => {
      if (!cancelled) setBulkValues(Object.fromEntries(entries))
    })
    return () => {
      cancelled = true
    }
  }, [bulkSourceKey])

  // High-cardinality fields: keep per-filter lazy state alive while its filter exists.
  useEffect(() => {
    setLazy((current) => {
      const next: Record<string, LazyValues> = {}
      for (const source of categorySources) {
        if (!source.highCardinality) continue
        next[source.key] = current[source.key] ?? { input: '', query: '', values: [], filteredTotal: null }
      }
      return next
    })
  }, [categorySources])

  const lazyInputsKey = JSON.stringify(
    Object.fromEntries(Object.entries(lazy).map(([key, state]) => [key, state.input])),
  )
  // Debounced commit of search inputs into executed queries.
  useEffect(() => {
    const timer = setTimeout(() => {
      const inputs = JSON.parse(lazyInputsKey) as Record<string, string>
      setLazy((current) => {
        let changed = false
        const next = { ...current }
        for (const [key, input] of Object.entries(inputs)) {
          if ((next[key]?.query ?? '') !== input.trim()) {
            next[key] = { ...(next[key] ?? { values: [], filteredTotal: null }), input, query: input.trim() }
            changed = true
          }
        }
        return changed ? next : current
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [lazyInputsKey])

  const lazyQueriesKey = JSON.stringify(
    Object.fromEntries(categorySources.filter((source) => source.highCardinality).map((source) => [
      source.key,
      `${lazy[source.key]?.query ?? ''}|${source.version}`,
    ])),
  )
  useEffect(() => {
    const entries = Object.entries(JSON.parse(lazyQueriesKey) as Record<string, string>)
    let cancelled = false
    Promise.all(
      entries.map(async ([key, meta]) => {
        const [datasetId, field] = key.split(':')
        const query = meta.split('|')[0]
        try {
          const result = await api.distinctValues(datasetId, field, { search: query || undefined, limit: VALUE_PAGE_SIZE })
          return [key, result] as const
        } catch {
          const empty = { values: [] as string[], total: 0, filteredTotal: 0 }
          return [key, empty] as const
        }
      }),
    ).then((results) => {
      if (cancelled) return
      setLazy((current) => {
        const next = { ...current }
        for (const [key, result] of results) {
          next[key] = { ...(current[key] ?? { input: '', query: '' }), values: result.values, filteredTotal: result.filteredTotal }
        }
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [lazyQueriesKey])

  const loadMore = async (key: string) => {
    const [datasetId, field] = key.split(':')
    const state = lazy[key]
    if (!state) return
    try {
      const result = await api.distinctValues(datasetId, field, {
        search: state.query || undefined,
        offset: state.values.length,
        limit: VALUE_PAGE_SIZE,
      })
      setLazy((current) => ({
        ...current,
        [key]: { ...state, values: [...state.values, ...result.values], filteredTotal: result.filteredTotal },
      }))
    } catch {
      // Keep the already-loaded page on failure.
    }
  }

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
        const active = hasFilterValue(f)
        const datasetName = datasets.find((dataset) => dataset.id === f.datasetId)?.name
        const key = `${f.datasetId}:${f.field}`
        const selected = (f.value as string[]) || []
        const highCardinality = (findColumn(f.datasetId ?? '', f.field)?.uniqueCount ?? 0) > HIGH_CARDINALITY_THRESHOLD
        const lazyState = lazy[key]
        const dropdownValues = Array.from(new Set([...(highCardinality ? lazyState?.values ?? [] : bulkValues[key] || []), ...selected]))
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
              <div className="flex w-56 flex-col gap-1">
                {highCardinality && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted" />
                    <Input
                      size="sm"
                      className="pl-6"
                      placeholder={t('dashboard.searchFilterValues')}
                      aria-label={t('dashboard.searchFilterValues')}
                      value={lazyState?.input ?? ''}
                      onValueChange={(input) =>
                        setLazy((current) => ({ ...current, [key]: { ...(current[key] ?? { query: '', values: [], filteredTotal: null }), input } }))
                      }
                    />
                  </div>
                )}
                <Select
                  size="sm"
                  selectionMode="multiple"
                  selectedKeys={new Set(selected)}
                  onSelectionChange={(keys) =>
                    updateFilter(dashboardId, f.id, { value: Array.from(keys) as string[] })
                  }
                >
                  {dropdownValues.map((v) => (
                    <SelectItem key={v}>{v}</SelectItem>
                  ))}
                </Select>
                {highCardinality && lazyState?.filteredTotal !== null && (
                  <div className="flex items-center justify-between text-[10px] text-muted">
                    <span>{t('dashboard.filterValuesMatched', { count: lazyState?.filteredTotal ?? 0 })}</span>
                    {(lazyState?.values.length ?? 0) < (lazyState?.filteredTotal ?? 0) && (
                      <button className="underline hover:text-foreground" onClick={() => loadMore(key)}>
                        {t('dashboard.loadMoreValues')}
                      </button>
                    )}
                  </div>
                )}
              </div>
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
