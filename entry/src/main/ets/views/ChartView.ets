import { webview } from '@kit.ArkWeb';
import { Theme } from '../common/Theme';
import { CellValue, DataFrame } from '../model/DataFrame';
import { applyDashboardFilters, DashboardFilter } from '../model/DashboardState';
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

/**
 * Chart canvas (web: src/components/chart/ChartCanvas.tsx, port of the old
 * ChartView). An ArkUI Web component loads the bundled plotly.html and renders
 * figures injected via runJavaScript('renderFigure(json)'). Re-rendering is
 * driven by an AppStorage 'chartTick' counter (@StorageLink + @Watch) — a plain
 * number, so the watcher reliably fires whenever encoding/state changes.
 * Dashboard usage passes filterJson (dashboard filter set) for card-scoped
 * filtering (web previewChart filters).
 */
@Component
export struct ChartView {
  @StorageLink('chartTick') @Watch('onChartTick') chartTick: number = 0;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @Prop chartId: string = '';
  @Prop filterJson: string = '';

  private controller: webview.WebviewController = new webview.WebviewController();
  private pageReady: boolean = false;

  /** Return the active frame with dashboard filters applied when provided. */
  private filteredFrame(): DataFrame | null {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return null;
    }
    if (this.filterJson.length === 0) {
      return df;
    }
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
      return applyDashboardFilters(df, filters);
    } catch (e) {
      return df;
    }
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
    try {
      this.controller.runJavaScript('renderFigure(' + JSON.stringify(json) + ')').catch(() => {
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
