import { DataFrame } from '../model/DataFrame';
import { computeAllColumnStats, computeQualityMetrics, findOutliers, ColumnStats } from './ColumnStats';
import { pearson } from './StatsTools';
import { toNumber } from './Numeric';

/** A single insight / quality issue row (web: QualityIssue). */
export class Insight {
  severity: string;      // 'info' | 'warning'
  title: string;
  detail: string;
  suggestions: string[];

  constructor(severity: string, title: string, detail: string, suggestions: string[]) {
    this.severity = severity;
    this.title = title;
    this.detail = detail;
    this.suggestions = suggestions;
  }
}

export class QualitySummary {
  missingCells: number = 0;
  duplicateRows: number = 0;
  columns: number = 0;
  rows: number = 0;
}

export class QualityReport {
  issues: Insight[] = [];
  summary: QualitySummary = new QualitySummary();
}

/** Compute insights + quality report from local statistics (no backend). */
export function computeInsights(df: DataFrame): Insight[] {
  const out: Insight[] = [];
  const metrics = computeQualityMetrics(df);
  const stats = computeAllColumnStats(df);

  // Missing values
  if (metrics.missingCells > 0) {
    out.push(new Insight('warning', '缺失值',
      `共 ${metrics.missingCells} 个缺失单元格（${metrics.totalCells > 0 ? Math.round(metrics.missingCells / metrics.totalCells * 100) : 0}%）`,
      ['可使用填充缺失值算子处理']));
  }

  // Duplicate rows
  if (metrics.duplicateRows > 0) {
    out.push(new Insight('warning', '重复行',
      `发现 ${metrics.duplicateRows} 行完全重复数据`,
      ['可使用去重算子移除']));
  }

  // Outliers per numeric column
  const outliers = findOutliers(df);
  for (let i = 0; i < outliers.length; i++) {
    const o = outliers[i];
    out.push(new Insight('info', '离群值',
      `${o.column} 列检出 ${o.count} 个离群值（均值±2σ 之外）`,
      ['检查离群值是否合理，必要时过滤']));
  }

  // Distribution / type notes
  for (let i = 0; i < stats.length; i++) {
    const s: ColumnStats = stats[i];
    if (s.dtype === 'number' && s.missing > 0) {
      out.push(new Insight('info', '缺失列',
        `${s.column} 有 ${s.missing} 个空值`,
        ['填充或过滤该列空值']));
    }
    if (s.uniqueCount <= 1 && s.count > 1) {
      out.push(new Insight('info', '常量列',
        `${s.column} 所有值相同（${s.uniqueCount} 个唯一值）`,
        ['可删除该列']));
    }
  }
  return out;
}

/** Simple monotonic trend note for the first numeric column over the first temporal column. */
export function computeTrend(df: DataFrame): string {
  let dateField = '';
  let numField = '';
  for (let i = 0; i < df.columns.length; i++) {
    const c = df.columns[i];
    if (dateField.length === 0 && c.dtype === 'date') {
      dateField = c.name;
    }
    if (numField.length === 0 && c.dtype === 'number') {
      numField = c.name;
    }
  }
  if (dateField.length === 0 || numField.length === 0) {
    return '无趋势数据（需要日期列 + 数值列）';
  }
  const dIdx = df.columnIndex(dateField);
  const nIdx = df.columnIndex(numField);
  const pairs: number[][] = [];
  for (let r = 0; r < df.rows.length; r++) {
    const t = df.rows[r][dIdx] !== null ? String(df.rows[r][dIdx]) : '';
    const n = toNumber(df.rows[r][nIdx]);
    if (t.length > 0 && n !== null) {
      pairs.push([Date.parse(t), n]);
    }
  }
  if (pairs.length < 2) {
    return '数据点不足，无法判断趋势';
  }
  pairs.sort((a: number[], b: number[]) => a[0] - b[0]);
  const first = pairs[0][1];
  const last = pairs[pairs.length - 1][1];
  if (last > first) {
    return `${numField} 随 ${dateField} 整体上升（${first} → ${last}）`;
  }
  if (last < first) {
    return `${numField} 随 ${dateField} 整体下降（${first} → ${last}）`;
  }
  return `${numField} 整体平稳`;
}

export function computeQualityReport(df: DataFrame): QualityReport {
  const report = new QualityReport();
  const metrics = computeQualityMetrics(df);
  report.summary.missingCells = metrics.missingCells;
  report.summary.duplicateRows = metrics.duplicateRows;
  report.summary.columns = df.colCount;
  report.summary.rows = df.rowCount;
  report.issues = computeInsights(df);
  return report;
}

/** Analytics insight card (web InsightsPanel: trend/concentration/skew/correlation/missing). */
export class AnalyticsInsight {
  type: string; // trend | concentration | skew | correlation | missing
  text: string;
  evidence: string;

  constructor(type: string, text: string, evidence: string) {
    this.type = type;
    this.text = text;
    this.evidence = evidence;
  }
}

/** Local narrative-style insight cards replacing web /insights backend cards. */
export function computeAnalyticsInsights(df: DataFrame): AnalyticsInsight[] {
  const out: AnalyticsInsight[] = [];

  // trend over first temporal + first numeric column
  const trend = computeTrend(df);
  if (trend.length > 0 && trend.indexOf('—') < 0) {
    out.push(new AnalyticsInsight('trend', trend, 'method=first_temporal_numeric'));
  }

  // concentration: dominant category of the first nominal column
  for (let c = 0; c < df.columns.length; c++) {
    const col = df.columns[c];
    if (col.dtype === 'number' || col.dtype === 'boolean') {
      continue;
    }
    const groups = new Map<string, number>();
    let total = 0;
    for (let r = 0; r < df.rows.length; r++) {
      const v = df.rows[r][c];
      if (v === null || v === undefined) {
        continue;
      }
      const key = String(v);
      groups.set(key, (groups.get(key) ?? 0) + 1);
      total++;
    }
    let top = '';
    let topN = 0;
    groups.forEach((n: number, key: string) => {
      if (n > topN) {
        topN = n;
        top = key;
      }
    });
    if (total > 0 && topN / total >= 0.5) {
      const pct = Math.round((topN / total) * 100);
      out.push(new AnalyticsInsight('concentration',
        `「${col.name}」中「${top}」占比 ${pct}%，分布高度集中。`,
        `column=${col.name}  share=${pct}%  top=${top}`));
    }
    break; // first nominal column only
  }

  // skew: first numeric column, mean vs median
  for (let c = 0; c < df.columns.length; c++) {
    if (df.columns[c].dtype !== 'number') {
      continue;
    }
    const vals: number[] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const n = toNumber(df.rows[r][c]);
      if (n !== null) {
        vals.push(n);
      }
    }
    if (vals.length < 3) {
      break;
    }
    let s = 0;
    for (let i = 0; i < vals.length; i++) {
      s += vals[i];
    }
    const mean = s / vals.length;
    const sorted = vals.slice().sort((a: number, b: number) => a - b);
    const median = sorted.length % 2 === 1
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    const denom = Math.max(Math.abs(median), 1e-9);
    const skew = (mean - median) / denom;
    if (Math.abs(skew) > 0.25) {
      const dir = skew > 0 ? '右偏（右侧长尾）' : '左偏（左侧长尾）';
      out.push(new AnalyticsInsight('skew',
        `「${df.columns[c].name}」呈${dir}：均值 ${mean.toFixed(2)} ${skew > 0 ? '>' : '<'} 中位数 ${median.toFixed(2)}。`,
        `column=${df.columns[c].name}  mean=${mean.toFixed(2)}  median=${median.toFixed(2)}`));
    }
    break; // first numeric column only
  }

  // correlation: strongest numeric pair
  const stats = computeAllColumnStats(df);
  const numericCols: string[] = [];
  const vectors: number[][] = [];
  for (let i = 0; i < stats.length && numericCols.length < 8; i++) {
    if (stats[i].dtype === 'number' && stats[i].count > 1) {
      const vals: number[] = [];
      const idx = df.columnIndex(stats[i].column);
      for (let r = 0; r < df.rows.length; r++) {
        const n = toNumber(df.rows[r][idx]);
        if (n !== null) {
          vals.push(n);
        }
      }
      numericCols.push(stats[i].column);
      vectors.push(vals);
    }
  }
  let bestR: number | null = null;
  let bestPair = '';
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      const r = pearson(vectors[i], vectors[j]);
      if (r !== null && (bestR === null || Math.abs(r) > Math.abs(bestR))) {
        bestR = r;
        bestPair = numericCols[i] + ' × ' + numericCols[j];
      }
    }
  }
  if (bestR !== null && Math.abs(bestR) >= 0.6) {
    out.push(new AnalyticsInsight('correlation',
      `${bestPair} 呈${bestR > 0 ? '正' : '负'}相关（r=${bestR.toFixed(2)}）。`,
      `pair=${bestPair}  r=${bestR.toFixed(2)}`));
  }

  // missing
  const metrics = computeQualityMetrics(df);
  if (metrics.missingCells > 0) {
    out.push(new AnalyticsInsight('missing',
      `数据集共 ${metrics.missingCells} 个缺失单元格（约 ${metrics.totalCells > 0 ? Math.round(metrics.missingCells / metrics.totalCells * 100) : 0}%）。`,
      `cells=${metrics.missingCells}`));
  }
  return out;
}
