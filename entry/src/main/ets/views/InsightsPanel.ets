import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { fmt } from '../common/Format';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { Insight, computeInsights, computeQualityReport, computeTrend, QualityReport } from '../engine/Insights';

/**
 * Insights & quality panel (web: src/components/data/InsightsPanel.tsx subset).
 * Local statistics: missing/duplicates/outliers + quality summary + trend.
 */
@Component
export struct InsightsPanel {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;

  private insights(): Insight[] {
    const df = this.dataState.activeDataFrame;
    return df !== null ? computeInsights(df) : [];
  }

  private report(): QualityReport {
    const df = this.dataState.activeDataFrame;
    return df !== null ? computeQualityReport(df) : new QualityReport();
  }

  private trendText(): string {
    const df = this.dataState.activeDataFrame;
    return df !== null ? computeTrend(df) : t(this.workspaceState.language, 'insights.noData');
  }

  build() {
    Column({ space: 8 }) {
      Text(t(this.workspaceState.language, 'insights.title'))
        .fontSize(12)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)

      if (this.dataState.activeDataFrame === null) {
        Text(t(this.workspaceState.language, 'insights.noData'))
          .fontSize(12)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)
      } else {
        // Quality summary
        Text(t(this.workspaceState.language, 'insights.quality'))
          .fontSize(11)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
          .alignSelf(ItemAlign.Start)
        Column({ space: 4 }) {
          this.summaryRow(t(this.workspaceState.language, 'insights.missingCells'),
            fmt(this.report().summary.missingCells))
          this.summaryRow(t(this.workspaceState.language, 'insights.duplicateRows'),
            fmt(this.report().summary.duplicateRows))
          this.summaryRow(t(this.workspaceState.language, 'status.rows') + ' × ' + t(this.workspaceState.language, 'status.cols'),
            `${fmt(this.report().summary.rows)} × ${fmt(this.report().summary.columns)}`)
        }
        .width('100%')
        .padding(10)
        .borderRadius(6)
        .border({ width: 1, color: Theme.colorBorder() })
        .backgroundColor(Theme.colorSurface())

        // Trend
        Text(this.trendText())
          .fontSize(11)
          .fontColor(Theme.colorForeground())
          .width('100%')
          .padding(10)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())

        // Insight list
        ForEach(this.insights(), (insight: Insight) => {
          Column() {
            Row({ space: 6 }) {
              Text(this.severityMark(insight.severity))
                .fontSize(10)
                .fontColor(this.severityColor(insight.severity))
                .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                .borderRadius(4)
                .backgroundColor(this.severityBg(insight.severity))
              Text(insight.title)
                .fontSize(11)
                .fontWeight(600)
                .fontColor(Theme.colorForeground())
            }
            .width('100%')
            Text(insight.detail)
              .fontSize(11)
              .fontColor(Theme.colorMuted())
              .width('100%')
              .margin({ top: 2 })
          }
          .width('100%')
          .padding(10)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())
          .alignItems(HorizontalAlign.Start)
        }, (insight: Insight) => insight.title + insight.detail)
      }
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurfaceElevated())
    .alignItems(HorizontalAlign.Start)
  }

  private severityMark(severity: string): string {
    return severity === 'warning' ? '警告' : '提示';
  }

  private severityColor(severity: string): string {
    return severity === 'warning' ? Theme.warning : Theme.primary;
  }

  private severityBg(severity: string): string {
    return Theme.primaryDim;
  }

  @Builder
  summaryRow(label: string, value: string) {
    Row() {
      Text(label)
        .fontSize(11)
        .fontColor(Theme.colorMuted())
      Blank()
      Text(value)
        .fontSize(11)
        .fontColor(Theme.colorForeground())
        .fontWeight(600)
    }
    .width('100%')
  }
}
