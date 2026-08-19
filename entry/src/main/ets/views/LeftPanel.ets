import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { CenterTab, PanelSection, WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';
import { ChartConfig } from '../model/ChartConfig';
import { IconButton } from './IconButton';
import { DataExplorer } from './DataExplorer';
import { DatasetList } from './DatasetList';
import { InsightsPanel } from './InsightsPanel';
import { AskPanel } from './AskPanel';

/**
 * Left sidebar (web: src/components/layout/LeftPanel.tsx). Header 36px;
 * Explorer section shows DataExplorer + DatasetList, Datasets section shows
 * the dataset list, Charts section is a placeholder (chart tasks land later).
 */
@Component
export struct LeftPanel {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;

  build() {
    Column() {
      Row() {
        Text(this.sectionTitle())
          .fontSize(12)
          .fontWeight(600)
          .textCase(TextCase.UpperCase)
          .letterSpacing(0.6)
          .fontColor(Theme.colorMuted())
        Blank()
        IconButton({
          icon: $r('sys.symbol.chevron_left'),
          iconSize: 16,
          action: () => {
            this.workspaceState.toggleLeft();
          }
        })
      }
      .width('100%')
      .height(Theme.panelHeaderHeight)
      .padding({ left: 8, right: 8 })
      .backgroundColor(Theme.colorSurface())
      .border({ width: { bottom: 1 }, color: Theme.colorBorder() })

      Scroll() {
        Column({ space: 8 }) {
          if (this.workspaceState.leftSection === PanelSection.Charts) {
            this.chartsPlaceholder()
          } else if (this.workspaceState.leftSection === PanelSection.Datasets) {
            DatasetList()
              .width('100%')
          } else {
            DataExplorer()
              .width('100%')
            DatasetList()
              .width('100%')
            InsightsPanel()
              .width('100%')
            AskPanel()
              .width('100%')
          }
        }
        .width('100%')
        .padding(Theme.panelPadding)
        .alignItems(HorizontalAlign.Start)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.TopStart)
      .backgroundColor(Theme.colorSurface())
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorSurface())
  }

  sectionTitle(): string {
    if (this.workspaceState.leftSection === PanelSection.Charts) {
      return t(this.workspaceState.language, 'nav.charts');
    }
    if (this.workspaceState.leftSection === PanelSection.Datasets) {
      return t(this.workspaceState.language, 'nav.datasets');
    }
    return t(this.workspaceState.language, 'nav.explorer');
  }

  @Builder
  chartsPlaceholder() {
    Column({ space: 6 }) {
      if (this.workspaceState.charts.length === 0) {
        Text(t(this.workspaceState.language, 'layout.noCharts'))
          .fontSize(12)
          .fontColor(Theme.colorMuted())
          .textAlign(TextAlign.Center)
          .width('100%')
          .padding(12)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurfaceElevated())
      } else {
        ForEach(this.workspaceState.charts, (chart: ChartConfig) => {
          this.chartRow(chart)
        }, (chart: ChartConfig) => chart.id)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  chartRow(chart: ChartConfig) {
    Row({ space: 8 }) {
      SymbolGlyph($r('sys.symbol.list_bullet'))
        .fontSize(14)
        .fontColor([this.workspaceState.activeChartId === chart.id ? Theme.primary : Theme.colorMuted()])
      Text(chart.name)
        .fontSize(12)
        .fontColor(this.workspaceState.activeChartId === chart.id ? Theme.primary : Theme.colorForeground())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      SymbolGlyph($r('sys.symbol.doc_filled_on_doc'))
        .fontSize(14)
        .fontColor([Theme.colorMuted()])
        .padding(2)
        .onClick(() => {
          this.workspaceState.duplicateChart(chart.id);
          this.workspaceState.setActiveTab(CenterTab.Chart);
        })
      SymbolGlyph($r('sys.symbol.trash'))
        .fontSize(14)
        .fontColor([Theme.colorMuted()])
        .padding(2)
        .onClick(() => {
          this.workspaceState.removeChart(chart.id);
        })
    }
    .width('100%')
    .height(30)
    .padding({ left: 8, right: 4 })
    .borderRadius(6)
    .backgroundColor(this.workspaceState.activeChartId === chart.id ? Theme.primaryDim : Color.Transparent)
    .onClick(() => {
      this.workspaceState.setActiveChart(chart.id);
      this.workspaceState.setActiveTab(CenterTab.Chart);
    })
  }
}
