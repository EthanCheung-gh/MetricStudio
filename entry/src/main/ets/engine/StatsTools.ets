import { DataFrame } from '../model/DataFrame';
import { toNumber } from './Numeric';

/**
 * Local statistical tools for the Stats panel (web: backend /correlation,
 * /regression, /difference-test, /ci-mean). Pearson/OLS/Welch-t computed
 * directly on the frame; p-values use a normal approximation and are marked
 * as approximate in the UI.
 */
export class PearsonMatrix {
  ok: boolean = false;
  columns: string[] = [];
  matrix: (number | null)[][] = [];
  pairs: string[] = [];
}

function numericVectors(df: DataFrame, cap: number): string[] {
  const cols: string[] = [];
  for (let c = 0; c < df.columns.length && cols.length < cap; c++) {
    if (df.columns[c].dtype === 'number') {
      cols.push(df.columns[c].name);
    }
  }
  return cols;
}

export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n === 0) {
    return null;
  }
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[i] - ma;
    const xb = b[i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da === 0 || db === 0) {
    return null;
  }
  return num / Math.sqrt(da * db);
}

export function pearsonMatrix(df: DataFrame): PearsonMatrix {
  const out = new PearsonMatrix();
  const cols = numericVectors(df, 8);
  if (cols.length < 2) {
    return out;
  }
  const vectors: number[][] = [];
  for (let c = 0; c < cols.length; c++) {
    vectors.push(columnNumberArray(df, cols[c]));
  }
  out.columns = cols;
  let best = 0;
  let bestText = '';
  for (let i = 0; i < cols.length; i++) {
    const row: (number | null)[] = [];
    for (let j = 0; j < cols.length; j++) {
      if (i === j) {
        row.push(null);
        continue;
      }
      const r = pearson(vectors[i], vectors[j]);
      row.push(r);
      if (r !== null && Math.abs(r) > Math.abs(best) && Math.abs(r) >= 0.6) {
        best = r;
        bestText = `${cols[i]} × ${cols[j]}: r=${r.toFixed(2)}${r > 0 ? '（正相关）' : '（负相关）'}`;
      }
    }
    out.matrix.push(row);
  }
  if (bestText.length > 0) {
    out.pairs.push(bestText);
  }
  out.ok = true;
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
    if (n !== null) {
      out.push(n);
    }
  }
  return out;
}

export class RegressionResult {
  ok: boolean = false;
  detail: string = '';
  n: number = 0;
  slope: number = 0;
  intercept: number = 0;
  r2: number | null = null;
  interpretation: string = '';
}

/** OLS simple linear regression y ~ x (web /regression; p-value omitted). */
export function linearRegression(df: DataFrame, xField: string, yField: string): RegressionResult {
  const out = new RegressionResult();
  const xIdx = df.columnIndex(xField);
  const yIdx = df.columnIndex(yField);
  if (xIdx < 0 || yIdx < 0) {
    out.detail = '字段不存在';
    return out;
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const x = toNumber(df.rows[r][xIdx]);
    const y = toNumber(df.rows[r][yIdx]);
    if (x !== null && y !== null) {
      xs.push(x);
      ys.push(y);
    }
  }
  const n = xs.length;
  out.n = n;
  if (n < 2) {
    out.detail = '有效样本不足';
    return out;
  }
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i];
    sy += ys[i];
  }
  const mx = sx / n;
  const my = sy / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) * (xs[i] - mx);
  }
  if (sxx === 0) {
    out.detail = 'X 无方差';
    return out;
  }
  out.slope = sxy / sxx;
  out.intercept = my - out.slope * mx;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const pred = out.intercept + out.slope * xs[i];
    ssRes += (ys[i] - pred) * (ys[i] - pred);
    ssTot += (ys[i] - my) * (ys[i] - my);
  }
  out.r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
  const dir = out.slope >= 0 ? '正' : '负';
  const fit = out.r2 !== null && out.r2 > 0.5 ? '拟合较好' : '拟合较弱';
  out.interpretation = `y 随 x 每增加 1 约变化 ${out.slope.toFixed(2)}（${dir}相关），R²=${out.r2 !== null ? out.r2.toFixed(3) : '—'}，${fit}。`;
  out.ok = true;
  return out;
}

export class TTestResult {
  ok: boolean = false;
  detail: string = '';
  method: string = "Welch t";
  t: number = 0;
  significant: boolean = false;
  interpretation: string = '';
  nA: number = 0;
  nB: number = 0;
  meanA: number | null = null;
  meanB: number | null = null;
}

interface PairStats {
  m: number;
  s2: number;
}

function statsOf(v: number[]): PairStats {
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
  }
  const m = s / v.length;
  let ss = 0;
  for (let i = 0; i < v.length; i++) {
    ss += (v[i] - m) * (v[i] - m);
  }
  const out: PairStats = { m: m, s2: ss / (v.length - 1) };
  return out;
}

/** Welch two-sample t statistic; significance via normal approximation (web /difference-test). */
export function welchTTest(df: DataFrame, measure: string, groupCol: string,
  groupA: string, groupB: string): TTestResult {
  const out = new TTestResult();
  const mIdx = df.columnIndex(measure);
  const gIdx = df.columnIndex(groupCol);
  if (mIdx < 0 || gIdx < 0) {
    out.detail = '字段不存在';
    return out;
  }
  const a: number[] = [];
  const b: number[] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const g = df.rows[r][gIdx];
    if (g === null || g === undefined) {
      continue;
    }
    const key = String(g);
    const n = toNumber(df.rows[r][mIdx]);
    if (n === null) {
      continue;
    }
    if (key === groupA) {
      a.push(n);
    } else if (key === groupB) {
      b.push(n);
    }
  }
  out.nA = a.length;
  out.nB = b.length;
  if (a.length < 2 || b.length < 2) {
    out.detail = '两组样本均需 ≥2';
    return out;
  }
  const sa = statsOf(a);
  const sb = statsOf(b);
  const se = Math.sqrt(sa.s2 / a.length + sb.s2 / b.length);
  if (se === 0) {
    out.detail = '两组均无方差';
    return out;
  }
  out.t = (sa.m - sb.m) / se;
  out.meanA = sa.m;
  out.meanB = sb.m;
  out.significant = Math.abs(out.t) >= 1.96;
  const diff = sa.m - sb.m;
  out.interpretation = `${groupA}（均值 ${sa.m.toFixed(2)}）与 ${groupB}（均值 ${sb.m.toFixed(2)}）差异${out.significant ? '显著' : '不显著'}（Δ=${diff.toFixed(2)}）。`;
  out.ok = true;
  return out;
}

export class CiMeanResult {
  ok: boolean = false;
  detail: string = '';
  column: string = '';
  n: number = 0;
  mean: number = 0;
  low: number = 0;
  high: number = 0;
}

/** 95% CI of the mean via normal approximation (web /ci-mean). */
export function ciMean(df: DataFrame, column: string): CiMeanResult {
  const out = new CiMeanResult();
  const values = columnNumberArray(df, column);
  out.column = column;
  const n = values.length;
  out.n = n;
  if (n < 2) {
    out.detail = '有效样本不足';
    return out;
  }
  let s = 0;
  for (let i = 0; i < n; i++) {
    s += values[i];
  }
  const m = s / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    ss += (values[i] - m) * (values[i] - m);
  }
  const sd = Math.sqrt(ss / (n - 1));
  const half = 1.96 * sd / Math.sqrt(n);
  out.mean = m;
  out.low = m - half;
  out.high = m + half;
  out.ok = true;
  return out;
}
