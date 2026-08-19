import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { Settings } from '../common/Settings';
import { PanelSection, WorkspaceState } from '../model/WorkspaceState';
import { IconButton } from './IconButton';

/**
 * Top title bar (web: src/components/layout/TitleBar.tsx).
 * Height 40 (h-10), 12px horizontal padding (px-3), surface background with
 * 1px bottom border. App logo + name on the left, action buttons on the right.
 */
@Component
export struct TitleBar {
  @Consume('workspaceState') workspaceState: WorkspaceState;

  build() {
    Row() {
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.externaldrive'))
          .fontSize(20)
          .fontColor([Theme.primary])
        Text('MetricStudio')
          .fontSize(14)
          .fontWeight(600)
          .fontColor(Theme.foreground)
      }
      .alignItems(VerticalAlign.Center)
      .layoutWeight(1)

      Row({ space: 4 }) {
        IconButton({
          icon: $r('sys.symbol.folder'),
          iconSize: 16,
          action: () => {
            // Open project: restore persisted charts/preferences
            const json = Settings.loadProject();
            if (json.length === 0) {
              promptAction.showToast({ message: 'No saved project' });
              return;
            }
            if (this.workspaceState.importJson(json)) {
              promptAction.showToast({ message: 'Project loaded' });
            } else {
              promptAction.showToast({ message: 'Load failed' });
            }
          }
        })
        IconButton({
          icon: $r('sys.symbol.save'),
          iconSize: 16,
          action: () => {
            // Save project: persist charts + preferences
            Settings.saveProject(this.workspaceState.exportJson());
            promptAction.showToast({ message: 'Project saved' });
          }
        })
        IconButton({
          icon: $r('sys.symbol.doc_plaintext'),
          iconSize: 16,
          action: () => {
            // Import: expand the left panel and show the explorer (import entries)
            this.workspaceState.openLeftSection(PanelSection.None);
          }
        })
        IconButton({
          icon: $r('sys.symbol.line_3_horizontal'),
          iconSize: 16,
          action: () => {
            this.workspaceState.setSettingsOpen(true);
          }
        })
      }
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height(Theme.titleBarHeight)
    .padding({ left: 12, right: 12 })
    .alignItems(VerticalAlign.Center)
    .backgroundColor(Theme.surface)
    .border({ width: { bottom: 1 }, color: Theme.borderColor })
  }
}
