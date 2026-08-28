import { CellValue, DataFrame } from '../model/DataFrame';
import { ChartEncoding, ChartLayout, defaultColors } from '../model/ChartConfig';
import { Theme } from '../common/Theme';
import { pearson } from './StatsTools';
import { toNumber } from './Numeric';
import { buildCandle, buildChartData, buildGantt, buildHierarchy, buildNominalDims,
  buildNumericDims, buildSankey, buildScatter3D, buildStages, buildTable,
  buildTernary, buildTimeline, DimsData, SeriesData
} from './ChartData';

/** Explicit interfaces for the Plotly JSON payload (arkts-no-untyped-obj-literals). */
export interface PlotlyMargin {
  t: number;
  r: number;
  b: number;
  l: number;
}
export interface PlotlyFont {
  color: string;
  size?: number;
}
export interface PlotlyAxis {
  title?: string | null;
  gridcolor?: string;
  side?: string;
  overlaying?: string;
  anchor?: string;
  type?: string;
  domain?: number[];
  showticklabels?: boolean;
  matches?: string;
}
export interface PlotlyGrid {
  rows: number;
  columns: number;
  pattern: string;
  xgap?: number;
  ygap?: number;
}
export interface PlotlyMarker {
  colors?: string[];
  color?: string | number[];
  size?: number;
  opacity?: number;
  colorscale?: Array<(string | number)[]>;
}
export interface PlotlyLine {
  color?: string | number[];
  colorscale?: Array<(string | number)[]>;
}
export interface PlotlyAnnotation {
  text: string;
  xref: string;
  yref: string;
  x: number;
  y: number;
  showarrow: boolean;
  font: PlotlyFont;
}

export interface PlotlyCumulative {
  enabled: boolean;
}

export interface PlotlyContours {
  coloring?: string;
}

export interface PlotlyDim {
  label: string;
  values: Array<string | number>;
}
export interface PlotlySankeyNode {
  label: string[];
  pad?: number;
  thickness?: number;
}
export interface PlotlySankeyLink {
  source: number[];
  target: number[];
  value: number[];
}
export interface PlotlyFill {
  color: string;
}
export interface PlotlyTableHeader {
  values: string[];
  fill: PlotlyFill;
  font: PlotlyFont;
}
export interface PlotlyTableCells {
  values: string[][];
  fill: PlotlyFill;
  font: PlotlyFont;
}
export interface PlotlyScene {
  bgcolor?: string;
  xaxis?: PlotlyAxis;
  yaxis?: PlotlyAxis;
  zaxis?: PlotlyAxis;
}
export interface PlotlyTernary {
  aaxis?: PlotlyAxis;
  baxis?: PlotlyAxis;
  caxis?: PlotlyAxis;
}
export interface PlotlyPolar {
  bgcolor?: string;
}

export interface PlotlyTrace {
  type: string;
  x?: (string | number)[];
  y?: (string | number)[];
  z?: (number | null)[][] | number[];
  name?: string;
  mode?: string;
  yaxis?: string;
  marker?: PlotlyMarker;
  line?: PlotlyLine;
  orientation?: string;
  labels?: string[];
  values?: number[];
  boxpoints?: boolean | string;
  histnorm?: string;
  cumulative?: PlotlyCumulative;
  text?: string[] | string[][];
  textposition?: string;
  points?: boolean;
  colorscale?: string;
  contours?: PlotlyContours;
  theta?: string[];
  r?: number[];
  fill?: string;
  // hierarchical (treemap/sunburst/icicle)
  ids?: string[];
  parents?: string[];
  branchvalues?: string;
  // waterfall
  measure?: string[];
  // gantt (horizontal bars with date base)
  base?: string[];
  // candlestick
  open?: number[];
  high?: number[];
  low?: number[];
  close?: number[];
  // ternary
  a?: number[];
  b?: number[];
  c?: number[];
  // dimension families
  dimensions?: PlotlyDim[];
  // sankey
  node?: PlotlySankeyNode;
  link?: PlotlySankeyLink;
  // table
  header?: PlotlyTableHeader;
  cells?: PlotlyTableCells;
  // violin
  box_visible?: boolean;
  meanline_visible?: boolean;
  // facet / marginal / corr-annotated (web encodingToPlotly)
  xaxis?: string;
  showlegend?: boolean;
  legendgroup?: string;
  zmin?: number;
  zmax?: number;
  reversescale?: boolean;
  texttemplate?: string;
  fillcolor?: string;
}

export interface PlotlyShapeLine {
  color: string;
  width: number;
  dash: string;
}
export interface PlotlyShape {
  type: string;
  xref: string;
  yref: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  line: PlotlyShapeLine;
}

export interface PlotlyLayout {
  autosize: boolean;
  title: string;
  margin: PlotlyMargin;
  paper_bgcolor: string;
  plot_bgcolor: string;
  font: PlotlyFont;
  xaxis: PlotlyAxis;
  yaxis: PlotlyAxis;
  yaxis2?: PlotlyAxis;
  xaxis2?: PlotlyAxis;
  xaxis3?: PlotlyAxis;
  xaxis4?: PlotlyAxis;
  xaxis5?: PlotlyAxis;
  xaxis6?: PlotlyAxis;
  xaxis7?: PlotlyAxis;
  xaxis8?: PlotlyAxis;
  xaxis9?: PlotlyAxis;
  yaxis3?: PlotlyAxis;
  yaxis4?: PlotlyAxis;
  yaxis5?: PlotlyAxis;
  yaxis6?: PlotlyAxis;
  yaxis7?: PlotlyAxis;
  yaxis8?: PlotlyAxis;
  yaxis9?: PlotlyAxis;
  grid?: PlotlyGrid;
  showlegend: boolean;
  barmode?: string;
  bargap?: number;
  annotations?: PlotlyAnnotation[];
  shapes?: PlotlyShape[];
  scene?: PlotlyScene;
  ternary?: PlotlyTernary;
  polar?: PlotlyPolar;
}

export interface PlotlyConfig {
  responsive: boolean;
  displaylogo: boolean;
  displayModeBar: boolean;
}

export interface PlotlyFigure {
  data: PlotlyTrace[];
  layout: PlotlyLayout;
  config: PlotlyConfig;
}

function baseFont(): PlotlyFont {
  // Follows the app theme so light mode charts stay readable in the WebView.
  return { color: Theme.colorForeground() };
}

function baseGrid(): string {
  return Theme.lightMode ? '#c9c9ce' : '#333333';
}

function baseLayout(title: string): PlotlyLayout {
  return {
    autosize: true,
    title: title,
    margin: { t: 40, r: 20, b: 60, l: 60 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: baseFont(),
    xaxis: { title: '', gridcolor: baseGrid() },
    yaxis: { title: null, gridcolor: baseGrid() },
    showlegend: false,
  };
}

function config(): PlotlyConfig {
  return { responsive: true, displaylogo: false, displayModeBar: false };
}

function markerFor(i: number): PlotlyMarker {
  return { color: defaultColors[i % defaultColors.length] };
}

function lineFor(i: number): PlotlyLine {
  return { color: defaultColors[i % defaultColors.length] };
}

function hintNote(layout: PlotlyLayout, text: string): void {
  const ann: PlotlyAnnotation = {
    text: text,
    xref: 'paper',
    yref: 'paper',
    x: 0.5,
    y: 0.5,
    showarrow: false,
    font: { color: Theme.colorMuted(), size: 12 },
  };
  layout.annotations = [ann];
}

function toDims(dims: DimsData): PlotlyDim[] {
  const out: PlotlyDim[] = [];
  for (let i = 0; i < dims.labels.length; i++) {
    out.push({ label: dims.labels[i], values: dims.values[i] });
  }
  return out;
}

/** Chart types that support facet subplots (web encodingToPlotly facet). */
const FACET_TYPES: string[] = ['line', 'bar', 'area', 'step', 'scatter', 'dot'];
const FACET_MAX: number = 9; // subplot axes capped at x9/y9

/**
 * Build a Plotly figure JSON string for the WebView (web: utils/encodingToPlotly
 * + plotlyLayout). Implements the core trace types; unsupported types degrade
 * to an informative note instead of an empty canvas.
 */
export function buildFigureJson(df: DataFrame, encoding: ChartEncoding, title: string,
  userLayout: ChartLayout | null = null): string {
  // Facet 分面（web facet 语义）：按 facet 值分组子图，layout.grid 网格。
  // 实现方式：对每个分组以去除 facet 的 encoding 递归构建子图，再合并
  // traces 并分配 xaxis/yaxis 后缀——聚合在分组内重算，口径与 web 一致。
  const facetField = encoding.facet !== null && FACET_TYPES.indexOf(encoding.chartType) >= 0
    ? encoding.facet.field : '';
  if (facetField.length > 0) {
    const facetFig = buildFacetFigure(df, encoding, title, userLayout, facetField);
    if (facetFig !== null) {
      return JSON.stringify(facetFig);
    }
  }
  const layout = baseLayout(title);
  const data = buildChartData(df, encoding);
  const traces: PlotlyTrace[] = [];
  const type = encoding.chartType;
  let showLegend = false;

  // Multi-Y axis titles + right axis (web: encodingToPlotly).
  const yFields = encoding.yFields;
  const leftLabels: string[] = [];
  const rightLabels: string[] = [];
  for (let i = 0; i < yFields.length; i++) {
    if (yFields[i].axis === 'right') {
      rightLabels.push(yFields[i].field);
    } else {
      leftLabels.push(yFields[i].field);
    }
  }
  const hasRight = rightLabels.length > 0;
  if (leftLabels.length > 0) {
    layout.yaxis.title = leftLabels.join(' / ');
  }
  if (hasRight) {
    const y2: PlotlyAxis = {
      title: rightLabels.join(' / '),
      side: 'right',
      overlaying: 'y',
      anchor: 'x',
      gridcolor: baseGrid(),
    };
    layout.yaxis2 = y2;
  }

  switch (type) {
    case 'line':
    case 'step':
    case 'area':
    case 'dot':
    case 'scatter':
      for (let i = 0; i < data.series.length; i++) {
        const s = data.series[i];
        const tr: PlotlyTrace = {
          type: 'scatter',
          mode: type === 'dot' ? 'markers' : 'lines',
          x: s.x,
          y: s.y,
          name: s.name,
          marker: markerFor(i),
          line: lineFor(i),
        };
        if (s.axis === 'right') {
          tr.yaxis = 'y2';
        }
        traces.push(tr);
      }
      showLegend = data.series.length > 1;
      if (type === 'scatter') {
        appendMarginals(encoding, data.series, traces, layout);
      }
      break;
    case 'bar':
    case 'barh':
      for (let i = 0; i < data.series.length; i++) {
        const s = data.series[i];
        const tr: PlotlyTrace = {
          type: 'bar',
          x: s.x,
          y: s.y,
          name: s.name,
          orientation: type === 'barh' ? 'h' : undefined,
          marker: markerFor(i),
        };
        if (s.axis === 'right') {
          tr.yaxis = 'y2';
        }
        traces.push(tr);
      }
      showLegend = data.series.length > 1;
      break;
    case 'waterfall':
      for (let i = 0; i < data.series.length; i++) {
        const s = data.series[i];
        const measure: string[] = [];
        for (let k = 0; k < s.x.length; k++) {
          measure.push('relative');
        }
        const tr: PlotlyTrace = {
          type: 'waterfall',
          x: s.x,
          y: s.y,
          measure: measure,
          name: s.name,
          marker: markerFor(i),
        };
        if (s.axis === 'right') {
          tr.yaxis = 'y2';
        }
        traces.push(tr);
      }
      break;
    case 'pie':
      traces.push({
        type: 'pie',
        labels: data.pieLabels,
        values: data.pieValues,
        marker: { colors: defaultColors },
      });
      break;
    case 'funnel': {
      // web: y = stage names in first-seen order, x = aggregated values
      const stages = buildStages(df, encoding);
      if (stages.keys.length === 0) {
        hintNote(layout, 'funnel 需要 X（阶段）+ Y（数值）字段');
        break;
      }
      const ftr: PlotlyTrace = {
        type: 'funnel',
        y: stages.keys,
        x: stages.values,
        marker: { colors: defaultColors },
      };
      traces.push(ftr);
      break;
    }
    case 'histogram':
      for (let i = 0; i < data.numericSeries.length; i++) {
        const s = data.numericSeries[i];
        const trace: PlotlyTrace = {
          type: 'histogram',
          x: s.y,
          name: s.name,
          marker: markerFor(i),
        };
        const hOpts = encoding.options;
        if (hOpts !== null && hOpts.histnorm !== undefined && hOpts.histnorm !== null) {
          trace.histnorm = hOpts.histnorm;
        }
        if (hOpts !== null && hOpts.cumulative === true) {
          const cum: PlotlyCumulative = { enabled: true };
          trace.cumulative = cum;
        }
        traces.push(trace);
      }
      layout.barmode = 'overlay';
      layout.bargap = 0.05;
      showLegend = data.numericSeries.length > 1;
      break;
    case 'box':
    case 'violin':
      for (let i = 0; i < data.numericSeries.length; i++) {
        const s = data.numericSeries[i];
        const tr: PlotlyTrace = {
          type: type,
          y: s.y,
          name: s.name,
          marker: markerFor(i),
          boxpoints: false,
        };
        if (type === 'violin') {
          tr.box_visible = true;
          tr.meanline_visible = true;
        }
        traces.push(tr);
      }
      showLegend = data.numericSeries.length > 1;
      break;
    case 'ecdf':
      for (let i = 0; i < data.numericSeries.length; i++) {
        const s = data.numericSeries[i];
        const sorted = s.y.slice().sort((a: number, b: number) => a - b);
        const ecdfY: number[] = [];
        for (let k = 0; k < sorted.length; k++) {
          ecdfY.push((k + 1) / Math.max(1, sorted.length));
        }
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: sorted,
          y: ecdfY,
          name: s.name,
          line: lineFor(i),
        });
      }
      showLegend = data.numericSeries.length > 1;
      break;
    case 'density_heatmap':
    case 'density_contour':
      if (data.densX.length > 0 && data.densY.length > 0) {
        const dtr: PlotlyTrace = {
          type: type === 'density_heatmap' ? 'histogram2d' : 'histogram2dcontour',
          x: data.densX,
          y: data.densY,
          colorscale: 'Viridis',
        };
        if (type === 'density_contour') {
          dtr.contours = { coloring: 'heatmap' };
        }
        traces.push(dtr);
      } else {
        hintNote(layout, 'density 图需要 X + Y 数值字段');
      }
      break;
    case 'heatmap':
    case 'contour': {
      const hmOpts = encoding.options;
      const useCorr = hmOpts !== null && hmOpts.corrMatrix === true;
      const annotate = hmOpts !== null && hmOpts.annotateCells === true;
      if (useCorr) {
        // 相关系数矩阵（web options.corr）：数值列 Pearson，RdBu 反转 [-1,1]
        const corr = buildCorrMatrix(df);
        if (corr !== null) {
          const ctr: PlotlyTrace = {
            type: 'heatmap',
            x: corr.labels,
            y: corr.labels,
            z: corr.z,
            colorscale: 'RdBu',
            zmin: -1,
            zmax: 1,
            reversescale: true,
          };
          if (annotate) {
            ctr.text = corr.text;
            ctr.texttemplate = '%{text}';
          }
          traces.push(ctr);
          break;
        }
      }
      if (data.hmXs.length > 0 && data.hmYs.length > 0) {
        const trace: PlotlyTrace = {
          type: type.indexOf('contour') >= 0 ? 'contour' : 'heatmap',
          x: data.hmXs,
          y: data.hmYs,
          z: data.hmZ,
          colorscale: 'Viridis',
        };
        if (annotate) {
          // 标注单元格（web options.annotated）：z 值 toFixed(2) 文本
          const texts: string[][] = [];
          for (let i = 0; i < data.hmZ.length; i++) {
            const rowZ = data.hmZ[i];
            const rowT: string[] = [];
            for (let k = 0; k < rowZ.length; k++) {
              rowT.push(rowZ[k] === null ? '' : (rowZ[k] as number).toFixed(2));
            }
            texts.push(rowT);
          }
          trace.text = texts;
          trace.texttemplate = '%{text}';
        }
        if (type.indexOf('contour') >= 0) {
          trace.contours = { coloring: 'heatmap' };
        }
        traces.push(trace);
      } else {
        layout.annotations = [{
          text: useCorr ? '相关系数矩阵需要 ≥2 个数值列' : 'heatmap 需要 X + Y + Z(值) 字段',
          xref: 'paper',
          yref: 'paper',
          x: 0.5,
          y: 0.5,
          showarrow: false,
          font: { color: '#9ca3af', size: 12 },
        }];
      }
      break;
    }
    case 'radar':
      // theta = x categories (aggregated), r per y field; close the loop
      for (let i = 0; i < data.series.length; i++) {
        const s = data.series[i];
        const theta = s.x.slice();
        const r = s.y.slice();
        if (theta.length > 0) {
          theta.push(theta[0]);
          r.push(r[0]);
        }
        traces.push({
          type: 'scatterpolar',
          theta: theta,
          r: r,
          name: s.name,
          fill: 'toself',
          line: lineFor(i),
        });
      }
      showLegend = data.series.length > 1;
      layout.polar = { bgcolor: 'rgba(0,0,0,0)' };
      break;
    case 'scatter3d': {
      const d3 = buildScatter3D(df, encoding);
      if (d3.x.length === 0) {
        hintNote(layout, 'scatter3d 需要 X + Y + Z 数值字段');
        break;
      }
      const marker: PlotlyMarker = { size: 4, color: defaultColors[0] };
      if (d3.hasColor) {
        marker.color = d3.catIdx;
        const cs: Array<(string | number)[]> = [];
        const n = Math.max(1, d3.cats.length - 1);
        for (let i = 0; i < d3.cats.length; i++) {
          cs.push([i / n, defaultColors[i % defaultColors.length]]);
        }
        marker.colorscale = cs;
      }
      const tr: PlotlyTrace = {
        type: 'scatter3d',
        mode: 'markers',
        x: d3.x,
        y: d3.y,
        z: d3.z,
        marker: marker,
      };
      traces.push(tr);
      const scene: PlotlyScene = {
        bgcolor: 'rgba(0,0,0,0)',
        xaxis: { title: d3.xTitle },
        yaxis: { title: d3.yTitle },
        zaxis: { title: d3.zTitle },
      };
      layout.scene = scene;
      break;
    }
    case 'candlestick': {
      const cs = buildCandle(df, encoding);
      if (!cs.ok) {
        hintNote(layout, 'candlestick 需要 X + open/high/low/close 列（可在配置中指定）');
        break;
      }
      const tr: PlotlyTrace = {
        type: 'candlestick',
        x: cs.x,
        open: cs.open,
        high: cs.high,
        low: cs.low,
        close: cs.close,
      };
      traces.push(tr);
      break;
    }
    case 'surface': {
      // web 前端留空（靠后端）；移植用同一 pivot 矩阵本地实现
      if (data.hmXs.length === 0) {
        hintNote(layout, 'surface 需要 X + Y + Z(值) 字段');
        break;
      }
      const tr: PlotlyTrace = {
        type: 'surface',
        x: data.hmXs,
        y: data.hmYs,
        z: data.hmZ,
        colorscale: 'Viridis',
      };
      traces.push(tr);
      break;
    }
    case 'timeline': {
      const tl = buildTimeline(df, encoding);
      if (tl.x.length === 0) {
        hintNote(layout, 'timeline 需要 X（时间）+ Y 字段');
        break;
      }
      const tr: PlotlyTrace = {
        type: 'scatter',
        mode: 'markers',
        x: tl.x,
        y: tl.y,
        marker: { size: 8, color: defaultColors[0] },
      };
      traces.push(tr);
      layout.xaxis.type = 'date';
      break;
    }
    case 'splom': {
      const dims = buildNumericDims(df, encoding, 8);
      if (dims.values.length < 2) {
        hintNote(layout, 'splom 需要至少两个数值列');
        break;
      }
      const tr: PlotlyTrace = {
        type: 'splom',
        dimensions: toDims(dims),
        marker: { color: defaultColors[0], size: 5, opacity: 0.7 },
      };
      if (dims.hasColor) {
        const markerRef = tr.marker;
        if (markerRef !== undefined) {
          markerRef.color = dims.catIdx;
        }
      }
      traces.push(tr);
      break;
    }
    case 'parcoords': {
      const dims = buildNumericDims(df, encoding, 8);
      if (dims.values.length < 2) {
        hintNote(layout, 'parcoords 需要至少两个数值列');
        break;
      }
      const tr: PlotlyTrace = {
        type: 'parcoords',
        dimensions: toDims(dims),
        line: {},
      };
      if (dims.hasColor) {
        const cs: Array<(string | number)[]> = [];
        const n = Math.max(1, dims.cats.length - 1);
        for (let i = 0; i < dims.cats.length; i++) {
          cs.push([i / n, defaultColors[i % defaultColors.length]]);
        }
        const lineRef: PlotlyLine = { color: dims.catIdx, colorscale: cs };
        tr.line = lineRef;
      }
      traces.push(tr);
      break;
    }
    case 'parcats': {
      const dims = buildNominalDims(df, 6);
      if (dims.values.length < 2) {
        hintNote(layout, 'parcats 需要至少两个文本列');
        break;
      }
      const tr: PlotlyTrace = {
        type: 'parcats',
        dimensions: toDims(dims),
      };
      traces.push(tr);
      break;
    }
    case 'treemap':
    case 'sunburst':
    case 'icicle': {
      const h = buildHierarchy(df, encoding);
      if (h.ids.length === 0) {
        hintNote(layout, type + ' 需要在配置中选择路径层级列 + Y 数值字段');
        break;
      }
      const tr: PlotlyTrace = {
        type: type,
        ids: h.ids,
        labels: h.labels,
        parents: h.parents,
        values: h.values,
        branchvalues: 'total',
        marker: { colors: defaultColors },
      };
      traces.push(tr);
      break;
    }
    case 'sankey': {
      const sk = buildSankey(df, encoding);
      if (sk.nodes.length === 0) {
        hintNote(layout, 'sankey 需要配置 Source / Target 字段 + Y 数值字段');
        break;
      }
      const node: PlotlySankeyNode = { label: sk.nodes, pad: 12, thickness: 16 };
      const link: PlotlySankeyLink = {
        source: sk.sources,
        target: sk.targets,
        value: sk.values,
      };
      const tr: PlotlyTrace = {
        type: 'sankey',
        node: node,
        link: link,
      };
      traces.push(tr);
      break;
    }
    case 'ternary': {
      const t3 = buildTernary(df, encoding);
      if (t3.a.length === 0) {
        hintNote(layout, 'ternary 需要 X + Y + Z 数值字段（三相比例）');
        break;
      }
      const ternary: PlotlyTernary = {
        aaxis: { title: encoding.x !== null ? encoding.x.field : null },
        baxis: { title: encoding.yFields.length > 0 ? encoding.yFields[0].field : null },
        caxis: { title: encoding.z !== null ? encoding.z.field : null },
      };
      layout.ternary = ternary;
      const groups: string[] = [];
      const byCat = new Map<string, number[]>();
      if (t3.hasColor) {
        for (let i = 0; i < t3.catIdx.length; i++) {
          const cat = t3.cats[i];
          let arr = byCat.get(cat);
          if (arr === undefined) {
            arr = [];
            byCat.set(cat, arr);
            groups.push(cat);
          }
          arr.push(i);
        }
      }
      if (!t3.hasColor) {
        const tr: PlotlyTrace = {
          type: 'scatterternary',
          mode: 'markers',
          a: t3.a,
          b: t3.b,
          c: t3.c,
          name: encoding.yFields.length > 0 ? encoding.yFields[0].field : '',
          marker: { color: defaultColors[0], size: 6 },
        };
        traces.push(tr);
        break;
      }
      for (let g = 0; g < groups.length; g++) {
        const rows = byCat.get(groups[g]);
        if (rows === undefined) {
          continue;
        }
        const a: number[] = [];
        const b: number[] = [];
        const c: number[] = [];
        for (let k = 0; k < rows.length; k++) {
          a.push(t3.a[rows[k]]);
          b.push(t3.b[rows[k]]);
          c.push(t3.c[rows[k]]);
        }
        const tr: PlotlyTrace = {
          type: 'scatterternary',
          mode: 'markers',
          a: a,
          b: b,
          c: c,
          name: groups[g],
          marker: { color: defaultColors[g % defaultColors.length], size: 6 },
        };
        traces.push(tr);
      }
      showLegend = true;
      break;
    }
    case 'table': {
      const tb = buildTable(df);
      if (tb.columns.length === 0) {
        hintNote(layout, 'table 需要已加载数据集');
        break;
      }
      const header: PlotlyTableHeader = {
        values: tb.columns,
        fill: { color: Theme.colorSurfaceElevated() },
        font: { color: Theme.colorForeground() },
      };
      const cells: PlotlyTableCells = {
        values: tb.cells,
        fill: { color: Theme.colorBackground() },
        font: { color: Theme.colorForeground() },
      };
      const tr: PlotlyTrace = {
        type: 'table',
        header: header,
        cells: cells,
      };
      traces.push(tr);
      break;
    }
    case 'gantt': {
      const groups = buildGantt(df, encoding);
      if (groups.length === 0) {
        hintNote(layout, 'gantt 需要在配置中选择开始/结束时间字段 + Y（任务）字段');
        break;
      }
      for (let i = 0; i < groups.length; i++) {
        const g = groups[i];
        const tr: PlotlyTrace = {
          type: 'bar',
          orientation: 'h',
          base: g.base,
          x: g.duration,
          y: g.task,
          name: g.name,
          marker: markerFor(i),
        };
        traces.push(tr);
      }
      layout.xaxis.type = 'date';
      layout.barmode = 'stack';
      break;
    }
    default:
      hintNote(layout, type + ' 暂不支持');
      break;
  }

  layout.showlegend = showLegend;

  // User annotations + reference lines (web PropertyEditor / applyPlotlyUserStyle).
  if (userLayout !== null) {
    const userAnns: PlotlyAnnotation[] = [];
    for (let i = 0; i < userLayout.annotations.length; i++) {
      const ann: PlotlyAnnotation = {
        text: userLayout.annotations[i].text,
        xref: 'paper',
        yref: 'paper',
        x: 0.5,
        y: 1.02,
        showarrow: false,
        font: { color: Theme.colorForeground(), size: 12 },
      };
      userAnns.push(ann);
    }
    if (userAnns.length > 0) {
      if (layout.annotations === undefined || layout.annotations === null) {
        layout.annotations = userAnns;
      } else {
        layout.annotations = layout.annotations.concat(userAnns);
      }
    }
    const shapes: PlotlyShape[] = [];
    for (let i = 0; i < userLayout.shapes.length; i++) {
      const s = userLayout.shapes[i];
      const shapeLine: PlotlyShapeLine = { color: s.color, width: 2, dash: 'dash' };
      if (s.kind === 'vline') {
        const sh: PlotlyShape = {
          type: 'line', xref: 'x', yref: 'paper',
          x0: s.value, x1: s.value, y0: 0, y1: 1, line: shapeLine
        };
        shapes.push(sh);
      } else {
        const sh: PlotlyShape = {
          type: 'line', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: s.value, y1: s.value, line: shapeLine
        };
        shapes.push(sh);
      }
    }
    if (shapes.length > 0) {
      layout.shapes = shapes;
    }
  }

  // Axis titles carrying normalized series get the web "(normalized)" suffix.
  let leftNorm = false;
  let rightNorm = false;
  for (let i = 0; i < data.series.length; i++) {
    const s = data.series[i];
    if (!s.normalized) {
      continue;
    }
    if (s.axis === 'right') {
      rightNorm = true;
    } else {
      leftNorm = true;
    }
  }
  if (leftNorm && layout.yaxis.title !== null && layout.yaxis.title !== undefined) {
    layout.yaxis.title = layout.yaxis.title + ' (normalized)';
  }
  if (rightNorm && layout.yaxis2 !== undefined && layout.yaxis2.title !== null
    && layout.yaxis2.title !== undefined) {
    layout.yaxis2.title = layout.yaxis2.title + ' (normalized)';
  }

  const fig: PlotlyFigure = {
    data: traces,
    layout: layout,
    config: config(),
  };
  return JSON.stringify(fig);
}

/**
 * Facet subplots (web layout.grid parity): group rows by facet value, build a
 * sub-figure per group (aggregation recomputed inside the group), merge traces
 * with x/y axis suffixes, group name into each subplot's xaxis.title, and only
 * the first group shows legend entries. Returns null when facet is not usable
 * (single group / missing column) so the caller falls back to the plain chart.
 */
function buildFacetFigure(df: DataFrame, encoding: ChartEncoding, title: string,
  userLayout: ChartLayout | null, facetField: string): PlotlyFigure | null {
  const idx = df.columnIndex(facetField);
  if (idx < 0) {
    return null;
  }
  const order: string[] = [];
  const seen = new Set<string>();
  for (let r = 0; r < df.rows.length; r++) {
    const v = df.rows[r][idx];
    const key = v === null || v === undefined ? 'null' : String(v);
    if (!seen.has(key)) {
      seen.add(key);
      order.push(key);
    }
  }
  if (order.length < 2) {
    return null;
  }
  const capped = order.slice(0, FACET_MAX);
  const ncols = Math.min(capped.length, 3);
  const nrows = Math.ceil(capped.length / ncols);
  const allTraces: PlotlyTrace[] = [];
  let firstLayout: PlotlyLayout | null = null;
  for (let gi = 0; gi < capped.length; gi++) {
    const rows: CellValue[][] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const v = df.rows[r][idx];
      const key = v === null || v === undefined ? 'null' : String(v);
      if (key === capped[gi]) {
        rows.push(df.rows[r]);
      }
    }
    if (rows.length === 0) {
      continue;
    }
    const subDf = new DataFrame(df.name, df.columns, rows);
    const subEnc = encoding.clone();
    subEnc.facet = null;
    let fig: PlotlyFigure;
    try {
      fig = JSON.parse(buildFigureJson(subDf, subEnc, title, userLayout)) as PlotlyFigure;
    } catch (e) {
      continue;
    }
    if (firstLayout === null) {
      firstLayout = fig.layout;
      firstLayout.showlegend = fig.data.length > 1;
    }
    const suffix = gi === 0 ? '' : String(gi + 1);
    for (let t = 0; t < fig.data.length; t++) {
      const tr = fig.data[t];
      if (suffix.length > 0) {
        tr.xaxis = 'x' + suffix;
        tr.yaxis = 'y' + suffix;
        tr.showlegend = false;
      }
      allTraces.push(tr);
    }
  }
  if (firstLayout === null) {
    return null;
  }
  const layout = firstLayout;
  layout.grid = { rows: nrows, columns: ncols, pattern: 'independent', xgap: 0.08, ygap: 0.12 };
  // 组名写入各子图 xaxis.title（web 子图标题方式）
  for (let gi = 1; gi < capped.length; gi++) {
    const xa: PlotlyAxis = { title: capped[gi], gridcolor: baseGrid() };
    const ya: PlotlyAxis = { title: null, gridcolor: baseGrid() };
    setFacetAxes(layout, gi + 1, xa, ya);
  }
  const out: PlotlyFigure = {
    data: allTraces,
    layout: layout,
    config: config(),
  };
  return out;
}

function setFacetAxes(layout: PlotlyLayout, n: number, xa: PlotlyAxis, ya: PlotlyAxis): void {
  switch (n) {
    case 2:
      layout.xaxis2 = xa;
      layout.yaxis2 = ya;
      break;
    case 3:
      layout.xaxis3 = xa;
      layout.yaxis3 = ya;
      break;
    case 4:
      layout.xaxis4 = xa;
      layout.yaxis4 = ya;
      break;
    case 5:
      layout.xaxis5 = xa;
      layout.yaxis5 = ya;
      break;
    case 6:
      layout.xaxis6 = xa;
      layout.yaxis6 = ya;
      break;
    case 7:
      layout.xaxis7 = xa;
      layout.yaxis7 = ya;
      break;
    case 8:
      layout.xaxis8 = xa;
      layout.yaxis8 = ya;
      break;
    case 9:
      layout.xaxis9 = xa;
      layout.yaxis9 = ya;
      break;
    default:
      break;
  }
}

/**
 * Scatter marginals (web options.marginalX/Y): shrink the main axes to
 * domain [0, 0.8], add marginal axes at [0.82, 1] without tick labels, and
 * append histogram/box/violin traces (rug = transparent box with all points,
 * the same trick the web version uses).
 */
function appendMarginals(encoding: ChartEncoding, series: SeriesData[],
  traces: PlotlyTrace[], layout: PlotlyLayout): void {
  const o = encoding.options;
  if (o === null) {
    return;
  }
  const mx = o.marginalX !== undefined && o.marginalX !== null ? o.marginalX : '';
  const my = o.marginalY !== undefined && o.marginalY !== null ? o.marginalY : '';
  if (mx.length === 0 && my.length === 0) {
    return;
  }
  if (mx.length > 0) {
    layout.yaxis.domain = [0, 0.8];
    layout.yaxis2 = { domain: [0.82, 1], showticklabels: false };
  } else {
    layout.yaxis.domain = [0, 1];
  }
  if (my.length > 0) {
    layout.xaxis.domain = [0, 0.8];
    layout.xaxis2 = { domain: [0.82, 1], showticklabels: false };
  } else {
    layout.xaxis.domain = [0, 1];
  }
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    if (mx.length > 0) {
      traces.push(marginalTrace(mx, s.x, undefined));
    }
    if (my.length > 0) {
      traces.push(marginalTrace(my, undefined, s.y));
    }
  }
}

/** One marginal trace; x given → top marginal (yaxis y2), y given → right (xaxis x2). */
function marginalTrace(kind: string, x: (string | number)[] | undefined,
  y: (string | number)[] | undefined): PlotlyTrace {
  if (kind === 'histogram') {
    const tr: PlotlyTrace = { type: 'histogram', showlegend: false, marker: { color: '#888888' } };
    if (x !== undefined) {
      tr.x = x;
      tr.yaxis = 'y2';
    }
    if (y !== undefined) {
      tr.y = y;
      tr.xaxis = 'x2';
    }
    return tr;
  }
  if (kind === 'violin') {
    const tr: PlotlyTrace = {
      type: 'violin', showlegend: false, box_visible: false, points: false,
      marker: { color: '#888888' },
    };
    if (x !== undefined) {
      tr.x = x;
      tr.yaxis = 'y2';
    }
    if (y !== undefined) {
      tr.y = y;
      tr.xaxis = 'x2';
    }
    return tr;
  }
  if (kind === 'rug') {
    // rug 无原生类型：透明 box + 全部点（web 同款模拟）
    const tr: PlotlyTrace = {
      type: 'box', showlegend: false, boxpoints: 'all',
      fillcolor: 'rgba(0,0,0,0)',
      marker: { color: '#888888', size: 4 },
    };
    if (x !== undefined) {
      tr.x = x;
      tr.yaxis = 'y2';
    }
    if (y !== undefined) {
      tr.y = y;
      tr.xaxis = 'x2';
    }
    return tr;
  }
  // box（默认）
  const tr: PlotlyTrace = {
    type: 'box', showlegend: false, boxpoints: false,
    marker: { color: '#888888' },
  };
  if (x !== undefined) {
    tr.x = x;
    tr.yaxis = 'y2';
  }
  if (y !== undefined) {
    tr.y = y;
    tr.xaxis = 'x2';
  }
  return tr;
}

/** Corr matrix bundle (labels + z + annotated text). */
interface CorrMatrixResult {
  labels: string[];
  z: (number | null)[][];
  text: string[][];
}

/** Numeric column vectors with >50% parsable rows (web corr column rule). */
function buildCorrMatrix(df: DataFrame): CorrMatrixResult | null {
  const labels: string[] = [];
  const vectors: number[][] = [];
  for (let c = 0; c < df.columns.length; c++) {
    const vals: number[] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const n = toNumber(df.rows[r][c]);
      if (n !== null) {
        vals.push(n);
      }
    }
    if (vals.length * 2 > df.rows.length && vals.length >= 2) {
      labels.push(df.columns[c].name);
      vectors.push(vals);
    }
  }
  if (labels.length < 2) {
    return null;
  }
  const n = labels.length;
  const z: (number | null)[][] = [];
  const text: string[][] = [];
  for (let i = 0; i < n; i++) {
    const rowZ: (number | null)[] = [];
    const rowT: string[] = [];
    for (let j = 0; j < n; j++) {
      let v: number | null;
      if (i === j) {
        v = 1;
      } else {
        v = pearson(vectors[i], vectors[j]);
      }
      rowZ.push(v);
      rowT.push(v === null ? '' : v.toFixed(2));
    }
    z.push(rowZ);
    text.push(rowT);
  }
  return { labels: labels, z: z, text: text };
}
