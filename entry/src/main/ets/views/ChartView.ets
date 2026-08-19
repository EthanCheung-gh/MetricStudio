import { webview } from '@kit.ArkWeb';
import { Theme } from '../common/Theme';
import { CellValue, DataFrame } from '../model/DataFrame';
import { WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';
import { buildFigureJson } from '../engine/PlotlySpec';

/**
 * Chart canvas (web: src/components/chart/ChartCanvas.tsx, port of the old
 * ChartView). An ArkUI Web component loads the bundled plotly.html and renders
 * figures injected via runJavaScript('renderFigure(json)'). Re-rendering is
 * driven by an AppStorage 'chartTick' counter (@StorageLink + @Watch) — a plain
 * number, so the watcher reliably fires whenever encoding/state changes.
 */
@Component
export struct ChartView {
  @StorageLink('chartTick') @Watch('onChartTick') chartTick: number = 0;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @Prop chartId: string = '';
  @Prop filterField: string = '';
  @Prop filterValue: string = '';

  private controller: webview.WebviewController = new webview.WebviewController();
  private pageReady: boolean = false;

  /** Return the active frame, filtered when a dashboard global filter is set. */
  private filteredFrame(): DataFrame | null {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return null;
    }
    if (this.filterField.length === 0 || this.filterValue.length === 0) {
      return df;
    }
    const idx = df.columnIndex(this.filterField);
    if (idx < 0) {
      return df;
    }
    const clone = df.clone();
    const kept: CellValue[][] = [];
    for (let r = 0; r < clone.rows.length; r++) {
      if (String(clone.rows[r][idx]) === this.filterValue) {
        kept.push(clone.rows[r]);
      }
    }
    clone.rows = kept;
    return clone;
  }

  private figureJson(): string {
    const chart = this.chartId.length > 0 ? this.workspaceState.findChart(this.chartId) : this.workspaceState.activeChart();
    const df = this.filteredFrame();
    if (chart === null || df === null) {
      return '';
    }
    try {
      return buildFigureJson(df, chart.encoding, chart.title);
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
