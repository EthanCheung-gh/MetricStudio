/**
 * Chart encoding model (web: src/types/encoding.ts + utils/chartTypeSpecs.ts).
 * All 33 Plotly chart types are supported; figure construction in PlotlySpec.
 */
export type FieldType = 'quantitative' | 'nominal' | 'temporal';
export type AggregateType = 'sum' | 'mean' | 'count' | 'min' | 'max' | null;

export class EncodingChannel {
  field: string;
  type: FieldType;
  aggregate: AggregateType;

  constructor(field: string, type: FieldType, aggregate: AggregateType = null) {
    this.field = field;
    this.type = type;
    this.aggregate = aggregate;
  }
}

export class YFieldConfig {
  field: string;
  type: FieldType;
  aggregate: AggregateType;
  axis: string;      // 'left' | 'right'
  normalize: string; // 'none' | 'perSeries' | 'global'

  constructor(field: string, type: FieldType, aggregate: AggregateType = 'sum', axis: string = 'left',
    normalize: string = 'none') {
    this.field = field;
    this.type = type;
    this.aggregate = aggregate;
    this.axis = axis;
    this.normalize = normalize;
  }
}

export class ChartOptions {
  orientation?: string;
  barmode?: string;
  histnorm?: string;
  cumulative?: boolean;
  boxPoints?: string;

  constructor() {
  }
}

@Observed
export class ChartEncoding {
  x: EncodingChannel | null = null;
  yFields: YFieldConfig[] = [];
  color: EncodingChannel | null = null;
  size: EncodingChannel | null = null;
  facet: EncodingChannel | null = null;
  z: EncodingChannel | null = null;
  options: ChartOptions | null = null;
  chartType: string = 'bar';

  clone(): ChartEncoding {
    const e = new ChartEncoding();
    e.chartType = this.chartType;
    if (this.x !== null) {
      e.x = new EncodingChannel(this.x.field, this.x.type, this.x.aggregate);
    }
    for (let i = 0; i < this.yFields.length; i++) {
      const y = this.yFields[i];
      e.yFields.push(new YFieldConfig(y.field, y.type, y.aggregate, y.axis, y.normalize));
    }
    if (this.color !== null) {
      e.color = new EncodingChannel(this.color.field, this.color.type, this.color.aggregate);
    }
    if (this.size !== null) {
      e.size = new EncodingChannel(this.size.field, this.size.type, this.size.aggregate);
    }
    if (this.facet !== null) {
      e.facet = new EncodingChannel(this.facet.field, this.facet.type, this.facet.aggregate);
    }
    if (this.z !== null) {
      e.z = new EncodingChannel(this.z.field, this.z.type, this.z.aggregate);
    }
    if (this.options !== null) {
      const o = new ChartOptions();
      o.orientation = this.options.orientation;
      o.barmode = this.options.barmode;
      o.histnorm = this.options.histnorm;
      o.cumulative = this.options.cumulative;
      o.boxPoints = this.options.boxPoints;
      e.options = o;
    }
    return e;
  }
}

@Observed
export class ChartConfig {
  id: string;
  name: string;
  datasetId: string;
  encoding: ChartEncoding;
  title: string;

  constructor(id: string, name: string, datasetId: string) {
    this.id = id;
    this.name = name;
    this.datasetId = datasetId;
    this.title = name;
    this.encoding = new ChartEncoding();
  }
}

/** Chart type → display label + channel capability (web chartTypeSpecs). */
export class ChartTypeSpec {
  label: string;
  yFields: string; // 'multi' | 'first' | 'none'
  channels: string[];

  constructor(label: string, yFields: string, channels: string[]) {
    this.label = label;
    this.yFields = yFields;
    this.channels = channels;
  }
}

export function chartTypeSpec(type: string): ChartTypeSpec {
  const s = chartTypeSpecs[type];
  return s !== undefined ? s : new ChartTypeSpec(type, 'first', ['x']);
}

export const chartTypeSpecs: Record<string, ChartTypeSpec> = {
  'line': new ChartTypeSpec('Line', 'multi', ['x', 'color', 'error']),
  'bar': new ChartTypeSpec('Bar', 'multi', ['x', 'color', 'error']),
  'barh': new ChartTypeSpec('Bar (Horizontal)', 'multi', ['x', 'color']),
  'area': new ChartTypeSpec('Area', 'multi', ['x', 'color', 'error']),
  'step': new ChartTypeSpec('Step', 'multi', ['x', 'color']),
  'scatter': new ChartTypeSpec('Scatter', 'multi', ['x', 'color', 'size', 'error', 'facet']),
  'dot': new ChartTypeSpec('Dot', 'multi', ['x', 'color']),
  'scatter3d': new ChartTypeSpec('3D Scatter', 'first', ['x', 'z', 'color']),
  'pie': new ChartTypeSpec('Pie', 'first', ['color']),
  'histogram': new ChartTypeSpec('Histogram', 'first', ['x', 'color']),
  'box': new ChartTypeSpec('Box', 'first', ['color']),
  'violin': new ChartTypeSpec('Violin', 'first', ['color']),
  'ecdf': new ChartTypeSpec('ECDF', 'first', ['color']),
  'density_heatmap': new ChartTypeSpec('2D Density (Heatmap)', 'first', ['x']),
  'density_contour': new ChartTypeSpec('2D Density (Contour)', 'first', ['x']),
  'heatmap': new ChartTypeSpec('Heatmap', 'first', ['x', 'z']),
  'contour': new ChartTypeSpec('Contour', 'first', ['x', 'z']),
  'splom': new ChartTypeSpec('Scatter Matrix', 'none', ['color']),
  'treemap': new ChartTypeSpec('Treemap', 'first', []),
  'sunburst': new ChartTypeSpec('Sunburst', 'first', []),
  'icicle': new ChartTypeSpec('Icicle', 'first', []),
  'sankey': new ChartTypeSpec('Sankey', 'first', ['source', 'target']),
  'parcoords': new ChartTypeSpec('Parallel Coords', 'none', ['color']),
  'parcats': new ChartTypeSpec('Parallel Categories', 'none', []),
  'radar': new ChartTypeSpec('Radar', 'multi', ['x']),
  'ternary': new ChartTypeSpec('Ternary', 'first', ['x', 'z', 'color']),
  'waterfall': new ChartTypeSpec('Waterfall', 'first', ['x']),
  'funnel': new ChartTypeSpec('Funnel', 'first', ['x']),
  'table': new ChartTypeSpec('Table', 'none', []),
  'gantt': new ChartTypeSpec('Gantt', 'first', ['color']),
  'candlestick': new ChartTypeSpec('Candlestick', 'none', ['x']),
  'surface': new ChartTypeSpec('3D Surface', 'first', ['x', 'z']),
  'timeline': new ChartTypeSpec('Timeline', 'first', ['x']),
};

/** Ordered list of chart types for the type selector. */
export const chartTypeList: string[] = [
  'line', 'bar', 'barh', 'area', 'step', 'scatter', 'dot', 'scatter3d', 'pie',
  'histogram', 'box', 'violin', 'ecdf', 'density_heatmap', 'density_contour',
  'heatmap', 'contour', 'splom', 'treemap', 'sunburst', 'icicle', 'sankey',
  'parcoords', 'parcats', 'radar', 'ternary', 'waterfall', 'funnel', 'table',
  'gantt', 'candlestick', 'surface', 'timeline',
];

/** Plotly trace palette (web defaultColors). */
export const defaultColors: string[] = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4',
  '#84cc16', '#f97316', '#6366f1',
];
