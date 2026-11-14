import type { ChartType } from '@/types/encoding'
import {
  GENERATED_CHART_TYPES,
  type GeneratedChartType,
} from '@/utils/chartTypeRegistry.generated'

/** Single-field channels renderable in the EncodingPanel. */
export type ChannelKey = 'x' | 'color' | 'size' | 'facet' | 'z' | 'error' | 'source' | 'target';

/** Per-type option controls shown in the EncodingPanel Options section. */
export type OptionKey =
  | 'barmode' | 'orientation' | 'histnorm' | 'cumulative' | 'boxPoints'
  | 'marginal' | 'annotated' | 'corr' | 'ganttFields' | 'candlestickFields' | 'gaugeRange';

export interface ChartTypeSpec {
  label: string;
  /** Show the multi-Y field list (types marked "first" only consume yFields[0]). */
  yFields: 'multi' | 'first' | 'none';
  channels: ChannelKey[];
  /** Multi-column select: splom / parcoords / parcats / table. */
  dimensionsLabel?: string;
  /** Hierarchy level select: treemap / sunburst / icicle. */
  path?: boolean;
  options?: OptionKey[];
}

export const channelLabels: Record<ChannelKey, string> = {
  x: 'X Axis',
  color: 'Color',
  size: 'Size',
  facet: 'Facet',
  z: 'Z / Value',
  error: 'Error ±',
  source: 'Source',
  target: 'Target',
};

/** Channel ids the panel can render (a newer registry may list more; those are skipped). */
const CHANNEL_KEYS: readonly string[] = [
  'x', 'color', 'size', 'facet', 'z', 'error', 'source', 'target',
];

/** Option ids the panel can render (a newer registry may list more; those are skipped). */
const OPTION_KEYS: readonly string[] = [
  'barmode', 'orientation', 'histnorm', 'cumulative', 'boxPoints',
  'marginal', 'annotated', 'corr', 'ganttFields', 'candlestickFields', 'gaugeRange',
];

const DIMENSIONS_LABELS: Record<'dimensions' | 'columns', string> = {
  dimensions: 'Dimensions',
  columns: 'Columns',
};

function projectSpec(entry: GeneratedChartType): ChartTypeSpec {
  const spec: ChartTypeSpec = {
    label: entry.label,
    yFields: entry.yFields,
    channels: entry.channels.filter((c): c is ChannelKey => CHANNEL_KEYS.includes(c)),
  };
  if (entry.dimensions) spec.dimensionsLabel = DIMENSIONS_LABELS[entry.dimensions];
  if (entry.path) spec.path = true;
  const options = entry.options.filter((o): o is OptionKey => OPTION_KEYS.includes(o));
  if (options.length > 0) spec.options = options;
  return spec;
}

/** Projection of the registry, indexed by chart id — the only lookup table. */
const SPECS_BY_ID = new Map<string, ChartTypeSpec>(
  GENERATED_CHART_TYPES.map((entry) => [entry.id, projectSpec(entry)]),
);

/**
 * Spec for a chart id, never throwing.
 * Unknown ids (older frontend vs newer project file, or future plugin types) get an
 * inert spec: no y-field list, no channels, no options — the chart simply shows no controls
 * instead of crashing the panel.
 */
export function getChartTypeSpec(id: string): ChartTypeSpec {
  return SPECS_BY_ID.get(id) ?? { label: id, yFields: 'none', channels: [], options: [] };
}

/** Ordered chart-type list for pickers (registry order, registry labels). */
export const chartTypeList: { value: ChartType; label: string }[] = GENERATED_CHART_TYPES.map(
  (entry) => ({ value: entry.id, label: entry.label }),
);
