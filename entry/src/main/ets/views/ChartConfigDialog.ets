import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { WorkspaceState } from '../model/WorkspaceState';
import { chartTypeSpecs } from '../model/ChartConfig';
import { ChartTypeSelector } from './ChartTypeSelector';
import { EncodingPanel } from './EncodingPanel';

const PANEL_W = 680;
const PANEL_H = 560;

/**
 * Chart config dialog (web: src/components/chart/ChartConfigDialog.tsx).
 * Draggable floating panel (drag on the header) so it never blocks other
 * components; left chart-type column + right config column + Done footer.
 */
@Component
export struct ChartConfigDialog {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State posX: number = 0;
  @State posY: number = 0;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragBaseX: number = 0;
  private dragBaseY: number = 0;
  private dragging: boolean = false;
  @State containerW: number = 0;
  @State containerH: number = 0;
  private positioned: boolean = false;

  aboutToAppear(): void {
    // position initialized via onAreaChange of the full-screen Stack
  }

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

  private handleAreaChange(w: number, h: number): void {
    this.containerW = w;
    this.containerH = h;
    if (!this.positioned && w > 0) {
      this.positioned = true;
      this.posX = Math.max(0, Math.floor((w - PANEL_W) / 2));
      this.posY = Math.max(0, Math.floor((h - PANEL_H) / 2) - 20);
    }
  }

  private onHeaderTouch(event: TouchEvent): void {
    if (event.touches.length === 0) {
      return;
    }
    const winW = this.containerW;
    const winH = this.containerH;
    const t = event.touches[0];
    if (event.type === TouchType.Down) {
      this.dragging = true;
      this.dragStartX = t.windowX;
      this.dragStartY = t.windowY;
      this.dragBaseX = this.posX;
      this.dragBaseY = this.posY;
    } else if (event.type === TouchType.Move && this.dragging) {
      this.posX = Math.min(Math.max(-(680 - 120), this.dragBaseX + (t.windowX - this.dragStartX)), Math.max(120, winW - 120));
      this.posY = Math.min(Math.max(-(560 - 60), this.dragBaseY + (t.windowY - this.dragStartY)), Math.max(60, winH - 60));
    } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
      this.dragging = false;
    }
  }

  build() {
    Stack() {
      // Dim backdrop (tap to close)
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.workspaceState.setChartConfigOpen(false);
        })

      Column() {
        // Header (drag handle)
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
        .onTouch((event: TouchEvent) => {
          this.onHeaderTouch(event);
        })

        // Body: left type column + right config column
        Row() {
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
      .width(PANEL_W)
      .constraintSize({ maxWidth: '92%' })
      .height(PANEL_H)
      .borderRadius(12)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .shadow({ radius: 32, color: 'rgba(0,0,0,0.5)', offsetY: 8 })
      .position({ x: this.posX, y: this.posY })
    }
    .width('100%')
    .height('100%')
    .onAreaChange((oldV: Area, newV: Area) => {
      this.handleAreaChange(Number(newV.width), Number(newV.height));
    })
  }
}
