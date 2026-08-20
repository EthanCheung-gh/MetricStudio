import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { CenterTab, RightPanelSection, WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';
import { SampleData } from '../engine/SampleData';
import { parseCsvText } from '../engine/CsvParser';
import { DataView } from './DataView';
import { ChartView } from './ChartView';
import { DashboardView } from './DashboardView';

/**
 * Center work area (web: src/components/layout/CenterArea.tsx).
 * No data → sample-tour welcome wizard / empty state. With data → 36px tab bar
 * (Data / Dashboard / chart tabs) + active view.
 */
@Component
export struct CenterArea {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;

  build() {
    Column() {
      if (!this.dataState.hasData) {
        this.welcomeArea()
      } else {
        this.tabBar()
        Column() {
          if (this.workspaceState.activeTab === CenterTab.Data) {
            DataView()
          } else if (this.workspaceState.activeTab === CenterTab.Dashboard) {
            DashboardView()
          } else {
            ChartView()
          }
        }
        .width('100%')
        .layoutWeight(1)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorBackground())
  }

  loadSample(): void {
    const result = parseCsvText(SampleData.CSV_TEXT, SampleData.NAME);
    if (result.ok && result.dataFrame !== null) {
      this.dataState.importDataFrame(result.dataFrame);
      this.workspaceState.setActiveTab(CenterTab.Data);
    }
  }

  @Builder
  welcomeArea() {
    Column({ space: 12 }) {
      SymbolGlyph($r('sys.symbol.externaldrive'))
        .fontSize(48)
        .fontColor([Theme.colorForeground()])
        .opacity(0.2)
      Text(this.workspaceState.wizardDismissed
        ? t(this.workspaceState.language, 'layout.noDataset')
        : t(this.workspaceState.language, 'sample.welcome'))
        .fontSize(14)
        .fontWeight(600)
        .fontColor(Theme.colorForeground())
      Text(this.workspaceState.wizardDismissed
        ? t(this.workspaceState.language, 'layout.importHint')
        : t(this.workspaceState.language, 'sample.description'))
        .fontSize(12)
        .fontColor(Theme.colorMuted())
        .textAlign(TextAlign.Center)
        .constraintSize({ maxWidth: 512 })

      Row({ space: 8 }) {
        if (!this.workspaceState.wizardDismissed) {
          Button() {
            Row({ space: 6 }) {
              SymbolGlyph($r('sys.symbol.wand_and_stars'))
                .fontSize(16)
                .fontColor([Color.White])
              Text(t(this.workspaceState.language, 'sample.start'))
                .fontSize(13)
                .fontColor(Color.White)
            }
            .alignItems(VerticalAlign.Center)
          }
          .height(40)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.primary)
          .borderRadius(6)
          .onClick(() => {
            this.loadSample();
          })

          Button() {
            Text(t(this.workspaceState.language, 'sample.importOwn'))
              .fontSize(13)
              .fontColor(Theme.colorForeground())
          }
          .height(40)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onClick(() => {
            this.workspaceState.wizardDismissed = true;
            this.workspaceState.setActiveTab(CenterTab.Data);
          })

          Button() {
            Text(t(this.workspaceState.language, 'sample.skip'))
              .fontSize(13)
              .fontColor(Theme.colorForeground())
          }
          .height(40)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onClick(() => {
            this.workspaceState.wizardDismissed = true;
          })
        } else {
          Button() {
            Text(t(this.workspaceState.language, 'layout.importData'))
              .fontSize(13)
              .fontColor(Theme.colorForeground())
          }
          .height(40)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onClick(() => {
            this.loadSample();
          })
        }
      }

      if (!this.workspaceState.wizardDismissed) {
        Row({ space: 12 }) {
          this.stepCard('1', t(this.workspaceState.language, 'sample.stepData'))
          this.stepCard('2', t(this.workspaceState.language, 'sample.stepChart'))
          this.stepCard('3', t(this.workspaceState.language, 'sample.stepDashboard'))
        }
        .margin({ top: 8 })
        .width('100%')
        .justifyContent(FlexAlign.Center)
      }
    }
    .width('100%')
    .height('100%')
    .padding({ left: 24, right: 24 })
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  stepCard(num: string, label: string) {
    Column() {
      Text(num)
        .fontSize(12)
        .fontWeight(600)
        .fontColor(Theme.primary)
        .margin({ bottom: 4 })
      Text(label)
        .fontSize(12)
        .fontColor(Theme.colorForeground())
        .textAlign(TextAlign.Center)
    }
    .width(200)
    .padding(12)
    .borderRadius(6)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  tabBar() {
    Row() {
      Scroll() {
        Row({ space: 2 }) {
          this.tabItem($r('sys.symbol.externaldrive'),
            t(this.workspaceState.language, 'nav.data'),
            this.workspaceState.activeTab === CenterTab.Data,
            () => {
              this.workspaceState.setActiveTab(CenterTab.Data);
            })
          this.tabItem($r('sys.symbol.square_grid_2x2'),
            t(this.workspaceState.language, 'nav.dashboard'),
            this.workspaceState.activeTab === CenterTab.Dashboard,
            () => {
              this.workspaceState.setActiveTab(CenterTab.Dashboard);
            })

          // Chart tabs
          ForEach(this.workspaceState.charts, (chart: ChartConfigShim, idx: number) => {
            this.chartTab(chart, idx)
          }, (chart: ChartConfigShim, idx: number) => chart.id)

          // New chart
          if (this.dataState.hasData) {
            this.tabItem($r('sys.symbol.plus'),
              t(this.workspaceState.language, 'chart.newChart'),
              false,
              () => {
                const df = this.dataState.activeDataFrame;
                if (df !== null) {
                  this.workspaceState.createChart(df.name);
                }
                this.workspaceState.setActiveTab(CenterTab.Chart);
              })
          }
        }
        .alignItems(VerticalAlign.Center)
      }
      .layoutWeight(1)
      .height('100%')
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)

      // Configure active chart — pinned OUTSIDE the horizontal scroll so it is
      // always visible and clickable after creating a new chart.
      if (this.workspaceState.activeTab === CenterTab.Chart && this.workspaceState.hasCharts) {
        this.tabItem($r('sys.symbol.slider_horizontal_2'),
          t(this.workspaceState.language, 'chart.configure'),
          false,
          () => {
            this.workspaceState.setChartConfigOpen(true);
          })
      }
    }
    .width('100%')
    .height(Theme.tabBarHeight)
    .padding({ left: 8, right: 8 })
    .alignItems(VerticalAlign.Center)
    .backgroundColor(Theme.colorSurface())
    .border({ width: { bottom: 1 }, color: Theme.colorBorder() })
  }

  @Builder
  chartTab(chart: ChartConfigShim, idx: number) {
    Row({ space: 4 }) {
      Text(chart.name)
        .fontSize(12)
        .fontColor(this.workspaceState.activeChartId === chart.id ? Theme.primary : Theme.colorMuted())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
      Text('×')
        .fontSize(12)
        .fontColor(Theme.colorMuted())
        .padding({ left: 2, right: 2 })
        .onClick(() => {
          this.workspaceState.removeChart(chart.id);
        })
    }
    .height(26)
    .padding({ left: 10, right: 6 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(6)
    .backgroundColor(this.workspaceState.activeChartId === chart.id ? Theme.primaryDim : Color.Transparent)
    .onClick(() => {
      this.workspaceState.setActiveChart(chart.id);
      this.workspaceState.setActiveTab(CenterTab.Chart);
    })
  }

  @Builder
  tabItem(icon: Resource, label: string, active: boolean, onClick: () => void) {
    Row({ space: 4 }) {
      SymbolGlyph(icon)
        .fontSize(12)
        .fontColor([active ? Theme.primary : Theme.colorMuted()])
      Text(label)
        .fontSize(12)
        .fontColor(active ? Theme.primary : Theme.colorMuted())
    }
    .height(26)
    .padding({ left: 10, right: 10 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(6)
    .backgroundColor(active ? Theme.primaryDim : Color.Transparent)
    .onClick(() => {
      onClick();
    })
  }
}

/** Shim so ForEach chart tabs stay typed. */
interface ChartConfigShim {
  id: string;
  name: string;
}
