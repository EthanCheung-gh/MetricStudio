import { CellValue, DataFrame } from '../model/DataFrame';
import { ChartEncoding, YFieldConfig } from '../model/ChartConfig';
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
  if (encoding.chartType === 'heatmap' || encoding.chartType === 'contour'
    || encoding.chartType === 'density_heatmap' || encoding.chartType === 'density_contour') {
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
