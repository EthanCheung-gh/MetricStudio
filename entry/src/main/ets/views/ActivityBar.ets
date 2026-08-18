import { Theme } from '../common/Theme';
import { PanelSection, RightPanelSection, WorkspaceState } from '../model/WorkspaceState';
import { IconButton } from './IconButton';

/**
 * Left activity bar (web: LeftPanelCollapsed). 40px wide, surface background,
 * 1px right border, 8px vertical padding, 32x32 icon buttons stacked.
 */
@Component
export struct LeftActivityBar {
  @Consume('workspaceState') workspaceState: WorkspaceState;

  build() {
    Column() {
      IconButton({
        icon: $r('sys.symbol.chevron_right'),
        iconSize: 16,
        action: () => {
          this.workspaceState.toggleLeft();
        }
      })
      IconButton({
        icon: $r('sys.symbol.list_bullet'),
        iconSize: 16,
        active: this.workspaceState.leftSection === PanelSection.Charts,
        action: () => {
          this.workspaceState.activateLeftSection(PanelSection.Charts);
        }
      })
      IconButton({
        icon: $r('sys.symbol.externaldrive'),
        iconSize: 16,
        active: this.workspaceState.leftSection === PanelSection.Datasets,
        action: () => {
          this.workspaceState.activateLeftSection(PanelSection.Datasets);
        }
      })
      IconButton({
        icon: $r('sys.symbol.upload'),
        iconSize: 16,
        action: () => {
        }
      })
    }
    .width(Theme.activityBarWidth)
    .height('100%')
    .padding({ top: 8, bottom: 8 })
    .alignItems(HorizontalAlign.Center)
    .backgroundColor(Theme.surface)
    .border({ width: { right: 1 }, color: Theme.borderColor })
  }
}

/**
 * Right activity bar (web: RightPanelCollapsed). 40px wide, 1px left border.
 */
@Component
export struct RightActivityBar {
  @Consume('workspaceState') workspaceState: WorkspaceState;

  build() {
    Column() {
      IconButton({
        icon: $r('sys.symbol.chevron_left'),
        iconSize: 16,
        action: () => {
          this.workspaceState.toggleRight();
        }
      })
      IconButton({
        icon: $r('sys.symbol.slider_horizontal_2'),
        iconSize: 16,
        action: () => {
        }
      })
      IconButton({
        icon: $r('sys.symbol.gearshape'),
        iconSize: 16,
        active: this.workspaceState.rightSection === RightPanelSection.Properties,
        action: () => {
          this.workspaceState.activateRightSection(RightPanelSection.Properties);
        }
      })
    }
    .width(Theme.activityBarWidth)
    .height('100%')
    .padding({ top: 8, bottom: 8 })
    .alignItems(HorizontalAlign.Center)
    .backgroundColor(Theme.surface)
    .border({ width: { left: 1 }, color: Theme.borderColor })
  }
}
