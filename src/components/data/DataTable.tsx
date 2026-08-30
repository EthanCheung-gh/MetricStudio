import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type SortingState,
  type ColumnFiltersState,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, ChevronDown, ChevronUp, ChevronsUpDown, Columns3, Download, Pin, PinOff, Search } from 'lucide-react'
import { Button, Spinner } from '@heroui/react'
import { api } from '@/api/client'
import { useDataStore } from '@/stores/dataStore'
import { useUIStore } from '@/stores/uiStore'
import { fmt } from '@/utils/format'

// Backend Dataset.preview clamps limit to 1..1000.
const MAX_PAGE_SIZE = 1000

export function DataTable() {
  const { t } = useTranslation()
  const preview = useDataStore((s) => s.preview)
  const loading = useDataStore((s) => s.loading)
  const error = useDataStore((s) => s.error)
  const activeDataFrameId = useDataStore((s) => s.activeDataFrameId)
  const loadPreviewPage = useDataStore((s) => s.loadPreviewPage)
  const addNotification = useUIStore((s) => s.addNotification)

  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<Record<string, boolean>>({})
  const [globalFilter, setGlobalFilter] = useState('')
  const [showColumnsPanel, setShowColumnsPanel] = useState(false)
  const [copiedCell, setCopiedCell] = useState<string | null>(null)
  const [pageSize, setPageSize] = useState(200)
  const [pageSizeInput, setPageSizeInput] = useState('200')
  const [page, setPage] = useState(0)
  /** Freeze the table header on scroll; on by default, user can toggle it off. */
  const [freezeHeader, setFreezeHeader] = useState(true)

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
    manualSorting: true,
    manualFiltering: true,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: 'onChange',
  })

  useEffect(() => {
    setPage(0)
    setPageSize(200)
    setSorting([])
    setColumnFilters([])
    setGlobalFilter('')
  }, [activeDataFrameId, preview?.totalRows])

  // Keep the free-form input in sync with the effective page size.
  useEffect(() => {
    setPageSizeInput(String(pageSize))
  }, [pageSize])

  const commitPageSize = () => {
    const parsed = Math.round(Number(pageSizeInput))
    // Backend preview clamps limit to 1..1000.
    const value = Number.isFinite(parsed) ? Math.min(MAX_PAGE_SIZE, Math.max(1, parsed)) : pageSize
    if (value !== pageSize) {
      setPageSize(value)
      setPage(0)
    }
    setPageSizeInput(String(value))
  }

  useEffect(() => {
    setPage(0)
  }, [sorting, columnFilters, globalFilter])

  useEffect(() => {
    if (!activeDataFrameId) return
    const timer = window.setTimeout(() => {
      loadPreviewPage({
        limit: pageSize,
        offset: page * pageSize,
        sortBy: sorting[0]?.id,
        sortAsc: sorting[0] ? !sorting[0].desc : undefined,
        filters: Object.fromEntries(columnFilters.map((item) => [item.id, String(item.value ?? '')])),
        search: globalFilter || undefined,
      })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [activeDataFrameId, page, pageSize, sorting, columnFilters, globalFilter, loadPreviewPage])

  const scrollRef = useRef<HTMLDivElement>(null)
  const rows = table.getRowModel().rows
  // When unfrozen, the header renders inside the scroll container above the
  // rows; tell the virtualizer so visible-range math accounts for its height.
  const inlineHeaderRef = useRef<HTMLDivElement>(null)
  const [inlineHeaderHeight, setInlineHeaderHeight] = useState(0)
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 33,
    overscan: 10,
    scrollMargin: freezeHeader ? 0 : inlineHeaderHeight,
  })
  // Frozen header lives OUTSIDE the scrolling body (Excel-style), so it needs
  // the body's horizontal scroll offset to keep columns aligned.
  const [headerOffset, setHeaderOffset] = useState(0)

  // Measure the inline (unfrozen) header height for the virtualizer offset.
  useEffect(() => {
    if (freezeHeader) return
    const el = inlineHeaderRef.current
    if (!el) return
    const update = () => setInlineHeaderHeight(el.offsetHeight)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [freezeHeader])

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
    if (!activeDataFrameId) return
    window.open(api.exportDatasetUrl(activeDataFrameId, 'csv'), '_blank')
    addNotification('success', t('table.exportStarted'))
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

  const filteredRows = preview.totalFilteredRows ?? preview.totalRows
  const totalPages = Math.max(1, Math.ceil(filteredRows / pageSize))

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <span className="text-xs text-muted">
          {t('table.preview')}: {fmt(filteredRows)} / {fmt(preview.totalRows)} {t('status.rows')} ×{' '}
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
            startContent={freezeHeader ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
            onPress={() => setFreezeHeader((v) => !v)}
            aria-label={freezeHeader ? t('table.unfreezeHeader') : t('table.freezeHeader')}
          >
            {freezeHeader ? t('table.freezeHeader') : t('table.unfreezeHeader')}
          </Button>
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

      {error && <div className="border-b border-danger/30 bg-danger/10 px-3 py-1 text-xs text-danger">{error}</div>}

      {(() => {
        const headerGroup = table.getHeaderGroups()[0]
        const headerRow = (
          <div className="flex text-xs" style={{ width: table.getTotalSize() }}>
            {headerGroup?.headers.map((header) => {
              const sortDir = header.column.getIsSorted()
              return (
                <div
                  key={header.id}
                  className="relative shrink-0 border-b border-r border-border px-3 py-1.5 text-left font-semibold text-muted"
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
                </div>
              )
            })}
          </div>
        )
        // Frozen (default): the header sits OUTSIDE the scroll container, Excel-style,
        // and mirrors the body's horizontal scroll. Unfrozen: it scrolls with the body.
        return (
          <>
            {freezeHeader && (
              <div className="shrink-0 overflow-hidden border-b border-border bg-surface-elevated">
                <div style={{ transform: `translateX(-${headerOffset}px)` }}>
                  {headerRow}
                </div>
              </div>
            )}
            <div
              ref={scrollRef}
              className="flex-1 overflow-auto"
              onScroll={(e) => {
                if (freezeHeader) setHeaderOffset(e.currentTarget.scrollLeft)
              }}
            >
              {!freezeHeader && (
                <div ref={inlineHeaderRef} className="bg-surface-elevated">
                  {headerRow}
                </div>
              )}
              {rows.length === 0 && (
                <div className="px-3 py-8 text-center text-muted">{t('table.noMatchingRows')}</div>
              )}
              <div
                style={{
                  // getTotalSize() includes scrollMargin; strip it so the rows
                  // container starts right under the inline (unfrozen) header.
                  height: rowVirtualizer.getTotalSize() - (freezeHeader ? 0 : inlineHeaderHeight),
                  position: 'relative',
                  width: table.getTotalSize(),
                }}
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
                        // virtualRow.start includes scrollMargin; strip it so the
                        // first row sits flush under the unfrozen header.
                        transform: `translateY(${virtualRow.start - (freezeHeader ? 0 : inlineHeaderHeight)}px)`,
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
          </>
        )
      })()}
      <div className="flex items-center justify-between border-t border-border px-3 py-1.5 text-xs text-muted">
        <div className="flex items-center gap-2">
          <span>{t('table.pageSize')}</span>
          <input
            list="page-size-options"
            type="number"
            min={1}
            max={MAX_PAGE_SIZE}
            value={pageSizeInput}
            onChange={(e) => setPageSizeInput(e.target.value)}
            onBlur={commitPageSize}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitPageSize()
                e.currentTarget.blur()
              }
            }}
            title={`${t('table.pageSize')}: 1 - ${MAX_PAGE_SIZE}`}
            className="w-16 rounded border border-border bg-surface px-1.5 py-1 text-foreground outline-none focus:border-primary"
          />
          <datalist id="page-size-options">
            {[100, 200, 500, MAX_PAGE_SIZE].map((size) => <option key={size} value={size} />)}
          </datalist>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Spinner size="sm" />}
          <Button size="sm" variant="light" isDisabled={page === 0 || loading} onPress={() => setPage(0)}>«</Button>
          <Button size="sm" variant="light" isDisabled={page === 0 || loading} onPress={() => setPage((value) => value - 1)}>‹</Button>
          <span>{t('table.pageOf', { page: page + 1, total: totalPages })}</span>
          <Button size="sm" variant="light" isDisabled={page + 1 >= totalPages || loading} onPress={() => setPage((value) => value + 1)}>›</Button>
          <Button size="sm" variant="light" isDisabled={page + 1 >= totalPages || loading} onPress={() => setPage(totalPages - 1)}>»</Button>
        </div>
      </div>
    </div>
  )
}
