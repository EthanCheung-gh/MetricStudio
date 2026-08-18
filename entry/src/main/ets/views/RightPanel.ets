import { Theme } from '../common/Theme';
import { l10n } from '../common/Locale';
import { WorkspaceState } from '../model/WorkspaceState';
import { IconButton } from './IconButton';

/**
 * Right sidebar (web: src/components/layout/RightPanel.tsx). Header is 36px
 * tall; content is the PropertyEditor (placeholder until chart tasks land).
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
          .fontColor(Theme.muted)
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
      .backgroundColor(Theme.surface)
      .border({ width: { bottom: 1 }, color: Theme.borderColor })

      Scroll() {
        Column() {
          Text(l10n(this.workspaceState.language, '属性编辑器将在图表任务中实现', 'Property editor lands with the chart tasks'))
            .fontSize(12)
            .fontColor(Theme.muted)
            .textAlign(TextAlign.Center)
        }
        .width('100%')
        .padding(12)
        .borderRadius(6)
        .border({ width: 1, color: Theme.borderColor })
        .backgroundColor(Theme.surfaceElevated)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .padding(Theme.panelPadding)
      .backgroundColor(Theme.surface)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.surface)
  }

  sectionTitle(): string {
    return l10n(this.workspaceState.language, '图表', 'Chart');
  }
}
