import { useEffect, useState } from 'react'
import { Input, Select, SelectItem } from '@heroui/react'
import { Eraser, X } from 'lucide-react'
import { api } from '@/api/client'
import type { ColumnMeta } from '@/types/data'
import type { DashboardFilter, DashboardFilterKind } from '@/types/dashboard'
import { useDashboardStore } from '@/stores/dashboardStore'

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
  return (
    <div className="flex items-center gap-1">
      <Input
        size="sm"
        type={type}
        className={type === 'date' ? 'w-36' : 'w-24'}
        placeholder={type === 'date' ? undefined : 'min'}
        aria-label={type === 'date' ? 'Start date' : 'Minimum value'}
        value={value[0]}
        onValueChange={(v) => onChange([v, value[1]])}
      />
      <Input
        size="sm"
        type={type}
        className={type === 'date' ? 'w-36' : 'w-24'}
        placeholder={type === 'date' ? undefined : 'max'}
        aria-label={type === 'date' ? 'End date' : 'Maximum value'}
        value={value[1]}
        onValueChange={(v) => onChange([value[0], v])}
      />
    </div>
  )
}

export function DashboardFilterBar({
  dashboardId,
  filters,
  columns,
  datasetId,
}: {
  dashboardId: string
  filters: DashboardFilter[]
  columns: ColumnMeta[]
  datasetId: string | null
}) {
  const addFilter = useDashboardStore((s) => s.addFilter)
  const updateFilter = useDashboardStore((s) => s.updateFilter)
  const removeFilter = useDashboardStore((s) => s.removeFilter)
  const clearAllFilters = useDashboardStore((s) => s.clearAllFilters)
  const [valuesByField, setValuesByField] = useState<Record<string, string[]>>({})

  useEffect(() => {
    if (!datasetId) {
      setValuesByField({})
      return
    }
    const fields = filters.filter((filter) => filter.kind === 'category').map((filter) => filter.field)
    Promise.all(fields.map(async (field) => [field, (await api.distinctValues(datasetId, field)).values] as const))
      .then((entries) => setValuesByField(Object.fromEntries(entries)))
      .catch(() => setValuesByField({}))
  }, [datasetId, filters])

  const addForField = (field: string) => {
    const col = columns.find((c) => c.name === field)
    if (!col) return
    addFilter(dashboardId, {
      field,
      label: field,
      kind: kindForType(col.inferredType),
      datasetId: datasetId ?? '',
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
          Clear filters ({activeCount})
        </button>
      )}
      {filters.map((f) => {
        const values = valuesByField[f.field] || []
        const active = hasFilterValue(f)
        return (
          <div
            key={f.id}
            className={`flex items-center gap-1.5 rounded border bg-surface px-2 py-1 ${
              active ? 'border-primary/60' : 'border-border'
            }`}
          >
            <span className="text-[10px] uppercase tracking-wide text-muted">{f.label}</span>
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
              aria-label="Remove filter"
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
        <option value="">+ Filter…</option>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  )
}
