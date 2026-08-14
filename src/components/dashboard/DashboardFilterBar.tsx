import { Input, Select, SelectItem } from '@heroui/react'
import { X } from 'lucide-react'
import type { ColumnMeta, DataPreview } from '@/types/data'
import type { DashboardFilter, DashboardFilterKind } from '@/types/dashboard'
import { useDashboardStore } from '@/stores/dashboardStore'

function distinctValues(preview: DataPreview | null, field: string): string[] {
  if (!preview) return []
  const idx = preview.columns.indexOf(field)
  if (idx < 0) return []
  const seen = new Set<string>()
  for (const row of preview.rows) {
    const v = row[idx]
    if (v !== null && v !== undefined && String(v).trim() !== '') seen.add(String(v))
  }
  return Array.from(seen).sort()
}

function kindForType(t: ColumnMeta['inferredType']): DashboardFilterKind {
  if (t === 'temporal') return 'date'
  if (t === 'quantitative') return 'range'
  return 'category'
}

function RangeInputs({ value, onChange }: { value: [string, string]; onChange: (range: [string, string]) => void }) {
  return (
    <div className="flex items-center gap-1">
      <Input
        size="sm"
        className="w-24"
        placeholder="min"
        value={value[0]}
        onValueChange={(v) => onChange([v, value[1]])}
      />
      <Input
        size="sm"
        className="w-24"
        placeholder="max"
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
  preview,
  datasetId,
}: {
  dashboardId: string
  filters: DashboardFilter[]
  columns: ColumnMeta[]
  preview: DataPreview | null
  datasetId: string | null
}) {
  const addFilter = useDashboardStore((s) => s.addFilter)
  const updateFilter = useDashboardStore((s) => s.updateFilter)
  const removeFilter = useDashboardStore((s) => s.removeFilter)

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

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f) => {
        const values = distinctValues(preview, f.field)
        return (
          <div key={f.id} className="flex items-center gap-1.5 rounded border border-border bg-surface px-2 py-1">
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
