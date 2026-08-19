import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { fmtShort } from '../common/Format';
import { ChartConfig } from '../model/ChartConfig';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { toNumber } from '../engine/Numeric';
import { ChartView } from './ChartView';

/**
 * Dashboard view (web: src/components/dashboard/DashboardView.tsx subset).
 * Grid of chart cards (each renders its own WebView+Plotly) plus KPI cards
 * showing an aggregate of a numeric column over the whole dataset.
 */
@Component
export struct DashboardView {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;

  private kpiValue(column: string, agg: string): string {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return '—';
    }
    const idx = df.columnIndex(column);
    if (idx < 0) {
      return '—';
    }
    const values: number[] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const n = toNumber(df.rows[r][idx]);
      if (n !== null) {
        values.push(n);
      }
    }
    if (values.length === 0) {
      return '—';
    }
    let out: number;
    switch (agg) {
      case 'mean': {
        let s = 0;
        for (let i = 0; i < values.length; i++) {
          s += values[i];
        }
        out = s / values.length;
        break;
      }
      case 'count':
        out = values.length;
        break;
      case 'min': {
        let m = values[0];
        for (let i = 1; i < values.length; i++) {
          if (values[i] < m) {
            m = values[i];
          }
        }
        out = m;
        break;
      }
      case 'max': {
        let m = values[0];
        for (let i = 1; i < values.length; i++) {
          if (values[i] > m) {
            m = values[i];
          }
        }
        out = m;
        break;
      }
      case 'sum':
      default: {
        let s = 0;
        for (let i = 0; i < values.length; i++) {
          s += values[i];
        }
        out = s;
        break;
      }
    }
    return fmtShort(out);
  }

  private numericColumns(): string[] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    const out: string[] = [];
    for (let i = 0; i < df.columns.length; i++) {
      if (df.columns[i].dtype === 'number') {
        out.push(df.columns[i].name);
      }
    }
    return out;
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Text(t(this.workspaceState.language, 'nav.dashboard'))
          .fontSize(14)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
          .alignSelf(ItemAlign.Start)

        if (this.workspaceState.charts.length === 0) {
          Text(t(this.workspaceState.language, 'dashboard.empty'))
            .fontSize(12)
            .fontColor(Theme.colorMuted())
            .textAlign(TextAlign.Center)
            .alignSelf(ItemAlign.Start)
        } else {
          // KPI row: aggregate of the first numeric column
          if (this.numericColumns().length > 0) {
            Row({ space: 12 }) {
              this.kpiCard(t(this.workspaceState.language, 'chart.sum'), this.numericColumns()[0], 'sum')
              this.kpiCard(t(this.workspaceState.language, 'chart.mean'), this.numericColumns()[0], 'mean')
              this.kpiCard(t(this.workspaceState.language, 'chart.count'), this.numericColumns()[0], 'count')
            }
            .width('100%')
          }

          // Chart grid (2 per row)
          Grid() {
            ForEach(this.workspaceState.charts, (chart: ChartConfig) => {
              GridItem() {
                Column() {
                  Text(chart.name)
                    .fontSize(12)
                    .fontWeight(600)
                    .fontColor(Theme.colorForeground())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                    .padding({ left: 12, right: 12, top: 8, bottom: 8 })
                  ChartView({ chartId: chart.id })
                    .width('100%')
                    .layoutWeight(1)
                }
                .width('100%')
                .height('100%')
                .borderRadius(8)
                .border({ width: 1, color: Theme.colorBorder() })
                .backgroundColor(Theme.colorSurface())
              }
            }, (chart: ChartConfig) => chart.id)
          }
          .columnsTemplate('1fr 1fr')
          .rowsGap(12)
          .columnsGap(12)
          .width('100%')
          .height(600)
        }
      }
      .width('100%')
      .padding(12)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorBackground())
    .scrollBar(BarState.Auto)
  }

  @Builder
  kpiCard(label: string, column: string, agg: string) {
    Column() {
      Text(label)
        .fontSize(11)
        .fontColor(Theme.colorMuted())
      Text(this.kpiValue(column, agg))
        .fontSize(20)
        .fontWeight(600)
        .fontColor(Theme.primary)
        .margin({ top: 2 })
    }
    .layoutWeight(1)
    .height(80)
    .justifyContent(FlexAlign.Center)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
  }
}
