import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { Settings } from '../common/Settings';
import { t } from '../common/Locale';
import { Language, WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';
import { QaState } from '../model/QaState';
import { TitleBar } from '../views/TitleBar';
import { LeftActivityBar, RightActivityBar } from '../views/ActivityBar';
import { LeftPanel } from '../views/LeftPanel';
import { RightPanel } from '../views/RightPanel';
import { CenterArea } from '../views/CenterArea';
import { StatusBar } from '../views/StatusBar';
import { SettingsDialog } from '../views/SettingsDialog';
import { AICommandBar } from '../views/AICommandBar';
import { ChartConfigDialog } from '../views/ChartConfigDialog';
import { CommandPalette } from '../views/CommandPalette';
import { ReportDialog } from '../views/ReportDialog';
import { SqlWorkbench } from '../views/SqlWorkbench';

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
  @Provide('qaState') qaState: QaState = new QaState();

  aboutToAppear(): void {
    Settings.load().then((lang: Language) => {
      this.workspaceState.language = lang;
    });
    Settings.applyTheme();
  }

  /** Global shortcut: Ctrl+K (web commandPalette). */
  private togglePalette(): void {
    this.workspaceState.setPaletteOpen(!this.workspaceState.paletteOpen);
  }

  /** Global shortcut: Ctrl+Z (web globalUndo). */
  private undoLast(): void {
    if (!this.dataState.undo()) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'transform.nothingToUndo') });
    }
  }

  /** Global shortcut: Ctrl+S (web saveProject). */
  private saveProjectNow(): void {
    Settings.saveProject(this.workspaceState.exportJson());
    promptAction.showToast({ message: 'Project saved' });
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

      if (this.workspaceState.paletteOpen) {
        CommandPalette()
      }

      if (this.workspaceState.reportOpen) {
        ReportDialog()
      }

      if (this.workspaceState.sqlOpen) {
        SqlWorkbench()
      }

      // Keyboard shortcut sinks (web App.tsx global shortcuts): Ctrl+K/Z/S.
      Column()
        .width(1)
        .height(1)
        .opacity(0)
        .hitTestBehavior(HitTestMode.None)
        .keyboardShortcut('K', [ModifierKey.CTRL], () => {
          this.togglePalette();
        })
      Column()
        .width(1)
        .height(1)
        .opacity(0)
        .hitTestBehavior(HitTestMode.None)
        .keyboardShortcut('Z', [ModifierKey.CTRL], () => {
          this.undoLast();
        })
      Column()
        .width(1)
        .height(1)
        .opacity(0)
        .hitTestBehavior(HitTestMode.None)
        .keyboardShortcut('S', [ModifierKey.CTRL], () => {
          this.saveProjectNow();
        })
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
