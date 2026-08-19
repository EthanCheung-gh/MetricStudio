import { ColumnMeta, DataFrame } from '../model/DataFrame';
import { toNumber } from './Numeric';

/** Per-column statistics (web: backend describe endpoint, subset). */
export class ColumnStats {
  column: string;
  dtype: string;
  count: number;
  missing: number;
  uniqueCount: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  sum: number | null;

  constructor() {
    this.column = '';
    this.dtype = '';
    this.count = 0;
    this.missing = 0;
    this.uniqueCount = 0;
    this.min = null;
    this.max = null;
    this.mean = null;
    this.sum = null;
  }
}

export function computeColumnStats(df: DataFrame, columnMeta: ColumnMeta): ColumnStats {
  const s = new ColumnStats();
  s.column = columnMeta.name;
  s.dtype = columnMeta.dtype;
  const idx = df.columnIndex(columnMeta.name);
  if (idx < 0) {
    return s;
  }
  const unique = new Set<string>();
  let numericTotal = 0;
  let numericCount = 0;
  let min: number | null = null;
  let max: number | null = null;
  for (let r = 0; r < df.rows.length; r++) {
    const v = df.rows[r][idx];
    if (v === null || v === undefined) {
      s.missing++;
      continue;
    }
    s.count++;
    unique.add(typeof v === 'number' ? String(v) : String(v));
    const n = toNumber(v);
    if (n !== null) {
      numericTotal += n;
      numericCount++;
      if (min === null || n < min) {
        min = n;
      }
      if (max === null || n > max) {
        max = n;
      }
    }
  }
  s.uniqueCount = unique.size;
  s.min = min;
  s.max = max;
  s.sum = numericCount > 0 ? numericTotal : null;
  s.mean = numericCount > 0 ? numericTotal / numericCount : null;
  return s;
}

export function computeAllColumnStats(df: DataFrame): ColumnStats[] {
  const out: ColumnStats[] = [];
  for (let i = 0; i < df.columns.length; i++) {
    out.push(computeColumnStats(df, df.columns[i]));
  }
  return out;
}

/** Missing cell count across the whole frame + duplicate row count (quality report). */
export class QualityMetrics {
  missingCells: number = 0;
  duplicateRows: number = 0;
  totalCells: number = 0;
}

export function computeQualityMetrics(df: DataFrame): QualityMetrics {
  const m = new QualityMetrics();
  const seen = new Set<string>();
  for (let r = 0; r < df.rows.length; r++) {
    const parts: string[] = [];
    for (let c = 0; c < df.columns.length; c++) {
      const v = df.rows[r][c];
      m.totalCells++;
      if (v === null || v === undefined) {
        m.missingCells++;
      }
      parts.push(v === null ? '' : String(v));
    }
    const key = parts.join('\u0001');
    if (seen.has(key)) {
      m.duplicateRows++;
    } else {
      seen.add(key);
    }
  }
  return m;
}

/** Simple numeric outlier detection: values beyond mean ± 2σ (per column). */
export class OutlierInfo {
  column: string;
  count: number;
  low: number | null;
  high: number | null;

  constructor() {
    this.column = '';
    this.count = 0;
    this.low = null;
    this.high = null;
  }
}

export function findOutliers(df: DataFrame): OutlierInfo[] {
  const out: OutlierInfo[] = [];
  for (let c = 0; c < df.columns.length; c++) {
    const col = df.columns[c];
    if (col.dtype !== 'number') {
      continue;
    }
    const stats = computeColumnStats(df, col);
    if (stats.mean === null || stats.count < 4) {
      continue;
    }
    // stddev
    const idx = df.columnIndex(col.name);
    let ss = 0;
    let n = 0;
    for (let r = 0; r < df.rows.length; r++) {
      const v = toNumber(df.rows[r][idx]);
      if (v !== null) {
        ss += (v - stats.mean) * (v - stats.mean);
        n++;
      }
    }
    const sd = n > 1 ? Math.sqrt(ss / n) : 0;
    if (sd === 0) {
      continue;
    }
    let cnt = 0;
    let low: number | null = null;
    let high: number | null = null;
    for (let r = 0; r < df.rows.length; r++) {
      const v = toNumber(df.rows[r][idx]);
      if (v !== null && (v < stats.mean - 2 * sd || v > stats.mean + 2 * sd)) {
        cnt++;
        if (low === null || v < low) {
          low = v;
        }
        if (high === null || v > high) {
          high = v;
        }
      }
    }
    if (cnt > 0) {
      const o = new OutlierInfo();
      o.column = col.name;
      o.count = cnt;
      o.low = low;
      o.high = high;
      out.push(o);
    }
  }
  return out;
}
