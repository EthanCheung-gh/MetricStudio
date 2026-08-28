import { webview } from '@kit.ArkWeb';
import { Theme } from '../common/Theme';
import { CellValue, DataFrame } from '../model/DataFrame';
import { applyDashboardFilters, DashboardFilter } from '../model/DashboardState';
import { toNumber } from '../engine/Numeric';
import { WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';
import { buildFigureJson } from '../engine/PlotlySpec';

/** Filter wire format (DashboardView DashFilterSpec subset). */
interface ChartFilterSpec {
  field: string;
  kind: string;
  values: string[];
  lo: string;
  hi: string;
}

/** One cross-chart brush selection (web SelectionFilter). */
export interface BrushSelectionSpec {
  chartId: string;
  xField: string;
  yField: string;
  xRange: (number | string)[] | null;
  yRange: (number | string)[] | null;
}

/** JS bridge target registered as window.arkBridge in the WebView. */
class BrushBridge {
  callback: (json: string) => void = (_json: string) => {};

  onBrush(json: string): void {
    this.callback(json);
  }
}

/**
 * Chart canvas (web: src/components/chart/ChartCanvas.tsx, port of the old
 * ChartView). An ArkUI Web component loads the bundled plotly.html and renders
 * figures injected via runJavaScript('renderFigure(json)'). Re-rendering is
 * driven by an AppStorage 'chartTick' counter (@StorageLink + @Watch) — a plain
 * number, so the watcher reliably fires whenever encoding/state changes.
 * Dashboard usage: filterJson applies the dashboard filter set; brushJson
 * feeds other cards' brush selections; own selection is reported via onBrush
 * (web plotly_selected → brushSelections, session-scoped).
 */
@Component
export struct ChartView {
  @StorageLink('chartTick') @Watch('onChartTick') chartTick: number = 0;
  @Prop @Watch('renderChart') filterJson: string = '';
  @Prop @Watch('renderChart') brushJson: string = '';
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @Prop chartId: string = '';
  onBrush: (chartId: string, brushJson: string) => void = (_chartId: string, _brushJson: string) => {};

  private controller: webview.WebviewController = new webview.WebviewController();
  private pageReady: boolean = false;
  private bridge: BrushBridge = new BrushBridge();

  aboutToAppear(): void {
    this.bridge.callback = (json: string): void => {
      this.onBrush(this.chartId, json);
    };
  }

  /** Return the active frame with dashboard filters + external brushes applied. */
  private filteredFrame(): DataFrame | null {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return null;
    }
    let out = df;
    if (this.filterJson.length > 0) {
      try {
        const specs = JSON.parse(this.filterJson) as ChartFilterSpec[];
        const filters: DashboardFilter[] = [];
        for (let i = 0; i < specs.length; i++) {
          const f = new DashboardFilter(specs[i].field, specs[i].kind);
          f.values = specs[i].values !== undefined ? specs[i].values : [];
          f.lo = specs[i].lo !== undefined ? specs[i].lo : '';
          f.hi = specs[i].hi !== undefined ? specs[i].hi : '';
          filters.push(f);
        }
        out = applyDashboardFilters(out, filters);
      } catch (e) {
        // keep unfiltered frame on malformed specs
      }
    }
    if (this.brushJson.length > 0) {
      out = applyBrushSelections(out, this.brushJson);
    }
    return out;
  }

  /** Meta for the brush bridge: chart id + x/y field names (or null). */
  private brushMeta(): string | null {
    if (this.chartId.length === 0) {
      return null;
    }
    const chart = this.workspaceState.findChart(this.chartId);
    if (chart === null) {
      return null;
    }
    const xField = chart.encoding.x !== null ? chart.encoding.x.field : '';
    const yField = chart.encoding.yFields.length > 0 ? chart.encoding.yFields[0].field : '';
    if (xField.length === 0) {
      return null;
    }
    return JSON.stringify({ chartId: this.chartId, xField: xField, yField: yField });
  }

  private figureJson(): string {
    const chart = this.chartId.length > 0 ? this.workspaceState.findChart(this.chartId) : this.workspaceState.activeChart();
    const df = this.filteredFrame();
    if (chart === null || df === null) {
      return '';
    }
    try {
      return buildFigureJson(df, chart.encoding, chart.title, chart.layout);
    } catch (e) {
      return '';
    }
  }

  private renderChart(): void {
    if (!this.pageReady) {
      return;
    }
    const json = this.figureJson();
    if (json.length === 0) {
      return;
    }
    const meta = this.brushMeta();
    let js = 'renderFigure(' + JSON.stringify(json);
    if (meta !== null) {
      js += ',' + JSON.stringify(meta);
    }
    js += ')';
    try {
      this.controller.runJavaScript(js).catch(() => {
      });
    } catch (e) {
      // WebView not ready yet — ignore
    }
  }

  onChartTick(): void {
    this.renderChart();
  }

  build() {
    Column() {
      Web({ src: $rawfile('plotly.html'), controller: this.controller })
        .width('100%')
        .height('100%')
        .javaScriptAccess(true)
        .domStorageAccess(true)
        .javaScriptProxy({
          object: this.bridge,
          name: 'arkBridge',
          methodList: ['onBrush'],
          controller: this.controller
        })
        .backgroundColor(Theme.colorBackground())
        .onPageEnd(() => {
          this.pageReady = true;
          this.renderChart();
        })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorBackground())
  }
}

/**
 * Cross-chart brush filtering (web _filter_by_selection): x/y closed intervals,
 * numeric first with date/string fallback; selections AND-composed.
 */
function applyBrushSelections(df: DataFrame, brushJson: string): DataFrame {
  let sels: BrushSelectionSpec[] = [];
  try {
    sels = JSON.parse(brushJson) as BrushSelectionSpec[];
  } catch (e) {
    return df;
  }
  let rows: CellValue[][] = df.rows;
  for (let i = 0; i < sels.length; i++) {
    const sel = sels[i];
    if (sel.xRange !== null && sel.xRange !== undefined && sel.xRange.length === 2) {
      rows = filterRange(rows, df, sel.xField, sel.xRange[0], sel.xRange[1], rows.length);
    }
    if (rows.length === 0) {
      break;
    }
    if (sel.yRange !== null && sel.yRange !== undefined && sel.yRange.length === 2) {
      rows = filterRange(rows, df, sel.yField, sel.yRange[0], sel.yRange[1], rows.length);
    }
    if (rows.length === 0) {
      break;
    }
  }
  const out = new DataFrame(df.name, df.columns, rows);
  return out;
}

function filterRange(rows: CellValue[][], df: DataFrame, field: string,
  lo: number | string, hi: number | string, _n: number): CellValue[][] {
  const idx = df.columnIndex(field);
  if (idx < 0) {
    return rows;
  }
  const loN = typeof lo === 'number' ? lo : Number(lo);
  const hiN = typeof hi === 'number' ? hi : Number(hi);
  const numericOk = !Number.isNaN(loN) && !Number.isNaN(hiN);
  const kept: CellValue[][] = [];
  for (let r = 0; r < rows.length; r++) {
    const v = rows[r][idx];
    if (v === null || v === undefined) {
      continue;
    }
    if (numericOk) {
      const n = toNumber(v);
      if (n !== null) {
        if (n >= loN && n <= hiN) {
          kept.push(rows[r]);
        }
        continue;
      }
    }
    const s = String(v);
    if (s >= String(lo) && s <= String(hi)) {
      kept.push(rows[r]);
    }
  }
  return kept;
}
