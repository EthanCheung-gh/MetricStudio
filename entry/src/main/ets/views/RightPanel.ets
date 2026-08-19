import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { RightPanelSection, WorkspaceState } from '../model/WorkspaceState';
import { IconButton } from './IconButton';
import { TransformPanel } from './TransformPanel';
import { EncodingPanel } from './EncodingPanel';
import { ColumnStatsPanel } from './ColumnStats';

/**
 * Right sidebar (web: src/components/layout/RightPanel.tsx). Header 36px;
 * content switches: Properties section → EncodingPanel (charts), otherwise
 * the TransformPanel.
 */
@Component
export struct RightPanel {
  @Consume('workspaceState') workspaceState: WorkspaceState;

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
          icon: $r('sys.symbol.chevron_right'),
          iconSize: 16,
          action: () => {
            this.workspaceState.toggleRight();
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
          if (this.workspaceState.rightSection === RightPanelSection.Properties) {
            EncodingPanel()
          } else {
            ColumnStatsPanel()
            TransformPanel()
          }
        }
        .width('100%')
        .padding(Theme.panelPadding)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.TopStart)
      .padding(Theme.panelPadding)
      .backgroundColor(Theme.colorSurface())
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorSurface())
  }

  sectionTitle(): string {
    if (this.workspaceState.rightSection === RightPanelSection.Properties) {
      return t(this.workspaceState.language, 'layout.properties');
    }
    return t(this.workspaceState.language, 'transform.title');
  }
}
