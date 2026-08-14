export type ChartType =
  // Core relational
  | 'line' | 'bar' | 'barh' | 'area' | 'step' | 'scatter' | 'dot' | 'scatter3d' | 'pie'
  // Statistical distributions
  | 'histogram' | 'box' | 'violin' | 'ecdf' | 'density_heatmap' | 'density_contour'
  // Matrix & correlation
  | 'heatmap' | 'contour' | 'splom'
  // Hierarchical / network / high-dim
  | 'treemap' | 'sunburst' | 'icicle' | 'sankey' | 'parcoords' | 'parcats'
  // Coordinate variants & misc
  | 'radar' | 'ternary' | 'waterfall' | 'funnel' | 'table' | 'gantt' | 'candlestick' | 'surface' | 'timeline';

export type FieldType = 'quantitative' | 'nominal' | 'temporal';

export type AggregateType = 'sum' | 'mean' | 'count' | 'min' | 'max' | null;

export interface EncodingChannel {
  field: string;
  type: FieldType;
  aggregate?: AggregateType;
  bin?: boolean;
}

export interface YFieldConfig {
  field: string;
  type: FieldType;
  aggregate?: AggregateType;
  axis: 'left' | 'right';
  normalize: 'none' | 'perSeries' | 'global';
  label?: string;
}

/** Per-type tuning knobs (all optional; irrelevant ones are ignored per chart type). */
export interface ChartOptions {
  orientation?: 'v' | 'h';                 // bar/box/violin
  barmode?: 'group' | 'stack';             // bar/area
  histnorm?: 'percent' | 'probability' | 'density' | null;  // histogram
  cumulative?: boolean;                    // histogram
  boxPoints?: 'all' | 'outliers' | 'none'; // box/violin
  marginalX?: 'histogram' | 'box' | 'violin' | 'rug' | null;  // scatter
  marginalY?: 'histogram' | 'box' | 'violin' | 'rug' | null;  // scatter
  annotated?: boolean;                     // heatmap: show cell values
  corr?: boolean;                          // heatmap: correlation-matrix mode
  startField?: string;                     // gantt
  endField?: string;                       // gantt
  openField?: string;                      // candlestick
  highField?: string;                      // candlestick
  lowField?: string;                       // candlestick
  closeField?: string;                     // candlestick
}

export interface ChartEncoding {
  x?: EncodingChannel;
  yFields: YFieldConfig[];
  color?: EncodingChannel;
  size?: EncodingChannel;
  facet?: EncodingChannel;
  z?: EncodingChannel;            // 3D value / heatmap & contour cell value / ternary c
  error?: EncodingChannel;        // error bars (line/bar/scatter/area)
  dimensions?: string[];          // splom / parcoords / parcats / table columns
  path?: string[];                // treemap / sunburst / icicle hierarchy levels
  source?: EncodingChannel;       // sankey
  target?: EncodingChannel;       // sankey
  options?: ChartOptions;
  chartType: ChartType;
}

export type Range2 = [number | string, number | string];

/** Crossfilter brush from a source chart, in data coordinates. */
export interface SelectionFilter {
  xField?: string;
  yField?: string;
  xRange?: Range2 | null;
  yRange?: Range2 | null;
}

export interface ChartRecommendation {
  chart_type: string;
  reason: string;
  encoding: ChartEncoding;
}

export interface ChartConfig {
  id: string;
  name: string;
  datasetId: string;
  encoding: ChartEncoding;
  layout: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ChartTemplate {
  id: string;
  name: string;
  encoding: ChartEncoding;
  layout: Record<string, unknown>;
  createdAt: string;
}
