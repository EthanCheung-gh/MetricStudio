import { DataFrame } from '../model/DataFrame';
import { ChartEncoding, ChartLayout, defaultColors } from '../model/ChartConfig';
import { buildChartData } from './ChartData';

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
}
export interface PlotlyMarker {
  colors?: string[];
  color?: string;
  size?: number;
  opacity?: number;
}
export interface PlotlyLine {
  color?: string;
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

export interface PlotlyTrace {
  type: string;
  x?: (string | number)[];
  y?: (string | number)[];
  z?: (number | null)[][];
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
  text?: string[];
  textposition?: string;
  colorscale?: string;
  contours?: PlotlyContours;
  theta?: string[];
  r?: number[];
  fill?: string;
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
  showlegend: boolean;
  barmode?: string;
  bargap?: number;
  annotations?: PlotlyAnnotation[];
  shapes?: PlotlyShape[];
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

const FONT: PlotlyFont = { color: '#f5f5f5' };

function baseLayout(title: string): PlotlyLayout {
  return {
    autosize: true,
    title: title,
    margin: { t: 40, r: 20, b: 60, l: 60 },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: FONT,
    xaxis: { title: '', gridcolor: '#333333' },
    yaxis: { title: null, gridcolor: '#333333' },
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

/**
 * Build a Plotly figure JSON string for the WebView (web: utils/encodingToPlotly
 * + plotlyLayout). Implements the core trace types; unsupported types degrade
 * to an informative note instead of an empty canvas.
 */
export function buildFigureJson(df: DataFrame, encoding: ChartEncoding, title: string,
  userLayout: ChartLayout | null = null): string {
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
      gridcolor: '#333333',
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
        const tr: PlotlyTrace = {
          type: 'waterfall',
          x: s.x,
          y: s.y,
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
    case 'funnel':
      traces.push({
        type: type,
        labels: data.pieLabels,
        values: data.pieValues,
        marker: { colors: defaultColors },
      });
      break;
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
        traces.push({
          type: type,
          y: s.y,
          name: s.name,
          marker: markerFor(i),
          boxpoints: false,
        });
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
    case 'heatmap':
    case 'density_heatmap':
    case 'contour':
    case 'density_contour':
      if (data.hmXs.length > 0 && data.hmYs.length > 0) {
        const trace: PlotlyTrace = {
          type: type.indexOf('contour') >= 0 ? 'contour' : 'heatmap',
          x: data.hmXs,
          y: data.hmYs,
          z: data.hmZ,
          colorscale: 'Viridis',
        };
        if (type.indexOf('contour') >= 0) {
          trace.contours = { coloring: 'heatmap' };
        }
        traces.push(trace);
      } else {
        layout.annotations = [{
          text: 'heatmap 需要 X + Y + Z(值) 字段',
          xref: 'paper',
          yref: 'paper',
          x: 0.5,
          y: 0.5,
          showarrow: false,
          font: { color: '#9ca3af', size: 12 },
        }];
      }
      break;
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
      break;
    case 'sankey':
      layout.annotations = [{
        text: 'sankey 需要 Source/Target 字段',
        xref: 'paper',
        yref: 'paper',
        x: 0.5,
        y: 0.5,
        showarrow: false,
        font: { color: '#9ca3af', size: 12 },
      }];
      break;
    default:
      layout.annotations = [{
        text: type + ' 需要更多字段配置（该类型尚未完整移植）',
        xref: 'paper',
        yref: 'paper',
        x: 0.5,
        y: 0.5,
        showarrow: false,
        font: { color: '#9ca3af', size: 12 },
      }];
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
        font: { color: '#f5f5f5', size: 12 },
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
