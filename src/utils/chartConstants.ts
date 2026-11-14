import type { ChartType } from '@/types/encoding'
import { chartTypeList } from '@/utils/chartTypeSpecs'

/** Chart-type picker entries: registry order, registry labels. */
export const chartTypeOptions: { value: ChartType; label: string }[] = chartTypeList;

export const aggregateOptions: { value: string; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'sum', label: 'Sum' },
  { value: 'mean', label: 'Mean' },
  { value: 'count', label: 'Count' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];
