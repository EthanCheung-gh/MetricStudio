import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { Settings } from '../common/Settings';
import { fmt } from '../common/Format';
import { Language, WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';

/**
 * Bottom status bar (web: src/components/layout/StatusBar.tsx).
 * 24px tall (h-6), 1px top border, 12px padding, 12px muted text.
 */
@Component
export struct StatusBar {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;

  build() {
    Row() {
      Row({ space: 16 }) {
        Row({ space: 4 }) {
          SymbolGlyph($r('sys.symbol.waveform'))
            .fontSize(12)
            .fontColor([Theme.colorMuted()])
          Text(t(this.workspaceState.language, 'status.backendOffline'))
            .fontSize(12)
            .fontColor(Theme.danger)
        }
        .alignItems(VerticalAlign.Center)

        if (this.dataState.hasData) {
          Row({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.line_3_horizontal'))
              .fontSize(12)
              .fontColor([Theme.colorMuted()])
            Text(`${fmt(this.dataState.rowCount)} ${t(this.workspaceState.language, 'status.rows')} × ${fmt(this.dataState.colCount)} ${t(this.workspaceState.language, 'status.cols')}`)
              .fontSize(12)
              .fontColor(Theme.colorMuted())
          }
          .alignItems(VerticalAlign.Center)

          Row({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.bolt'))
              .fontSize(12)
              .fontColor([Theme.colorMuted()])
            Text(`${t(this.workspaceState.language, 'status.engine')}: ${this.dataState.hasData ? 'arkts' : 'pandas'}`)
              .fontSize(12)
              .fontColor(Theme.colorMuted())
          }
          .alignItems(VerticalAlign.Center)
        }
      }
      .alignItems(VerticalAlign.Center)
      .layoutWeight(1)

      Row({ space: 8 }) {
        Text(this.workspaceState.language === Language.Zh ? 'EN' : '中')
          .fontSize(10)
          .fontColor(Theme.colorMuted())
          .padding({ left: 6, right: 6, top: 2, bottom: 2 })
          .borderRadius(4)
          .border({ width: 1, color: Theme.colorBorder() })
          .onClick(() => {
            this.workspaceState.toggleLanguage();
            Settings.saveLanguage(this.workspaceState.language);
          })
        Text('MetricStudio v0.1.0')
          .fontSize(12)
          .fontColor(Theme.colorMuted())
      }
      .alignItems(VerticalAlign.Center)
    }
    .width('100%')
    .height(Theme.statusBarHeight)
    .padding({ left: 12, right: 12 })
    .backgroundColor(Theme.colorSurface())
    .border({ width: { top: 1 }, color: Theme.colorBorder() })
  }
}
