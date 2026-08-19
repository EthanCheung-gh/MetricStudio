import { DataFrame } from '../model/DataFrame';
import { computeAllColumnStats, computeQualityMetrics, findOutliers, ColumnStats } from './ColumnStats';
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
