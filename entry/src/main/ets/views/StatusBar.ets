import { Theme } from '../common/Theme';
import { l10n } from '../common/Locale';
import { Language, WorkspaceState } from '../model/WorkspaceState';

/**
 * Bottom status bar (web: src/components/layout/StatusBar.tsx).
 * 24px tall (h-6), 1px top border, 12px padding, 12px muted text.
 */
@Component
export struct StatusBar {
  @Consume('workspaceState') workspaceState: WorkspaceState;

  build() {
    Row() {
      Row({ space: 16 }) {
        Row({ space: 4 }) {
          SymbolGlyph($r('sys.symbol.waveform'))
            .fontSize(12)
            .fontColor([Theme.muted])
          Text(l10n(this.workspaceState.language, '后端未连接', 'Backend offline'))
            .fontSize(12)
            .fontColor(Theme.danger)
        }
        .alignItems(VerticalAlign.Center)

        if (this.workspaceState.hasData) {
          Row({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.line_3_horizontal'))
              .fontSize(12)
              .fontColor([Theme.muted])
            Text(`${this.workspaceState.rowCount} ${l10n(this.workspaceState.language, '行', 'rows')} × ${this.workspaceState.colCount} ${l10n(this.workspaceState.language, '列', 'cols')}`)
              .fontSize(12)
              .fontColor(Theme.muted)
          }
          .alignItems(VerticalAlign.Center)

          Row({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.bolt'))
              .fontSize(12)
              .fontColor([Theme.muted])
            Text(`${l10n(this.workspaceState.language, '引擎', 'engine')}: ${this.workspaceState.engine}`)
              .fontSize(12)
              .fontColor(Theme.muted)
          }
          .alignItems(VerticalAlign.Center)
        }
      }
      .alignItems(VerticalAlign.Center)
      .layoutWeight(1)

      Row({ space: 8 }) {
        Text(this.workspaceState.language === Language.Zh ? 'EN' : '中')
          .fontSize(10)
          .fontColor(Theme.muted)
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .borderRadius(4)
          .border({ width: 1, color: Theme.borderColor })
          .onClick(() => {
            this.workspaceState.toggleLanguage();
          })
        Text('MetricStudio v0.1.0')
          .fontSize(12)
          .fontColor(Theme.muted)
      }
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height(Theme.statusBarHeight)
    .padding({ left: 12, right: 12 })
    .backgroundColor(Theme.surface)
    .border({ width: { top: 1 }, color: Theme.borderColor })
  }
}
