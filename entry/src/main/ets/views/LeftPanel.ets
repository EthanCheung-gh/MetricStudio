import { Theme } from '../common/Theme';
import { l10n } from '../common/Locale';
import { PanelSection, WorkspaceState } from '../model/WorkspaceState';
import { IconButton } from './IconButton';

/**
 * Left sidebar (web: src/components/layout/LeftPanel.tsx). Header is 36px tall,
 * content area is scrollable with 8px padding. Sections (Charts / Datasets /
 * Explorer) are placeholders until the data layer tasks land.
 */
@Component
export struct LeftPanel {
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
      .backgroundColor(Theme.surface)
      .border({ width: { bottom: 1 }, color: Theme.borderColor })

      Scroll() {
        Column() {
          if (this.workspaceState.leftSection === PanelSection.Charts) {
            this.chartsPlaceholder()
          } else if (this.workspaceState.leftSection === PanelSection.Datasets) {
            this.datasetsPlaceholder()
          } else {
            this.explorerPlaceholder()
            Column()
              .width('100%')
              .height(8)
            this.datasetsPlaceholder()
          }
        }
        .width('100%')
        .padding(Theme.panelPadding)
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .backgroundColor(Theme.surface)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.surface)
  }

  sectionTitle(): string {
    if (this.workspaceState.leftSection === PanelSection.Charts) {
      return l10n(this.workspaceState.language, '图表', 'Charts');
    }
    if (this.workspaceState.leftSection === PanelSection.Datasets) {
      return l10n(this.workspaceState.language, '数据集', 'Datasets');
    }
    return l10n(this.workspaceState.language, '探索器', 'Explorer');
  }

  @Builder
  chartsPlaceholder() {
    Column() {
      Text(l10n(this.workspaceState.language, '导入数据以获取图表推荐', 'Import data to get chart recommendations'))
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

  @Builder
  datasetsPlaceholder() {
    Column() {
      Row() {
        Text(l10n(this.workspaceState.language, '数据集', 'Datasets'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.muted)
      }
      .width('100%')
      .margin({ bottom: 8 })
      Text(l10n(this.workspaceState.language, '尚未导入数据集', 'No datasets yet'))
        .fontSize(12)
        .fontColor(Theme.muted)
        .alignSelf(ItemAlign.Start)
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.borderColor })
    .backgroundColor(Theme.surfaceElevated)
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  explorerPlaceholder() {
    Column() {
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.upload'))
          .fontSize(16)
          .fontColor([Theme.muted])
        Text(l10n(this.workspaceState.language, '导入数据', 'Import data'))
          .fontSize(12)
          .fontWeight(FontWeight.Medium)
          .fontColor(Theme.foreground)
      }
      .width('100%')
      .margin({ bottom: 4 })
      Text(l10n(this.workspaceState.language, 'CSV / Excel / SQL 数据导入将在后续任务中实现', 'CSV / Excel / SQL import lands in a later task'))
        .fontSize(11)
        .fontColor(Theme.muted)
        .alignSelf(ItemAlign.Start)
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.borderColor })
    .backgroundColor(Theme.surfaceElevated)
    .alignItems(HorizontalAlign.Start)
  }
}
