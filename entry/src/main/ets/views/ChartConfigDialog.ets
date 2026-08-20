import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { WorkspaceState } from '../model/WorkspaceState';
import { chartTypeSpecs } from '../model/ChartConfig';
import { ChartTypeSelector } from './ChartTypeSelector';
import { EncodingPanel } from './EncodingPanel';

/**
 * Chart config dialog (web: src/components/chart/ChartConfigDialog.tsx).
 * Floating panel (680px) with a drag-style header, left chart-type column
 * (vertical buttons, independent scroll), right config column (selected type
 * summary card + encoding panel) and a Done footer.
 */
@Component
export struct ChartConfigDialog {
  @Consume('workspaceState') workspaceState: WorkspaceState;

  private typeName(): string {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return '';
    }
    const spec = chartTypeSpecs[c.encoding.chartType];
    return spec !== undefined ? spec.label : c.encoding.chartType;
  }

  private typeDesc(): string {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return '';
    }
    return t(this.workspaceState.language, 'chart.desc.' + c.encoding.chartType);
  }

  private chartName(): string {
    const c = this.workspaceState.activeChart();
    return c !== null ? c.name : '';
  }

  build() {
    Stack({ alignContent: Alignment.Center }) {
      // Dim backdrop (tap to close)
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.workspaceState.setChartConfigOpen(false);
        })

      Column() {
        // Header (drag handle look)
        Row() {
          Row({ space: 8 }) {
            SymbolGlyph($r('sys.symbol.line_3_horizontal'))
              .fontSize(14)
              .fontColor([Theme.colorMuted()])
            Text(t(this.workspaceState.language, 'chart.configTitle'))
              .fontSize(14)
              .fontWeight(600)
              .fontColor(Theme.colorForeground())
            Text('— ' + this.chartName())
              .fontSize(14)
              .fontColor(Theme.colorMuted())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }
          .layoutWeight(1)
          Text('×')
            .fontSize(16)
            .fontColor(Theme.colorMuted())
            .padding(4)
            .onClick(() => {
              this.workspaceState.setChartConfigOpen(false);
            })
        }
        .width('100%')
        .height(44)
        .padding({ left: 16, right: 12 })
        .border({ width: { bottom: 1 }, color: Theme.colorBorder() })

        // Body: left type column + right config column
        Row() {
          // Left: chart type list (144px, independent scroll)
          Column() {
            ChartTypeSelector()
          }
          .width(144)
          .height('100%')
          .padding({ top: 12, right: 6, bottom: 12, left: 12 })
          .alignItems(HorizontalAlign.Start)

          Column({ space: 12 }) {
            // Selected type summary card (0.2.2)
            Column() {
              Text(this.typeName())
                .fontSize(12)
                .fontWeight(600)
                .fontColor(Theme.colorForeground())
                .alignSelf(ItemAlign.Start)
              Text(this.typeDesc())
                .fontSize(11)
                .fontColor(Theme.colorMuted())
                .lineHeight(17)
                .width('100%')
                .margin({ top: 4 })
            }
            .width('100%')
            .padding(12)
            .borderRadius(6)
            .border({ width: 1, color: Theme.colorBorder() })
            .backgroundColor(Theme.colorSurface())
            .alignItems(HorizontalAlign.Start)

            // Encoding config (registry-driven channel controls)
            Scroll() {
              Column() {
                EncodingPanel()
                  .width('100%')
              }
              .width('100%')
              .padding({ right: 2 })
            }
            .layoutWeight(1)
            .scrollBar(BarState.Auto)
            .align(Alignment.TopStart)
          }
          .layoutWeight(1)
          .height('100%')
          .padding({ top: 12, bottom: 12, left: 6, right: 16 })
          .alignItems(HorizontalAlign.Start)
        }
        .width('100%')
        .layoutWeight(1)
        .alignItems(VerticalAlign.Top)

        // Footer
        Row() {
          Blank()
          Button() {
            Text(t(this.workspaceState.language, 'chart.done'))
              .fontSize(13)
              .fontColor(Color.White)
          }
          .height(30)
          .padding({ left: 20, right: 20 })
          .backgroundColor(Theme.primary)
          .borderRadius(6)
          .onClick(() => {
            this.workspaceState.setChartConfigOpen(false);
          })
        }
        .width('100%')
        .height(48)
        .padding({ left: 16, right: 16 })
        .border({ width: { top: 1 }, color: Theme.colorBorder() })
      }
      .width(680)
      .constraintSize({ maxWidth: '92%' })
      .height(560)
      .borderRadius(12)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .shadow({ radius: 32, color: 'rgba(0,0,0,0.5)', offsetY: 8 })
    }
    .width('100%')
    .height('100%')
  }
}
