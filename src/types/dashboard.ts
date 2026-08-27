export type DashboardItemKind = 'chart' | 'kpi' | 'text'

export type KpiAggregate = 'sum' | 'mean' | 'count' | 'min' | 'max' | 'nunique'

export interface KpiItemConfig {
  datasetId: string
  field: string
  aggregate: KpiAggregate
  label?: string
}

export interface DashboardItem {
  /** Unique item id. For chart items this is the chart id; for kpi/text items a generated id. */
  chartId: string
  x: number
  y: number
  w: number
  h: number
  /** Item kind; omitted means a chart item (backward compatible with saved projects). */
  kind?: DashboardItemKind
  kpi?: KpiItemConfig
  text?: string
  /** Locked cards cannot be moved or resized on the grid (edit mode still allows unlock). */
  locked?: boolean
}

export type DashboardFilterKind = 'category' | 'range' | 'date'

export interface DashboardFilter {
  id: string
  field: string
  label: string
  kind: DashboardFilterKind
  datasetId: string
  value: unknown // category: string[] | null; range/date: [string, string] | null
}

export interface DashboardDataFilter {
  datasetId: string
  field: string
  op: 'range' | 'in'
  range?: [string, string]
  values?: string[]
}

export interface LayoutTemplate {
  id: string
  name: string
  items: DashboardItem[]
  createdAt: string
}

export interface DashboardConfig {
  id: string
  name: string
  items: DashboardItem[]
  filters: DashboardFilter[]
  cols: number
  rowHeight: number
  createdAt: string
  updatedAt: string
}
