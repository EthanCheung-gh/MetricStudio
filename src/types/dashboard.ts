export interface DashboardItem {
  chartId: string
  x: number
  y: number
  w: number
  h: number
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
