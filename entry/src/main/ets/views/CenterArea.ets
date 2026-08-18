import { Theme } from '../common/Theme';
import { l10n } from '../common/Locale';
import { CenterTab, WorkspaceState } from '../model/WorkspaceState';

/**
 * Center work area (web: src/components/layout/CenterArea.tsx).
 * Renders a 36px tab bar (Data / Dashboard / charts) and the active view.
 * With no dataset it shows the sample-tour welcome wizard / empty state.
 */
@Component
export struct CenterArea {
  @Consume('workspaceState') workspaceState: WorkspaceState;

  build() {
    Column() {
      if (!this.workspaceState.hasData) {
        this.welcomeArea()
      } else {
        this.tabBar()
        Column() {
          if (this.workspaceState.activeTab === CenterTab.Data) {
            this.dataPlaceholder()
          } else if (this.workspaceState.activeTab === CenterTab.Dashboard) {
            this.dashboardPlaceholder()
          } else {
            this.chartPlaceholder()
          }
        }
        .width('100%')
        .layoutWeight(1)
        .padding(Theme.panelPadding)
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.background)
  }

  @Builder
  welcomeArea() {
    Column({ space: 12 }) {
      SymbolGlyph($r('sys.symbol.externaldrive'))
        .fontSize(48)
        .fontColor([Theme.foreground])
        .opacity(0.2)
      Text(this.workspaceState.wizardDismissed
        ? l10n(this.workspaceState.language, '未加载数据集', 'No dataset loaded')
        : l10n(this.workspaceState.language, '欢迎使用 MetricStudio', 'Welcome to MetricStudio'))
        .fontSize(14)
        .fontWeight(600)
        .fontColor(Theme.foreground)
      Text(this.workspaceState.wizardDismissed
        ? l10n(this.workspaceState.language, '导入数据以开始分析', 'Import data to get started')
        : l10n(this.workspaceState.language, '导入数据、构建图表、创建交互式 Dashboard。', 'Import data, build charts and create interactive dashboards.'))
        .fontSize(12)
        .fontColor(Theme.muted)
        .textAlign(TextAlign.Center)
        .constraintSize({ maxWidth: 512 })

      Row({ space: 8 }) {
        if (!this.workspaceState.wizardDismissed) {
          Button() {
            Row({ space: 6 }) {
              SymbolGlyph($r('sys.symbol.wand_and_stars'))
                .fontSize(16)
                .fontColor([Color.White])
              Text(l10n(this.workspaceState.language, '开始示例', 'Start with sample data'))
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
            this.workspaceState.loadSampleData();
          })

          Button() {
            Text(l10n(this.workspaceState.language, '导入自己的数据', 'Import your own data'))
              .fontSize(13)
              .fontColor(Theme.foreground)
          }
          .height(40)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.surface)
          .borderRadius(6)
          .onClick(() => {
            this.workspaceState.loadSampleData();
          })

          Button() {
            Text(l10n(this.workspaceState.language, '跳过', 'Skip'))
              .fontSize(13)
              .fontColor(Theme.foreground)
          }
          .height(40)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.surface)
          .borderRadius(6)
          .onClick(() => {
            this.workspaceState.wizardDismissed = true;
          })
        } else {
          Button() {
            Text(l10n(this.workspaceState.language, '导入数据', 'Import data'))
              .fontSize(13)
              .fontColor(Theme.foreground)
          }
          .height(40)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.surface)
          .borderRadius(6)
          .onClick(() => {
            this.workspaceState.loadSampleData();
          })
        }
      }

      if (!this.workspaceState.wizardDismissed) {
        Row({ space: 12 }) {
          this.stepCard('1', l10n(this.workspaceState.language, '导入数据', 'Import data'))
          this.stepCard('2', l10n(this.workspaceState.language, '构建图表', 'Build charts'))
          this.stepCard('3', l10n(this.workspaceState.language, '创建 Dashboard', 'Create dashboards'))
        }
        .margin({ top: 8 })
        .width('100%')
        .justifyContent(FlexAlign.Center)
        .constraintSize({ maxWidth: 672 })
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
        .fontColor(Theme.foreground)
        .textAlign(TextAlign.Center)
    }
    .width(200)
    .padding(12)
    .borderRadius(6)
    .border({ width: 1, color: Theme.borderColor })
    .backgroundColor(Theme.surface)
    .alignItems(HorizontalAlign.Center)
  }

  @Builder
  tabBar() {
    Scroll() {
      Row({ space: 2 }) {
        this.tabItem($r('sys.symbol.externaldrive'),
          l10n(this.workspaceState.language, '数据', 'Data'),
          this.workspaceState.activeTab === CenterTab.Data,
          () => {
            this.workspaceState.setActiveTab(CenterTab.Data);
          })
        this.tabItem($r('sys.symbol.square_grid_2x2'),
          'Dashboard',
          this.workspaceState.activeTab === CenterTab.Dashboard,
          () => {
            this.workspaceState.setActiveTab(CenterTab.Dashboard);
          })
        this.tabItem($r('sys.symbol.plus'),
          l10n(this.workspaceState.language, '新建图表', 'New chart'),
          false,
          () => {
            this.workspaceState.setActiveTab(CenterTab.Chart);
          })
      }
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height(Theme.tabBarHeight)
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
    .padding({ left: 8, right: 8 })
    .backgroundColor(Theme.surface)
    .border({ width: { bottom: 1 }, color: Theme.borderColor })
  }

  @Builder
  tabItem(icon: Resource, label: string, active: boolean, onClick: () => void) {
    Row({ space: 4 }) {
      SymbolGlyph(icon)
        .fontSize(12)
        .fontColor([active ? Theme.primary : Theme.muted])
      Text(label)
        .fontSize(12)
        .fontColor(active ? Theme.primary : Theme.muted)
    }    .height(26)
    .padding({ left: 10, right: 10 })
    .alignItems(VerticalAlign.Center)
    .borderRadius(6)
    .backgroundColor(active ? Theme.primaryDim : Color.Transparent)
    .onClick(() => {
      onClick();
    })
  }

  @Builder
  dataPlaceholder() {
    Column({ space: 8 }) {
      Row() {
        Text(l10n(this.workspaceState.language, '数据表格', 'Data table'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.muted)
        Blank()
        Text(this.workspaceState.datasetName)
          .fontSize(12)
          .fontColor(Theme.muted)
      }
      .width('100%')

      Column() {
        Text(l10n(this.workspaceState.language,
          '表格视图将在后续任务中实现（列类型推断 / 分页 / 清洗）',
          'Table view lands in a later task (column typing / pagination / cleaning)'))
          .fontSize(12)
          .fontColor(Theme.muted)
          .textAlign(TextAlign.Center)
      }
      .width('100%')
      .layoutWeight(1)
      .justifyContent(FlexAlign.Center)
      .borderRadius(6)
      .border({ width: 1, color: Theme.borderColor })
      .backgroundColor(Theme.surface)
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  dashboardPlaceholder() {
    Column() {
      Text(l10n(this.workspaceState.language,
        'Dashboard 视图将在后续任务中实现（KPI 卡片 / 图表网格 / 全局筛选）',
        'Dashboard view lands in a later task (KPI cards / chart grid / global filters)'))
        .fontSize(12)
        .fontColor(Theme.muted)
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .borderRadius(6)
    .border({ width: 1, color: Theme.borderColor })
    .backgroundColor(Theme.surface)
  }

  @Builder
  chartPlaceholder() {
    Column() {
      Text(l10n(this.workspaceState.language,
        '图表画布将在后续任务中实现（编码映射 / 渲染）',
        'Chart canvas lands in a later task (encoding / rendering)'))
        .fontSize(12)
        .fontColor(Theme.muted)
        .textAlign(TextAlign.Center)
    }
    .width('100%')
    .height('100%')
    .justifyContent(FlexAlign.Center)
    .borderRadius(6)
    .border({ width: 1, color: Theme.borderColor })
    .backgroundColor(Theme.surface)
  }
}
