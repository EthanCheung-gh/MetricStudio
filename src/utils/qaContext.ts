import type { QAFilter } from '@/stores/qaStore'
import type { DashboardFilter } from '@/types/dashboard'

export function dashboardFiltersForDataset(filters: DashboardFilter[], datasetId: string): QAFilter[] {
  return filters.flatMap<QAFilter>((filter) => {
    if (filter.datasetId !== datasetId || !Array.isArray(filter.value)) return []
    if (filter.kind === 'category') {
      const values = filter.value.filter((value): value is string => typeof value === 'string' && value.length > 0)
      return values.length > 0 ? [{ field: filter.field, op: 'in', values }] : []
    }
    const [lo, hi] = filter.value
    const isBound = (value: unknown): value is string | number | null => value === null || typeof value === 'string' || typeof value === 'number'
    return isBound(lo) && isBound(hi) && (lo !== '' || hi !== '')
      ? [{ field: filter.field, op: 'range', range: [lo, hi] }]
      : []
  })
}
