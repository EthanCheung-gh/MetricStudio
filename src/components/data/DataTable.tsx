import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronDown, ChevronUp, ChevronsUpDown, Columns3, Download, Search } from 'lucide-react'
import { Button, Spinner } from '@heroui/react'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { fmt } from '@/utils/format'

export function DataTable() {
  const { t } = useTranslation()
  const preview = useDataStore((s) => s.preview)
  const loading = useDataStore((s) => s.loading)
  const addNotification = useUIStore((s) => s.addNotification)

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [globalFilter, setGlobalFilter] = useState('')
  const [showColumnsPanel, setShowColumnsPanel] = useState(false)
  const [copiedCell, setCopiedCell] = useState<string | null>(null)

  const columns = useMemo(
    () =>
      (preview?.columns || []).map((col) => ({
        accessorKey: col,
        header: col,
        size: 160,
        minSize: 80,
        cell: (info: { getValue: () => unknown }) => {
          const val = info.getValue()
          return val === null || val === undefined ? '' : String(val)
        },
      })),
    [preview?.columns]
  )

  const data = useMemo(
    () =>
      (preview?.rows || []).map((row: unknown[]) =>
        Object.fromEntries(
          row.map((value, idx) => [
            (preview?.columns || [])[idx] || `col_${idx}`,
            value ?? null,
          ])
        )
      ),
    [preview?.rows, preview?.columns]
  )

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, columnVisibility, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    globalFilterFn: 'includesString',
    columnResizeMode: 'onChange',
  })

  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = table.getRowModel().rows
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 10,
  })

  const copyCell = async (cellId: string, value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value)
    try {
      await navigator.clipboard.writeText(text)
      setCopiedCell(cellId)
      setTimeout(() => setCopiedCell((c) => (c === cellId ? null : c)), 1200)
    } catch {
      addNotification('error', 'Copy to clipboard failed')
    }
  }

  const exportCsv = () => {
    if (!preview) return
    const escape = (v: unknown) => {
      const s = String(v ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [
      preview.columns.join(','),
      ...preview.rows.map((row) => row.map(escape).join(',')),
    ].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'data.csv'
    a.click()
    URL.revokeObjectURL(url)
    addNotification('success', `Exported ${preview.rows.length} rows as CSV`)
  }

  if (loading && !preview) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="sm" />
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        Import a dataset to view data
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted">
          {t('table.preview')}: {fmt(table.getFilteredRowModel().rows.length)} / {fmt(preview.totalRows)} {t('status.rows')} ×{' '}
          {fmt(preview.totalCols)} {t('status.cols')}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted" />
            <input
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={t('table.searchAll')}
              className="w-44 rounded border border-border bg-surface-elevated py-1 pl-7 pr-2 text-xs outline-none placeholder:text-muted focus:border-primary"
            />
          </div>
          <div className="relative">
            <Button
              size="sm"
              variant="light"
              startContent={<Columns3 className="h-3.5 w-3.5" />}
              onPress={() => setShowColumnsPanel((v) => !v)}
            >
              {t('table.columns')}
            </Button>
            {showColumnsPanel && (
              <div className="absolute right-0 top-8 z-30 flex max-h-72 w-44 flex-col gap-0.5 overflow-auto rounded border border-border bg-surface-elevated p-1.5 shadow-xl">
                {table.getAllLeafColumns().map((col) => (
                  <label
                    key={col.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-surface"
                  >
                    <input
                      type="checkbox"
                      checked={col.getIsVisible()}
                      onChange={col.getToggleVisibilityHandler()}
                      className="accent-primary"
                    />
                    <span className="truncate">{col.id}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <Button
            size="sm"
            variant="light"
            startContent={<Download className="h-3.5 w-3.5" />}
            onPress={exportCsv}
          >
            CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div ref={scrollRef} className="flex-1 overflow-auto">
        <table
          className="w-full border-collapse text-xs"
          style={{ width: table.getTotalSize() }}
        >
          <thead className="sticky top-0 z-10 bg-surface-elevated">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => {
                  const sortDir = header.column.getIsSorted()
                  return (
                    <th
                      key={header.id}
                      className="relative border-b border-r border-border px-3 py-1.5 text-left font-semibold text-muted"
                      style={{ width: header.getSize() }}
                    >
                      <button
                        className="flex w-full items-center gap-1"
                        onClick={header.column.getToggleSortingHandler()}
                        title={t('table.clickToSort')}
                      >
                        <span className="truncate">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        {sortDir === 'asc' ? (
                          <ChevronUp className="h-3 w-3 shrink-0 text-primary" />
                        ) : sortDir === 'desc' ? (
                          <ChevronDown className="h-3 w-3 shrink-0 text-primary" />
                        ) : (
                          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-40" />
                        )}
                      </button>
                      {header.column.getCanFilter() && (
                        <input
                          value={(header.column.getFilterValue() as string) ?? ''}
                          onChange={(e) => header.column.setFilterValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          placeholder={t('table.filterPlaceholder')}
                          className="mt-1 w-full rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] outline-none placeholder:text-muted focus:border-primary"
                        />
                      )}
                      <div
                        onMouseDown={header.getResizeHandler()}
                        onTouchStart={header.getResizeHandler()}
                        className={`absolute right-0 top-0 h-full w-1 cursor-col-resize touch-none select-none ${
                          header.column.getIsResizing() ? 'bg-primary' : 'bg-transparent hover:bg-primary/50'
                        }`}
                      />
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
        </table>
        {rows.length === 0 && (
          <div className="px-3 py-8 text-center text-muted">{t('table.noMatchingRows')}</div>
        )}
        <div
          style={{ height: rowVirtualizer.getTotalSize(), position: 'relative', width: table.getTotalSize() }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            return (
              <div
                key={row.id}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="flex hover:bg-surface-elevated/50"
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    style={{ width: cell.column.getSize(), flexShrink: 0 }}
                    className="group relative cursor-pointer whitespace-nowrap border-b border-r border-border px-3 py-1.5 text-foreground"
                    onClick={() => copyCell(cell.id, cell.getValue())}
                    title={t('table.clickToCopy')}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    {copiedCell === cell.id && (
                      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-success">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
