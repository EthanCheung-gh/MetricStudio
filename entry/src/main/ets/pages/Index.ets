import { Theme } from '../common/Theme';
import { Settings } from '../common/Settings';
import { Language, WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';
import { TitleBar } from '../views/TitleBar';
import { LeftActivityBar, RightActivityBar } from '../views/ActivityBar';
import { LeftPanel } from '../views/LeftPanel';
import { RightPanel } from '../views/RightPanel';
import { CenterArea } from '../views/CenterArea';
import { StatusBar } from '../views/StatusBar';
import { SettingsDialog } from '../views/SettingsDialog';
import { AICommandBar } from '../views/AICommandBar';
import { ChartConfigDialog } from '../views/ChartConfigDialog';

/**
 * App shell (web: src/components/layout/AppShell.tsx + WorkspaceLayout.tsx).
 * Full-screen column: 40px title bar, flexible workspace row, 24px status bar.
 * The AI command bar floats at the bottom (workspace keeps a 64px reserve).
 */
@Entry
@Component
struct Index {
  @Provide('workspaceState') workspaceState: WorkspaceState = new WorkspaceState();
  @Provide('dataState') dataState: DataState = new DataState();

  aboutToAppear(): void {
    Settings.load().then((lang: Language) => {
      this.workspaceState.language = lang;
    });
    Settings.applyTheme();
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Column() {
        TitleBar()

        Row() {
          LeftActivityBar()

          if (!this.workspaceState.leftCollapsed) {
            LeftPanel()
              .width('20%')
            this.resizeHandle()
          }

          CenterArea()
            .layoutWeight(1)

          if (!this.workspaceState.rightCollapsed) {
            this.resizeHandle()
            RightPanel()
              .width('25%')
          }

          RightActivityBar()
        }
        .width('100%')
        .layoutWeight(1)
        .padding({ bottom: Theme.bottomReserve })
        .alignItems(VerticalAlign.Top)

        StatusBar()

        if (this.workspaceState.settingsOpen) {
          SettingsDialog()
        }
      }
      .width('100%')
      .height('100%')
      .backgroundColor(Theme.background)

      if (this.dataState.hasData) {
        AICommandBar()
          .margin({ bottom: 32 })
      }

      if (this.workspaceState.chartConfigOpen) {
        ChartConfigDialog()
      }
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.background)
  }

  @Builder
  resizeHandle() {
    Column()
      .width(Theme.resizeHandleWidth)
      .height('100%')
      .backgroundColor(Theme.borderColor)
  }
}
