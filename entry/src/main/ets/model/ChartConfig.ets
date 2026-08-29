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
  // gantt (web options.startField/endField)
  startField?: string;
  endField?: string;
  // candlestick (web options.openField/highField/lowField/closeField, default column names)
  openField?: string;
  highField?: string;
  lowField?: string;
  closeField?: string;
  // scatter marginals + heatmap corr modes (web options.marginalX/Y, corr, annotated)
  marginalX?: string;   // '' | histogram | box | violin | rug
  marginalY?: string;
  corrMatrix?: boolean; // heatmap: Pearson correlation matrix mode
  annotateCells?: boolean; // heatmap: cell value annotations

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
  // hierarchical levels for treemap/sunburst/icicle (web encoding.path)
  path: string[] = [];
  // sankey endpoints (web encoding.source/target)
  source: EncodingChannel | null = null;
  target: EncodingChannel | null = null;
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
      o.startField = this.options.startField;
      o.endField = this.options.endField;
      o.openField = this.options.openField;
      o.highField = this.options.highField;
      o.lowField = this.options.lowField;
      o.closeField = this.options.closeField;
      o.marginalX = this.options.marginalX;
      o.marginalY = this.options.marginalY;
      o.corrMatrix = this.options.corrMatrix;
      o.annotateCells = this.options.annotateCells;
      e.options = o;
    }
    for (let i = 0; i < this.path.length; i++) {
      e.path.push(this.path[i]);
    }
    if (this.source !== null) {
      e.source = new EncodingChannel(this.source.field, this.source.type, this.source.aggregate);
    }
    if (this.target !== null) {
      e.target = new EncodingChannel(this.target.field, this.target.type, this.target.aggregate);
    }
    return e;
  }

  /** Serialize the encoding for a saved chart template. */
  toTemplateJson(): string {
    const out: TemplateJson = { chartType: this.chartType };
    if (this.x !== null) {
      out.x = channelToJson(this.x);
    }
    const ys: TemplateYJson[] = [];
    for (let i = 0; i < this.yFields.length; i++) {
      const y = this.yFields[i];
      ys.push({ field: y.field, type: y.type, aggregate: y.aggregate, axis: y.axis, normalize: y.normalize });
    }
    out.yFields = ys;
    if (this.color !== null) {
      out.color = channelToJson(this.color);
    }
    if (this.size !== null) {
      out.size = channelToJson(this.size);
    }
    if (this.facet !== null) {
      out.facet = channelToJson(this.facet);
    }
    if (this.z !== null) {
      out.z = channelToJson(this.z);
    }
    if (this.options !== null) {
      out.options = this.options;
    }
    if (this.path.length > 0) {
      out.path = this.path.slice();
    }
    if (this.source !== null) {
      out.source = channelToJson(this.source);
    }
    if (this.target !== null) {
      out.target = channelToJson(this.target);
    }
    return JSON.stringify(out);
  }

  /** Apply a template JSON onto this encoding (missing keys keep current). */
  applyTemplateJson(json: string): boolean {
    try {
      const tpl = JSON.parse(json) as TemplateJson;
      const fresh = new ChartEncoding();
      fresh.chartType = tpl.chartType !== undefined ? tpl.chartType : this.chartType;
      if (tpl.x !== undefined) {
        fresh.x = channelFromJson(tpl.x);
      }
      if (tpl.yFields !== undefined) {
        for (let i = 0; i < tpl.yFields.length; i++) {
          const y = tpl.yFields[i];
          fresh.yFields.push(new YFieldConfig(y.field, y.type as FieldType,
            y.aggregate as AggregateType, y.axis !== undefined ? y.axis : 'left',
            y.normalize !== undefined ? y.normalize : 'none'));
        }
      }
      if (tpl.color !== undefined) {
        fresh.color = channelFromJson(tpl.color);
      }
      if (tpl.size !== undefined) {
        fresh.size = channelFromJson(tpl.size);
      }
      if (tpl.facet !== undefined) {
        fresh.facet = channelFromJson(tpl.facet);
      }
      if (tpl.z !== undefined) {
        fresh.z = channelFromJson(tpl.z);
      }
      if (tpl.options !== undefined) {
        const o = new ChartOptions();
        o.orientation = tpl.options.orientation;
        o.barmode = tpl.options.barmode;
        o.histnorm = tpl.options.histnorm;
        o.cumulative = tpl.options.cumulative;
        o.boxPoints = tpl.options.boxPoints;
        o.startField = tpl.options.startField;
        o.endField = tpl.options.endField;
        o.openField = tpl.options.openField;
        o.highField = tpl.options.highField;
        o.lowField = tpl.options.lowField;
        o.closeField = tpl.options.closeField;
        o.marginalX = tpl.options.marginalX;
        o.marginalY = tpl.options.marginalY;
        o.corrMatrix = tpl.options.corrMatrix;
        o.annotateCells = tpl.options.annotateCells;
        fresh.options = o;
      }
      if (tpl.path !== undefined) {
        for (let i = 0; i < tpl.path.length; i++) {
          fresh.path.push(tpl.path[i]);
        }
      }
      if (tpl.source !== undefined) {
        fresh.source = channelFromJson(tpl.source);
      }
      if (tpl.target !== undefined) {
        fresh.target = channelFromJson(tpl.target);
      }
      this.chartType = fresh.chartType;
      this.x = fresh.x;
      this.yFields = fresh.yFields;
      this.color = fresh.color;
      this.size = fresh.size;
      this.facet = fresh.facet;
      this.z = fresh.z;
      this.options = fresh.options;
      this.path = fresh.path;
      this.source = fresh.source;
      this.target = fresh.target;
      return true;
    } catch (e) {
      return false;
    }
  }
}

interface TemplateChannelJson {
  field: string;
  type: string;
  aggregate: string | null;
}

interface TemplateYJson {
  field: string;
  type: string;
  aggregate: string | null;
  axis?: string;
  normalize?: string;
}

interface TemplateJson {
  chartType?: string;
  x?: TemplateChannelJson;
  yFields?: TemplateYJson[];
  color?: TemplateChannelJson;
  size?: TemplateChannelJson;
  facet?: TemplateChannelJson;
  z?: TemplateChannelJson;
  options?: ChartOptions;
  path?: string[];
  source?: TemplateChannelJson;
  target?: TemplateChannelJson;
}

function channelToJson(c: EncodingChannel): TemplateChannelJson {
  return { field: c.field, type: c.type, aggregate: c.aggregate };
}

function channelFromJson(j: TemplateChannelJson): EncodingChannel {
  return new EncodingChannel(j.field, j.type as FieldType, j.aggregate as AggregateType);
}

/** User text annotation placed at paper coords (web PropertyEditor addTextAnnotation). */
@Observed
export class ChartAnnotation {
  text: string;

  constructor(text: string) {
    this.text = text;
  }
}

/** User reference line (web PropertyEditor addShape: 'hline' | 'vline'). */
@Observed
export class ChartShape {
  kind: string; // 'hline' | 'vline'
  value: number;
  color: string;

  constructor(kind: string, value: number, color: string) {
    this.kind = kind;
    this.value = value;
    this.color = color;
  }
}

/** Per-chart user layout overlay (annotations + reference lines). */
export class ChartLayout {
  annotations: ChartAnnotation[] = [];
  shapes: ChartShape[] = [];

  clone(): ChartLayout {
    const out = new ChartLayout();
    for (let i = 0; i < this.annotations.length; i++) {
      out.annotations.push(new ChartAnnotation(this.annotations[i].text));
    }
    for (let i = 0; i < this.shapes.length; i++) {
      const s = this.shapes[i];
      out.shapes.push(new ChartShape(s.kind, s.value, s.color));
    }
    return out;
  }
}

@Observed
export class ChartConfig {
  id: string;
  name: string;
  datasetId: string;
  encoding: ChartEncoding;
  layout: ChartLayout = new ChartLayout();
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
