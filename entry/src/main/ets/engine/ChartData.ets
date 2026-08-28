import { CellValue, DataFrame } from '../model/DataFrame';
import { ChartEncoding, EncodingChannel, YFieldConfig } from '../model/ChartConfig';
import { toNumber } from './Numeric';

/** One Plotly-compatible series (x categories / values). */
export class SeriesData {
  x: string[];
  y: number[];
  name: string;
  axis: string; // 'left' | 'right' (web multi-Y)
  norm: string; // 'none' | 'perSeries' | 'global'
  normalized: boolean;

  constructor(x: string[], y: number[], name: string, axis: string = 'left', norm: string = 'none') {
    this.x = x;
    this.y = y;
    this.name = name;
    this.axis = axis;
    this.norm = norm;
    this.normalized = false;
  }
}

/** Prepared chart payload consumed by PlotlySpec. */
export class ChartDataResult {
  series: SeriesData[] = [];
  // Pie / funnel: labels + values from one Y field aggregated over color/x
  pieLabels: string[] = [];
  pieValues: number[] = [];
  // Histogram / box / violin / ecdf: raw numeric arrays (per color group)
  numericSeries: SeriesData[] = [];
  // Heatmap / contour: x/y/z pivot matrix
  hmXs: string[] = [];
  hmYs: string[] = [];
  hmZ: (number | null)[][] = [];
  // density heatmap/contour: raw x/y values (web histogram2d)
  densX: (string | number)[] = [];
  densY: (string | number)[] = [];
}

/** Pivot (x × y) cross-tabulated with z aggregated (web pivotMatrix). */
export class PivotMatrix {
  xs: string[] = [];
  ys: string[] = [];
  z: (number | null)[][] = [];
}

export function pivotMatrix(df: DataFrame, xField: string, yField: string, zField: string,
  agg: string): PivotMatrix {
  const out = new PivotMatrix();
  const xIdx = df.columnIndex(xField);
  const yIdx = df.columnIndex(yField);
  const zIdx = df.columnIndex(zField);
  if (xIdx < 0 || yIdx < 0 || zIdx < 0) {
    return out;
  }
  const cell = new Map<string, number[]>();
  const xOrder: string[] = [];
  const yOrder: string[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const xk = cellToKey(df.rows[r][xIdx]);
    const yk = cellToKey(df.rows[r][yIdx]);
    const n = toNumber(df.rows[r][zIdx]);
    if (n === null) {
      continue;
    }
    if (xOrder.indexOf(xk) < 0) {
      xOrder.push(xk);
    }
    if (yOrder.indexOf(yk) < 0) {
      yOrder.push(yk);
    }
    const key = xk + '\u0001' + yk;
    let arr = cell.get(key);
    if (arr === undefined) {
      arr = [];
      cell.set(key, arr);
    }
    arr.push(n);
  }
  out.xs = xOrder;
  out.ys = yOrder;
  for (let yi = 0; yi < yOrder.length; yi++) {
    const rowVals: (number | null)[] = [];
    for (let xi = 0; xi < xOrder.length; xi++) {
      const key = xOrder[xi] + '\u0001' + yOrder[yi];
      const arr = cell.get(key);
      rowVals.push(arr !== undefined ? aggregateNumbers(arr, agg) : null);
    }
    out.z.push(rowVals);
  }
  return out;
}

export function cellToKey(v: CellValue): string {
  if (v === null || v === undefined) {
    return '(null)';
  }
  return String(v);
}

function aggregateNumbers(values: number[], agg: string): number {
  if (values.length === 0) {
    return 0;
  }
  switch (agg) {
    case 'mean': {
      let s = 0;
      for (let i = 0; i < values.length; i++) {
        s += values[i];
      }
      return s / values.length;
    }
    case 'count':
      return values.length;
    case 'min': {
      let m = values[0];
      for (let i = 1; i < values.length; i++) {
        if (values[i] < m) {
          m = values[i];
        }
      }
      return m;
    }
    case 'max': {
      let m = values[0];
      for (let i = 1; i < values.length; i++) {
        if (values[i] > m) {
          m = values[i];
        }
      }
      return m;
    }
    case 'sum':
    default: {
      let s = 0;
      for (let i = 0; i < values.length; i++) {
        s += values[i];
      }
      return s;
    }
  }
}

/** Group rows by the x (or color) key; returns Map<key, number[]> in first-seen order. */
function groupValues(df: DataFrame, keyField: string, valueField: string): Map<string, number[]> {
  const kIdx = df.columnIndex(keyField);
  const vIdx = df.columnIndex(valueField);
  const out = new Map<string, number[]>();
  if (kIdx < 0 || vIdx < 0) {
    return out;
  }
  for (let r = 0; r < df.rows.length; r++) {
    const key = cellToKey(df.rows[r][kIdx]);
    const n = toNumber(df.rows[r][vIdx]);
    let arr = out.get(key);
    if (arr === undefined) {
      arr = [];
      out.set(key, arr);
    }
    if (n !== null) {
      arr.push(n);
    }
  }
  return out;
}

/**
 * Build aggregated series for the encoding (web: utils/encodingToPlotly.ts).
 * x + y (aggregated) → one series; color splits into multiple series; pie uses
 * color field as labels; histogram/box/violin return raw numeric groups.
 */
export function buildChartData(df: DataFrame, encoding: ChartEncoding): ChartDataResult {
  const result = new ChartDataResult();
  const y: YFieldConfig | null = encoding.yFields.length > 0 ? encoding.yFields[0] : null;
  const xField: string | null = encoding.x !== null ? encoding.x.field : null;
  const colorField: string | null = encoding.color !== null ? encoding.color.field : null;
  const agg: string = y !== null && y.aggregate !== null ? y.aggregate : 'sum';

  if (encoding.chartType === 'pie' || encoding.chartType === 'funnel') {
    const labelField = colorField !== null ? colorField : (xField !== null ? xField : '');
    const valueField = y !== null ? y.field : (encoding.size !== null ? encoding.size.field : '');
    if (labelField.length > 0 && valueField.length > 0) {
      const groups = groupValues(df, labelField, valueField);
      groups.forEach((values: number[], key: string) => {
        result.pieLabels.push(key);
        result.pieValues.push(aggregateNumbers(values, agg));
      });
    }
    return result;
  }

  // Heatmap / contour: x + y cross-tab with z values (web pivotMatrix)
  if (encoding.chartType === 'heatmap' || encoding.chartType === 'contour') {
    const xF = encoding.x !== null ? encoding.x.field : '';
    const yF = y !== null ? y.field : '';
    const zF = encoding.z !== null ? encoding.z.field : '';
    if (xF.length > 0 && yF.length > 0 && zF.length > 0) {
      const p = pivotMatrix(df, xF, yF, zF, agg);
      result.hmXs = p.xs;
      result.hmYs = p.ys;
      result.hmZ = p.z;
    }
    return result;
  }

  // density heatmap/contour (web: histogram2d over RAW x/y values, no z)
  if (encoding.chartType === 'density_heatmap' || encoding.chartType === 'density_contour') {
    const xF = encoding.x !== null ? encoding.x.field : '';
    const yF = y !== null ? y.field : '';
    if (xF.length > 0 && yF.length > 0) {
      result.densX = rawColumn(df, xF);
      result.densY = rawColumn(df, yF);
    }
    return result;
  }

  if (encoding.chartType === 'histogram' || encoding.chartType === 'box' || encoding.chartType === 'violin'
    || encoding.chartType === 'ecdf') {    const valueField = y !== null ? y.field : (xField !== null ? xField : '');
    const vIdx = df.columnIndex(valueField);
    if (vIdx >= 0) {
      if (colorField !== null) {
        const byColor = new Map<string, number[]>();
        const cIdx = df.columnIndex(colorField);
        for (let r = 0; r < df.rows.length; r++) {
          const n = toNumber(df.rows[r][vIdx]);
          if (n === null) {
            continue;
          }
          const key = cIdx >= 0 ? cellToKey(df.rows[r][cIdx]) : '';
          let arr = byColor.get(key);
          if (arr === undefined) {
            arr = [];
            byColor.set(key, arr);
          }
          arr.push(n);
        }
        byColor.forEach((values: number[], key: string) => {
          result.numericSeries.push(new SeriesData([], values, key));
        });
      } else {
        const values: number[] = [];
        for (let r = 0; r < df.rows.length; r++) {
          const n = toNumber(df.rows[r][vIdx]);
          if (n !== null) {
            values.push(n);
          }
        }
        result.numericSeries.push(new SeriesData([], values, valueField));
      }
    }
    return result;
  }

  // XY (aggregated) with optional color split — one series per Y field when
  // multiple Y fields are configured (web multi-Y), plus color sub-split.
  if (xField !== null && y !== null) {
    const yList = encoding.yFields.length > 1 ? encoding.yFields : [y];
    for (let yi = 0; yi < yList.length; yi++) {
      const yf = yList[yi];
      const yAgg = yf.aggregate !== null ? yf.aggregate : 'sum';
      if (colorField !== null) {
        // series per (yField × color value)
        const cIdx = df.columnIndex(colorField);
        const xIdx = df.columnIndex(xField);
        const yIdx = df.columnIndex(yf.field);
        if (cIdx >= 0 && xIdx >= 0 && yIdx >= 0) {
          const byColor = new Map<string, Map<string, number[]>>();
          const colorOrder: string[] = [];
          for (let r = 0; r < df.rows.length; r++) {
            const ck = cellToKey(df.rows[r][cIdx]);
            const xk = cellToKey(df.rows[r][xIdx]);
            const n = toNumber(df.rows[r][yIdx]);
            let inner = byColor.get(ck);
            if (inner === undefined) {
              inner = new Map<string, number[]>();
              byColor.set(ck, inner);
              colorOrder.push(ck);
            }
            let arr = inner.get(xk);
            if (arr === undefined) {
              arr = [];
              inner.set(xk, arr);
            }
            if (n !== null) {
              arr.push(n);
            }
          }
          for (let i = 0; i < colorOrder.length; i++) {
            const ck = colorOrder[i];
            const inner = byColor.get(ck);
            const xs: string[] = [];
            const ys: number[] = [];
            if (inner !== undefined) {
              inner.forEach((values: number[], xk: string) => {
                xs.push(xk);
                ys.push(aggregateNumbers(values, yAgg));
              });
            }
            const name = yList.length > 1 ? yf.field + ' · ' + ck : ck;
            result.series.push(new SeriesData(xs, ys, name, yf.axis, yf.normalize));
          }
        }
      } else {
        const groups = groupValues(df, xField, yf.field);
        const xs: string[] = [];
        const ys: number[] = [];
        groups.forEach((values: number[], key: string) => {
          xs.push(key);
          ys.push(aggregateNumbers(values, yAgg));
        });
        result.series.push(new SeriesData(xs, ys, yf.field, yf.axis, yf.normalize));
      }
    }
  } else if (y !== null) {
    // no x: single value per color (bar summary)
    const vIdx = df.columnIndex(y.field);
    if (vIdx >= 0) {
      const all: number[] = [];
      for (let r = 0; r < df.rows.length; r++) {
        const n = toNumber(df.rows[r][vIdx]);
        if (n !== null) {
          all.push(n);
        }
      }
      result.series.push(new SeriesData([], [aggregateNumbers(all, agg)], y.field, y.axis, y.normalize));
    }
  }
  applyNormalization(result.series);
  return result;
}

/** Max of absolute values (0 for empty). */
function maxAbs(values: number[]): number {
  let m = 0;
  for (let i = 0; i < values.length; i++) {
    const a = values[i] < 0 ? -values[i] : values[i];
    if (a > m) {
      m = a;
    }
  }
  return m;
}

/**
 * Normalization (web: encodingToPlotly) — perSeries divides by the series' own
 * max |v|; global divides by the max |v| across all global-mode series. Normalized
 * series get a " (normalized)" name suffix and the normalized flag for axis titles.
 */
function applyNormalization(series: SeriesData[]): void {
  let any = false;
  for (let i = 0; i < series.length; i++) {
    if (series[i].norm === 'perSeries' || series[i].norm === 'global') {
      any = true;
      break;
    }
  }
  if (!any) {
    return;
  }
  let globalMax = 0;
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    if (s.norm !== 'global') {
      continue;
    }
    const m = maxAbs(s.y);
    if (m > globalMax) {
      globalMax = m;
    }
  }
  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    if (s.norm !== 'perSeries' && s.norm !== 'global') {
      continue;
    }
    const denom = s.norm === 'global' ? globalMax : maxAbs(s.y);
    if (denom <= 0) {
      continue;
    }
    for (let k = 0; k < s.y.length; k++) {
      s.y[k] = s.y[k] / denom;
    }
    s.name = s.name + ' (normalized)';
    s.normalized = true;
  }
}

// ---- Per-type prep for the remaining Plotly families (web encodingToPlotly) ----

function chanField(ch: EncodingChannel | null): string {
  return ch !== null ? ch.field : '';
}

function rawColumn(df: DataFrame, field: string): (string | number)[] {
  const out: (string | number)[] = [];
  const idx = df.columnIndex(field);
  if (idx < 0) {
    return out;
  }
  for (let r = 0; r < df.rows.length; r++) {
    const v = df.rows[r][idx];
    if (v === null || v === undefined) {
      continue;
    }
    if (typeof v === 'number') {
      out.push(v);
    } else {
      out.push(String(v));
    }
  }
  return out;
}

function columnNumberArray(df: DataFrame, field: string): number[] {
  const out: number[] = [];
  const idx = df.columnIndex(field);
  if (idx < 0) {
    return out;
  }
  for (let r = 0; r < df.rows.length; r++) {
    const n = toNumber(df.rows[r][idx]);
    out.push(n !== null ? n : 0);
  }
  return out;
}

function categoryIndex(df: DataFrame, field: string, cats: string[], idxOut: number[]): boolean {
  const cIdx = df.columnIndex(field);
  if (cIdx < 0) {
    return false;
  }
  const uniq: string[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const c = cellToKey(df.rows[r][cIdx]);
    cats.push(c);
    let i = uniq.indexOf(c);
    if (i < 0) {
      uniq.push(c);
      i = uniq.length - 1;
    }
    idxOut.push(i);
  }
  return true;
}

/** scatter3d (web: numeric x/y/z triplets + category colorscale). */
export class Scatter3DData {
  x: number[] = [];
  y: number[] = [];
  z: number[] = [];
  catIdx: number[] = [];
  cats: string[] = [];
  hasColor: boolean = false;
  xTitle: string = '';
  yTitle: string = '';
  zTitle: string = '';
}

export function buildScatter3D(df: DataFrame, encoding: ChartEncoding): Scatter3DData {
  const out = new Scatter3DData();
  const xf = chanField(encoding.x);
  const yf = encoding.yFields.length > 0 ? encoding.yFields[0].field : '';
  const zf = chanField(encoding.z);
  out.xTitle = xf;
  out.yTitle = yf;
  out.zTitle = zf;
  if (xf.length === 0 || yf.length === 0 || zf.length === 0) {
    return out;
  }
  out.x = columnNumberArray(df, xf);
  out.y = columnNumberArray(df, yf);
  out.z = columnNumberArray(df, zf);
  const cf = chanField(encoding.color);
  if (cf.length > 0) {
    out.hasColor = categoryIndex(df, cf, out.cats, out.catIdx);
  }
  return out;
}

/** treemap/sunburst/icicle levels (web: path levels aggregated by y, branchvalues total). */
export class HierarchyData {
  ids: string[] = [];
  labels: string[] = [];
  parents: string[] = [];
  values: number[] = [];
}

export function buildHierarchy(df: DataFrame, encoding: ChartEncoding): HierarchyData {
  const out = new HierarchyData();
  const yf = encoding.yFields.length > 0 ? encoding.yFields[0] : null;
  if (encoding.path.length === 0 || yf === null) {
    return out;
  }
  const agg = yf.aggregate !== null ? yf.aggregate : 'sum';
  const valueIdx = df.columnIndex(yf.field);
  const pathIdx: number[] = [];
  for (let p = 0; p < encoding.path.length; p++) {
    pathIdx.push(df.columnIndex(encoding.path[p]));
  }
  for (let level = 0; level < encoding.path.length; level++) {
    const groups = new Map<string, number[]>();
    const order: string[] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const parts: string[] = [];
      let missing = false;
      for (let p = 0; p <= level; p++) {
        if (pathIdx[p] < 0) {
          missing = true;
          break;
        }
        parts.push(cellToKey(df.rows[r][pathIdx[p]]));
      }
      if (missing) {
        continue;
      }
      const key = parts.join('/');
      let arr = groups.get(key);
      if (arr === undefined) {
        arr = [];
        groups.set(key, arr);
        order.push(key);
      }
      const n = valueIdx >= 0 ? toNumber(df.rows[r][valueIdx]) : null;
      arr.push(n !== null ? n : 0);
    }
    for (let k = 0; k < order.length; k++) {
      const key = order[k];
      const vals = groups.get(key);
      const segs = key.split('/');
      out.ids.push(key);
      out.labels.push(segs[segs.length - 1]);
      out.parents.push(segs.slice(0, segs.length - 1).join('/'));
      out.values.push(aggregateNumbers(vals !== undefined ? vals : [], agg));
    }
  }
  return out;
}

/** sankey (web: source/target columns + y aggregated; \u0001 key keeps names safe). */
export class SankeyData {
  nodes: string[] = [];
  sources: number[] = [];
  targets: number[] = [];
  values: number[] = [];
}

export function buildSankey(df: DataFrame, encoding: ChartEncoding): SankeyData {
  const out = new SankeyData();
  const srcF = chanField(encoding.source);
  const tgtF = chanField(encoding.target);
  const yf = encoding.yFields.length > 0 ? encoding.yFields[0] : null;
  if (srcF.length === 0 || tgtF.length === 0 || yf === null) {
    return out;
  }
  const agg = yf.aggregate !== null ? yf.aggregate : 'sum';
  const sIdx = df.columnIndex(srcF);
  const tIdx = df.columnIndex(tgtF);
  const vIdx = df.columnIndex(yf.field);
  if (sIdx < 0 || tIdx < 0) {
    return out;
  }
  const groups = new Map<string, number[]>();
  const order: string[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const key = cellToKey(df.rows[r][sIdx]) + '\u0001' + cellToKey(df.rows[r][tIdx]);
    let arr = groups.get(key);
    if (arr === undefined) {
      arr = [];
      groups.set(key, arr);
      order.push(key);
    }
    const n = vIdx >= 0 ? toNumber(df.rows[r][vIdx]) : null;
    arr.push(n !== null ? n : 0);
  }
  const nodeIdx = (name: string): number => {
    let i = out.nodes.indexOf(name);
    if (i < 0) {
      out.nodes.push(name);
      i = out.nodes.length - 1;
    }
    return i;
  };
  for (let k = 0; k < order.length; k++) {
    const key = order[k];
    const segs = key.split('\u0001');
    const vals = groups.get(key);
    out.sources.push(nodeIdx(segs[0]));
    out.targets.push(nodeIdx(segs[1]));
    out.values.push(aggregateNumbers(vals !== undefined ? vals : [], agg));
  }
  return out;
}

/** Numeric/string dimension columns for splom, parcoords, parcats, table. */
export class DimsData {
  labels: string[] = [];
  values: Array<Array<string | number>> = [];
  catIdx: number[] = [];
  cats: string[] = [];
  hasColor: boolean = false;
}

export function buildNumericDims(df: DataFrame, encoding: ChartEncoding, cap: number): DimsData {
  const out = new DimsData();
  for (let c = 0; c < df.columns.length && out.labels.length < cap; c++) {
    if (df.columns[c].dtype !== 'number') {
      continue;
    }
    out.labels.push(df.columns[c].name);
    out.values.push(columnNumberArray(df, df.columns[c].name));
  }
  const cf = chanField(encoding.color);
  if (cf.length > 0) {
    out.hasColor = categoryIndex(df, cf, out.cats, out.catIdx);
  }
  return out;
}

export function buildNominalDims(df: DataFrame, cap: number): DimsData {
  const out = new DimsData();
  for (let c = 0; c < df.columns.length && out.labels.length < cap; c++) {
    const dtype = df.columns[c].dtype;
    if (dtype === 'number' || dtype === 'boolean') {
      continue;
    }
    out.labels.push(df.columns[c].name);
    const arr: Array<string | number> = [];
    for (let r = 0; r < df.rows.length; r++) {
      arr.push(cellToKey(df.rows[r][c]));
    }
    out.values.push(arr);
  }
  return out;
}

/** table (web: all columns, string cells). */
export class TableData {
  columns: string[] = [];
  cells: string[][] = [];
}

export function buildTable(df: DataFrame): TableData {
  const out = new TableData();
  for (let c = 0; c < df.columns.length; c++) {
    out.columns.push(df.columns[c].name);
    const cells: string[] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const v = df.rows[r][c];
      cells.push(v === null || v === undefined ? '' : String(v));
    }
    out.cells.push(cells);
  }
  return out;
}

/** ternary (web: scatterternary a/b/c from x/y/z, color groups). */
export class TernaryData {
  a: number[] = [];
  b: number[] = [];
  c: number[] = [];
  catIdx: number[] = [];
  cats: string[] = [];
  hasColor: boolean = false;
}

export function buildTernary(df: DataFrame, encoding: ChartEncoding): TernaryData {
  const out = new TernaryData();
  const af = chanField(encoding.x);
  const bf = encoding.yFields.length > 0 ? encoding.yFields[0].field : '';
  const cf = chanField(encoding.z);
  if (af.length === 0 || bf.length === 0 || cf.length === 0) {
    return out;
  }
  out.a = columnNumberArray(df, af);
  out.b = columnNumberArray(df, bf);
  out.c = columnNumberArray(df, cf);
  const colf = chanField(encoding.color);
  if (colf.length > 0) {
    out.hasColor = categoryIndex(df, colf, out.cats, out.catIdx);
  }
  return out;
}

/** funnel stages (web: first-seen order preserved, aggregated x values). */
export class StageData {
  keys: string[] = [];
  values: number[] = [];
}

export function buildStages(df: DataFrame, encoding: ChartEncoding): StageData {
  const out = new StageData();
  const yf = encoding.yFields.length > 0 ? encoding.yFields[0] : null;
  const xf = chanField(encoding.x);
  if (yf === null || xf.length === 0) {
    return out;
  }
  const agg = yf.aggregate !== null ? yf.aggregate : 'sum';
  const groups = groupValues(df, xf, yf.field);
  groups.forEach((values: number[], key: string) => {
    out.keys.push(key);
    out.values.push(aggregateNumbers(values, agg));
  });
  return out;
}

/** gantt (web: bar-h with base=start, x=duration ms; grouped by color). */
export class GanttGroup {
  name: string = 'Tasks';
  base: string[] = [];
  duration: number[] = [];
  task: string[] = [];
}

function dateMs(v: CellValue): number {
  const t = new Date(String(v ?? '')).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function buildGantt(df: DataFrame, encoding: ChartEncoding): GanttGroup[] {
  const opts = encoding.options;
  const startF = opts !== null && opts.startField !== undefined ? opts.startField : '';
  const endF = opts !== null && opts.endField !== undefined ? opts.endField : '';
  const yf = encoding.yFields.length > 0 ? encoding.yFields[0] : null;
  if (opts === null || startF.length === 0 || endF.length === 0 || yf === null) {
    return [];
  }
  const sIdx = df.columnIndex(startF);
  const eIdx = df.columnIndex(endF);
  const tIdx = df.columnIndex(yf.field);
  if (sIdx < 0 || eIdx < 0 || tIdx < 0) {
    return [];
  }
  const cf = chanField(encoding.color);
  const cIdx = cf.length > 0 ? df.columnIndex(cf) : -1;
  const groups = new Map<string, GanttGroup>();
  const order: string[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const key = cIdx >= 0 ? cellToKey(df.rows[r][cIdx]) : '';
    let g = groups.get(key);
    if (g === undefined) {
      g = new GanttGroup();
      g.name = key.length > 0 ? key : 'Tasks';
      groups.set(key, g);
      order.push(key);
    }
    const s = dateMs(df.rows[r][sIdx]);
    const e = dateMs(df.rows[r][eIdx]);
    g.base.push(String(df.rows[r][sIdx] ?? ''));
    g.duration.push(s !== 0 && e !== 0 ? e - s : 0);
    g.task.push(cellToKey(df.rows[r][tIdx]));
  }
  const out: GanttGroup[] = [];
  for (let i = 0; i < order.length; i++) {
    const g = groups.get(order[i]);
    if (g !== undefined) {
      out.push(g);
    }
  }
  return out;
}

/** candlestick (web: options OHLC fields, default open/high/low/close names). */
export class CandleData {
  ok: boolean = false;
  x: string[] = [];
  open: number[] = [];
  high: number[] = [];
  low: number[] = [];
  close: number[] = [];
}

export function buildCandle(df: DataFrame, encoding: ChartEncoding): CandleData {
  const out = new CandleData();
  const xf = chanField(encoding.x);
  if (xf.length === 0) {
    return out;
  }
  const opts = encoding.options;
  const oF = opts !== null && opts.openField !== undefined ? opts.openField : 'open';
  const hF = opts !== null && opts.highField !== undefined ? opts.highField : 'high';
  const lF = opts !== null && opts.lowField !== undefined ? opts.lowField : 'low';
  const cF = opts !== null && opts.closeField !== undefined ? opts.closeField : 'close';
  const xIdx = df.columnIndex(xf);
  const oIdx = df.columnIndex(oF);
  const hIdx = df.columnIndex(hF);
  const lIdx = df.columnIndex(lF);
  const cIdx = df.columnIndex(cF);
  if (xIdx < 0 || oIdx < 0 || hIdx < 0 || lIdx < 0 || cIdx < 0) {
    return out;
  }
  out.ok = true;
  for (let r = 0; r < df.rows.length; r++) {
    out.x.push(cellToKey(df.rows[r][xIdx]));
    out.open.push(toNumber(df.rows[r][oIdx]) ?? 0);
    out.high.push(toNumber(df.rows[r][hIdx]) ?? 0);
    out.low.push(toNumber(df.rows[r][lIdx]) ?? 0);
    out.close.push(toNumber(df.rows[r][cIdx]) ?? 0);
  }
  return out;
}

/** timeline (web: scatter markers, x dates + y raw values). */
export class TimelineData {
  x: string[] = [];
  y: string[] = [];
  yTitle: string = '';
}

export function buildTimeline(df: DataFrame, encoding: ChartEncoding): TimelineData {
  const out = new TimelineData();
  const xf = chanField(encoding.x);
  const yf = encoding.yFields.length > 0 ? encoding.yFields[0] : null;
  if (xf.length === 0 || yf === null) {
    return out;
  }
  const xIdx = df.columnIndex(xf);
  const yIdx = df.columnIndex(yf.field);
  if (xIdx < 0 || yIdx < 0) {
    return out;
  }
  out.yTitle = yf.field;
  for (let r = 0; r < df.rows.length; r++) {
    out.x.push(cellToKey(df.rows[r][xIdx]));
    out.y.push(cellToKey(df.rows[r][yIdx]));
  }
  return out;
}
