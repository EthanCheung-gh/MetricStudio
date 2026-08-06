import type { ChartType } from '@/types/encoding';

/** Single-field channels renderable in the EncodingPanel. */
export type ChannelKey = 'x' | 'color' | 'size' | 'facet' | 'z' | 'error' | 'source' | 'target';

/** Per-type option controls shown in the EncodingPanel Options section. */
export type OptionKey =
  | 'barmode' | 'orientation' | 'histnorm' | 'cumulative' | 'boxPoints'
  | 'marginal' | 'annotated' | 'corr' | 'ganttFields';

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

export const chartTypeSpecs: Record<ChartType, ChartTypeSpec> = {
  // ---- Core relational ----
  line:     { label: 'Line',            yFields: 'multi', channels: ['x', 'color', 'error'] },
  bar:      { label: 'Bar',             yFields: 'multi', channels: ['x', 'color', 'error'], options: ['barmode'] },
  barh:     { label: 'Bar (Horizontal)', yFields: 'multi', channels: ['x', 'color'] },
  area:     { label: 'Area',            yFields: 'multi', channels: ['x', 'color', 'error'], options: ['barmode'] },
  step:     { label: 'Step',            yFields: 'multi', channels: ['x', 'color'] },
  scatter:  { label: 'Scatter',         yFields: 'multi', channels: ['x', 'color', 'size', 'error', 'facet'], options: ['marginal'] },
  dot:      { label: 'Dot',             yFields: 'multi', channels: ['x', 'color'] },
  scatter3d: { label: '3D Scatter',     yFields: 'first', channels: ['x', 'z', 'color'] },
  pie:      { label: 'Pie',             yFields: 'first', channels: ['color'] },
  // ---- Statistical distributions ----
  histogram: { label: 'Histogram',      yFields: 'first', channels: ['x', 'color'], options: ['histnorm', 'cumulative'] },
  box:      { label: 'Box',             yFields: 'first', channels: ['color'], options: ['orientation', 'boxPoints'] },
  violin:   { label: 'Violin',          yFields: 'first', channels: ['color'], options: ['orientation', 'boxPoints'] },
  ecdf:     { label: 'ECDF',            yFields: 'first', channels: ['color'] },
  density_heatmap: { label: '2D Density (Heatmap)', yFields: 'first', channels: ['x'] },
  density_contour: { label: '2D Density (Contour)', yFields: 'first', channels: ['x'] },
  // ---- Matrix & correlation ----
  heatmap:  { label: 'Heatmap',         yFields: 'first', channels: ['x', 'z'], options: ['annotated', 'corr'] },
  contour:  { label: 'Contour',         yFields: 'first', channels: ['x', 'z'] },
  splom:    { label: 'Scatter Matrix',  yFields: 'none', channels: ['color'], dimensionsLabel: 'Dimensions' },
  // ---- Hierarchical / network / high-dim ----
  treemap:  { label: 'Treemap',         yFields: 'first', channels: [], path: true },
  sunburst: { label: 'Sunburst',        yFields: 'first', channels: [], path: true },
  icicle:   { label: 'Icicle',          yFields: 'first', channels: [], path: true },
  sankey:   { label: 'Sankey',          yFields: 'first', channels: ['source', 'target'] },
  parcoords: { label: 'Parallel Coords', yFields: 'none', channels: ['color'], dimensionsLabel: 'Dimensions' },
  parcats:  { label: 'Parallel Categories', yFields: 'none', channels: [], dimensionsLabel: 'Dimensions' },
  // ---- Coordinate variants & misc ----
  radar:    { label: 'Radar',           yFields: 'multi', channels: ['x'] },
  ternary:  { label: 'Ternary',         yFields: 'first', channels: ['x', 'z', 'color'] },
  waterfall: { label: 'Waterfall',      yFields: 'first', channels: ['x'] },
  funnel:   { label: 'Funnel',          yFields: 'first', channels: ['x'] },
  table:    { label: 'Table',           yFields: 'none', channels: [], dimensionsLabel: 'Columns' },
  gantt:    { label: 'Gantt',           yFields: 'first', channels: ['color'], options: ['ganttFields'] },
};

export const chartTypeList = Object.entries(chartTypeSpecs).map(([value, spec]) => ({
  value: value as ChartType,
  label: spec.label,
}));
