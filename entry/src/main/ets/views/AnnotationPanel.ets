import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { ChartAnnotation, ChartShape } from '../model/ChartConfig';
import { WorkspaceState } from '../model/WorkspaceState';

/** Reference-line color chips (web uses a native color input; we offer fixed colors). */
const SHAPE_COLORS: string[] = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#f5f5f5'];

/** Shim row for the shape list so @Builder params stay typed. */
interface ShapeRowShim {
  kind: string;
  value: number;
  color: string;
}

/**
 * Annotation & reference-line editor (web: PropertyEditor annotations section).
 * Text annotations render at the top of the plot (paper 0.5/1.02); reference
 * lines are dashed lines at a data value — value/color editable, deletable.
 */
@Component
export struct AnnotationPanel {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State panelTick: number = 0;
  @State shapeValue: string = '0';

  private addAnnotation(): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    c.layout.annotations.push(new ChartAnnotation(''));
    this.panelTick++;
    this.workspaceState.refreshChart();
  }

  private addShape(kind: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    const n = Number(this.shapeValue);
    const value = this.shapeValue.trim().length > 0 && !Number.isNaN(n) ? n : 0;
    c.layout.shapes.push(new ChartShape(kind, value, SHAPE_COLORS[0]));
    this.panelTick++;
    this.workspaceState.refreshChart();
  }

  private setAnnotationText(index: number, text: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null || index < 0 || index >= c.layout.annotations.length) {
      return;
    }
    c.layout.annotations[index].text = text;
    this.workspaceState.refreshChart();
  }

  private removeAnnotation(index: number): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    const next: ChartAnnotation[] = [];
    for (let i = 0; i < c.layout.annotations.length; i++) {
      if (i !== index) {
        next.push(c.layout.annotations[i]);
      }
    }
    c.layout.annotations = next;
    this.panelTick++;
    this.workspaceState.refreshChart();
  }

  private setShapeValue(index: number, text: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null || index < 0 || index >= c.layout.shapes.length) {
      return;
    }
    const n = Number(text);
    if (Number.isNaN(n)) {
      return;
    }
    c.layout.shapes[index].value = n;
    this.workspaceState.refreshChart();
  }

  private setShapeColor(index: number, color: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null || index < 0 || index >= c.layout.shapes.length) {
      return;
    }
    c.layout.shapes[index].color = color;
    this.panelTick++;
    this.workspaceState.refreshChart();
  }

  private removeShape(index: number): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    const next: ChartShape[] = [];
    for (let i = 0; i < c.layout.shapes.length; i++) {
      if (i !== index) {
        next.push(c.layout.shapes[i]);
      }
    }
    c.layout.shapes = next;
    this.panelTick++;
    this.workspaceState.refreshChart();
  }

  private shapeRows(): ShapeRowShim[] {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return [];
    }
    const out: ShapeRowShim[] = [];
    for (let i = 0; i < c.layout.shapes.length; i++) {
      out.push({
        kind: c.layout.shapes[i].kind,
        value: c.layout.shapes[i].value,
        color: c.layout.shapes[i].color,
      });
    }
    return out;
  }

  build() {
    Column({ space: 8 }) {
      Text(t(this.workspaceState.language, 'anno.title'))
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)

      // Add buttons
      Row({ space: 6 }) {
        Button() {
          Text(t(this.workspaceState.language, 'anno.addText'))
            .fontSize(11)
            .fontColor(Theme.colorForeground())
        }
        .type(ButtonType.Normal)
        .height(26)
        .padding({ left: 10, right: 10 })
        .backgroundColor(Theme.colorSurface())
        .borderRadius(10)
        .border({ width: 1, color: Theme.colorBorder() })
        .onClick(() => {
          this.addAnnotation();
        })
        Button() {
          Text(t(this.workspaceState.language, 'anno.addHLine'))
            .fontSize(11)
            .fontColor(Theme.colorForeground())
        }
        .type(ButtonType.Normal)
        .height(26)
        .padding({ left: 10, right: 10 })
        .backgroundColor(Theme.colorSurface())
        .borderRadius(10)
        .border({ width: 1, color: Theme.colorBorder() })
        .onClick(() => {
          this.addShape('hline');
        })
        Button() {
          Text(t(this.workspaceState.language, 'anno.addVLine'))
            .fontSize(11)
            .fontColor(Theme.colorForeground())
        }
        .type(ButtonType.Normal)
        .height(26)
        .padding({ left: 10, right: 10 })
        .backgroundColor(Theme.colorSurface())
        .borderRadius(10)
        .border({ width: 1, color: Theme.colorBorder() })
        .onClick(() => {
          this.addShape('vline');
        })
      }
      .width('100%')

      // Default value used for newly added reference lines
      Row({ space: 6 }) {
        Text(t(this.workspaceState.language, 'anno.lineValue'))
          .fontSize(11)
          .fontColor(Theme.colorMuted())
        TextInput({ text: this.shapeValue })
          .layoutWeight(1)
          .height(28)
          .fontSize(12)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onChange((v: string) => {
            this.shapeValue = v;
          })
      }
      .width('100%')

      // Annotation rows
      ForEach(this.activeAnnotations(), (ann: ChartAnnotation, idx: number) => {
        Row({ space: 6 }) {
          TextInput({ text: ann.text })
            .layoutWeight(1)
            .height(28)
            .fontSize(12)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onChange((v: string) => {
              this.setAnnotationText(idx, v);
            })
          SymbolGlyph($r('sys.symbol.trash'))
            .fontSize(13)
            .fontColor([Theme.colorMuted()])
            .padding(4)
            .onClick(() => {
              this.removeAnnotation(idx);
            })
        }
        .width('100%')
      }, (ann: ChartAnnotation, idx: number) => {
        return 'ann_' + idx.toString() + '_' + this.panelTick.toString();
      })

      // Reference-line rows
      ForEach(this.shapeRows(), (row: ShapeRowShim, idx: number) => {
        Row({ space: 6 }) {
          Text(row.kind === 'vline'
            ? t(this.workspaceState.language, 'anno.addVLine')
            : t(this.workspaceState.language, 'anno.addHLine'))
            .fontSize(10)
            .fontColor(Theme.colorMuted())
          TextInput({ text: String(row.value) })
            .width(64)
            .height(28)
            .fontSize(12)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .type(InputType.Number)
            .onChange((v: string) => {
              this.setShapeValue(idx, v);
            })
          Row({ space: 4 }) {
            ForEach(SHAPE_COLORS, (color: string) => {
              Text('')
                .width(14)
                .height(14)
                .borderRadius(7)
                .backgroundColor(color)
                .border({
                  width: 1.5,
                  color: row.color === color ? Theme.colorForeground() : Color.Transparent
                })
                .onClick(() => {
                  this.setShapeColor(idx, color);
                })
            }, (color: string) => color + '_' + row.color)
          }
          .layoutWeight(1)
          SymbolGlyph($r('sys.symbol.trash'))
            .fontSize(13)
            .fontColor([Theme.colorMuted()])
            .padding(4)
            .onClick(() => {
              this.removeShape(idx);
            })
        }
        .width('100%')
      }, (row: ShapeRowShim, idx: number) => {
        return 'shp_' + idx.toString() + '_' + row.kind + '_' + row.color + '_' + this.panelTick.toString();
      })

      if (this.activeAnnotations().length === 0 && this.shapeRows().length === 0) {
        Text(t(this.workspaceState.language, 'anno.hint'))
          .fontSize(11)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private activeAnnotations(): ChartAnnotation[] {
    const c = this.workspaceState.activeChart();
    return c !== null ? c.layout.annotations : [];
  }
}
