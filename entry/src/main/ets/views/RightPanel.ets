import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { WorkspaceState } from '../model/WorkspaceState';
import { IconButton } from './IconButton';
import { EncodingPanel } from './EncodingPanel';

/**
 * Right sidebar (web: src/components/layout/RightPanel.tsx). Web keeps the
 * chart PropertyEditor here; HarmonyOS shows the encoding config. The data
 * rail (insights/transforms/column stats) lives inside the DataView per web.
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
          EncodingPanel()
            .width('100%')
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
    return t(this.workspaceState.language, 'layout.properties');
  }
}
