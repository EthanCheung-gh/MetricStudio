import { DataFrame, TransformOp } from '../model/DataFrame';
import { ChartConfig } from '../model/ChartConfig';
import { Language } from '../model/WorkspaceState';
import { t } from '../common/Locale';
import { buildFigureJson } from './PlotlySpec';
import { Insight, computeInsights } from './Insights';

/** User-selectable report content (web: ReportDialog/StoryDialog split). */
export class ReportOptions {
  title: string = '';
  includeSource: boolean = true;
  includeSteps: boolean = true;
  includeInsights: boolean = true;
  includeConclusion: boolean = false;
  conclusion: string = '';
  chartIds: string[] = [];
  // report mode: 备注（显示在报告中）
  notes: string = '';
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a JSON string for safe embedding inside a <script> block. */
function escapeScript(json: string): string {
  return json.replace(/</g, '\\u003c');
}

const PAGE_CSS: string = 'body{font-family:-apple-system,\'Segoe UI\',\'PingFang SC\',\'Microsoft YaHei\',sans-serif;'
  + 'color:#111827;max-width:960px;margin:0 auto;padding:24px 16px;background:#ffffff}'
  + 'h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 8px;border-bottom:1px solid #e5e7eb;padding-bottom:4px}'
  + '.meta{color:#6b7280;font-size:12px;margin-bottom:16px}'
  + 'table{border-collapse:collapse;font-size:13px;width:100%}th,td{border:1px solid #e5e7eb;padding:4px 8px;text-align:left}'
  + 'code{background:#f3f4f6;padding:1px 5px;border-radius:4px;font-size:12px;word-break:break-all}'
  + 'ul{padding-left:18px}li{margin:4px 0;font-size:13px}'
  + '.chart{width:100%;height:420px}'
  + '.conclusion{font-size:14px;line-height:1.7;white-space:pre-wrap}'
  + '.sev{font-size:11px;padding:1px 6px;border-radius:8px;background:#dbeafe;color:#1e40af;margin-right:6px}'
  + '.sev.warning{background:#fef3c7;color:#92400e}';

/**
 * Build a self-contained story/report HTML (web backend report.py + story.py,
 * offline variant): dataset info + cleaning steps + insights + charts, with
 * plotly.min.js inlined so the file renders without network access.
 */
export function buildReportHtml(df: DataFrame, charts: ChartConfig[], history: TransformOp[],
  options: ReportOptions, plotlyJs: string, lang: Language): string {
  const parts: string[] = [];
  const title = options.title.trim().length > 0 ? options.title.trim() : df.name;

  parts.push('<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>');
  parts.push(escapeHtml(title));
  parts.push('</title>\n<style>');
  parts.push(PAGE_CSS);
  parts.push('</style>\n<script>\n');
  parts.push(plotlyJs);
  parts.push('\n</script>\n</head>\n<body>\n');

  parts.push('<h1>');
  parts.push(escapeHtml(title));
  parts.push('</h1>\n<p class="meta">');
  parts.push(escapeHtml(t(lang, 'report.dataset')) + ': ' + escapeHtml(df.name) + ' · '
    + escapeHtml(t(lang, 'report.generatedAt')) + ': ' + new Date().toISOString() + ' · engine: arkts');
  parts.push('</p>\n');

  if (options.includeSource) {
    parts.push('<h2>');
    parts.push(escapeHtml(t(lang, 'report.sectionSource')));
    parts.push('</h2>\n<table><tr><th>');
    parts.push(escapeHtml(t(lang, 'status.rows')));
    parts.push('</th><td>' + df.rowCount.toString() + '</td><th>');
    parts.push(escapeHtml(t(lang, 'status.cols')));
    parts.push('</th><td>' + df.colCount.toString() + '</td></tr></table>\n');
    parts.push('<table><tr><th>');
    parts.push(escapeHtml(t(lang, 'table.columns')));
    parts.push('</th><th>');
    parts.push(escapeHtml(t(lang, 'report.columnType')));
    parts.push('</th></tr>');
    for (let c = 0; c < df.columns.length; c++) {
      parts.push('<tr><td>' + escapeHtml(df.columns[c].name) + '</td><td>'
        + escapeHtml(df.columns[c].dtype) + '</td></tr>');
    }
    parts.push('</table>\n');
  }

  if (options.includeSteps && history.length > 0) {
    parts.push('<h2>');
    parts.push(escapeHtml(t(lang, 'report.sectionSteps')));
    parts.push('</h2>\n<ol>');
    for (let i = 0; i < history.length; i++) {
      parts.push('<li><code>' + escapeHtml(history[i].type) + '</code> <code>'
        + escapeHtml(history[i].params) + '</code></li>');
    }
    parts.push('</ol>\n');
  }

  if (options.includeInsights) {
    const insights = computeInsights(df);
    if (insights.length > 0) {
      parts.push('<h2>');
      parts.push(escapeHtml(t(lang, 'report.sectionInsights')));
      parts.push('</h2>\n<ul>');
      for (let i = 0; i < insights.length; i++) {
        const ins: Insight = insights[i];
        parts.push('<li><span class="sev ' + escapeHtml(ins.severity) + '">'
          + escapeHtml(ins.severity) + '</span><strong>' + escapeHtml(ins.title)
          + '</strong> — ' + escapeHtml(ins.detail));
        if (ins.suggestions.length > 0) {
          parts.push('<ul>');
          for (let k = 0; k < ins.suggestions.length; k++) {
            parts.push('<li>' + escapeHtml(ins.suggestions[k]) + '</li>');
          }
          parts.push('</ul>');
        }
        parts.push('</li>');
      }
      parts.push('</ul>\n');
    }
  }

  // Charts: figure JSON is generated by the same engine as on-screen charts.
  const figures: string[] = [];
  for (let i = 0; i < charts.length; i++) {
    const chart = charts[i];
    let fig = '';
    try {
      fig = buildFigureJson(df, chart.encoding, chart.title, chart.layout);
    } catch (e) {
      fig = '';
    }
    if (fig.length > 0) {
      figures.push(fig);
    }
  }
  if (figures.length > 0) {
    parts.push('<h2>');
    parts.push(escapeHtml(t(lang, 'report.selectCharts')));
    parts.push('</h2>\n');
    for (let i = 0; i < figures.length; i++) {
      parts.push('<div id="chart-' + i.toString() + '" class="chart"></div>');
    }
    parts.push('<script>\n(function(){\n  var figures = [');
    parts.push(figures.map((f: string): string => escapeScript(f)).join(','));
    parts.push('];\n');
    parts.push('  for (var i = 0; i < figures.length; i++) {\n');
    parts.push('    var el = document.getElementById(\'chart-\' + i);\n');
    parts.push('    if (!el || typeof Plotly === \'undefined\') { continue; }\n');
    parts.push('    var f = figures[i];\n');
    parts.push('    f.layout.font = { color: \'#111827\', size: 12 };\n');
    parts.push('    if (f.layout.annotations) { for (var k = 0; k < f.layout.annotations.length; k++) { f.layout.annotations[k].font = { color: \'#374151\', size: 12 }; } }\n');
    parts.push('    Plotly.newPlot(el, f.data, f.layout, { responsive: true, displaylogo: false, displayModeBar: false });\n');
    parts.push('  }\n})();\n</script>\n');
  }

  if (options.includeConclusion && options.conclusion.trim().length > 0) {
    parts.push('<h2>');
    parts.push(escapeHtml(t(lang, 'report.sectionConclusion')));
    parts.push('</h2>\n<p class="conclusion">');
    parts.push(escapeHtml(options.conclusion));
    parts.push('</p>\n');
  }

  if (options.notes.trim().length > 0) {
    parts.push('<h2>');
    parts.push(escapeHtml(t(lang, 'report.notes')));
    parts.push('</h2>\n<p class="conclusion">');
    parts.push(escapeHtml(options.notes));
    parts.push('</p>\n');
  }

  parts.push('</body>\n</html>\n');
  return parts.join('');
}
