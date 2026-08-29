import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { Settings } from '../common/Settings';
import { WorkspaceState } from '../model/WorkspaceState';
import { chartTypeSpecs } from '../model/ChartConfig';
import { ChartTypeSelector } from './ChartTypeSelector';
import { EncodingPanel } from './EncodingPanel';
import { AnnotationPanel } from './AnnotationPanel';

const PANEL_W = 680;
const PANEL_H = 560;

/** Persisted chart template (web ~/.metricstudio/templates). */
interface ChartTemplateDoc {
  id: string;
  name: string;
  encoding: string; // ChartEncoding.toTemplateJson()
}

/**
 * Chart config dialog (web: src/components/chart/ChartConfigDialog.tsx).
 * Draggable floating panel (drag on the header) so it never blocks other
 * components; left chart-type column + right config column (type summary,
 * 模板 templates, encoding, annotations) + Done footer.
 */
@Component
export struct ChartConfigDialog {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State posX: number = 0;
  @State posY: number = 0;
  @State templates: ChartTemplateDoc[] = [];
  @State tplName: string = '';
  @State tplPickIdx: number = -1;
  @State tplTick: number = 0;
  private dragStartX: number = 0;
  private dragStartY: number = 0;
  private dragBaseX: number = 0;
  private dragBaseY: number = 0;
  private dragging: boolean = false;
  @State containerW: number = 0;
  @State containerH: number = 0;
  private positioned: boolean = false;

  aboutToAppear(): void {
    this.loadTemplates();
    // position initialized via onAreaChange of the full-screen Stack
  }

  private loadTemplates(): void {
    try {
      const raw = Settings.loadChartTemplates();
      if (raw.length > 0) {
        this.templates = JSON.parse(raw) as ChartTemplateDoc[];
        return;
      }
    } catch (e) {
      // fall through
    }
    this.templates = [];
  }

  private persistTemplates(): void {
    Settings.saveChartTemplates(JSON.stringify(this.templates));
  }

  private saveTemplate(): void {
    const chart = this.workspaceState.activeChart();
    if (chart === null) {
      return;
    }
    const name = this.tplName.trim().length > 0 ? this.tplName.trim()
      : l10n(this.workspaceState.language, '模板 ' + (this.templates.length + 1).toString(),
        'Template ' + (this.templates.length + 1).toString());
    this.templates.push({
      id: 'ctpl_' + Date.now().toString(),
      name: name,
      encoding: chart.encoding.toTemplateJson(),
    });
    this.persistTemplates();
    this.tplName = '';
    this.tplTick++;
    promptAction.showToast({ message: t(this.workspaceState.language, 'chart.tplSaved') });
  }

  private applyTemplateByIndex(index: number): void {
    const chart = this.workspaceState.activeChart();
    if (chart === null || index < 0 || index >= this.templates.length) {
      return;
    }
    if (chart.encoding.applyTemplateJson(this.templates[index].encoding)) {
      this.tplTick++;
      this.workspaceState.refreshChart();
      promptAction.showToast({ message: l10n(this.workspaceState.language,
        '模板已应用', 'Template applied') });
    }
  }

  private deleteTemplateByIndex(index: number): void {
    if (index < 0 || index >= this.templates.length) {
      return;
    }
    const next: ChartTemplateDoc[] = [];
    for (let i = 0; i < this.templates.length; i++) {
      if (i !== index) {
        next.push(this.templates[i]);
      }
    }
    this.templates = next;
    this.tplPickIdx = -1;
    this.persistTemplates();
  }

  private templateOptions(): SelectOption[] {
    const opts: SelectOption[] = [];
    for (let i = 0; i < this.templates.length; i++) {
      opts.push({ value: this.templates[i].name });
    }
    return opts;
  }

  private typeName(): string {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return '';
    }
    return t(this.workspaceState.language, 'chart.type.' + c.encoding.chartType);
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
            .opacity(this.tplTick >= 0 ? 1 : 1)

            // 模板（web ChartConfigDialog 模板区：应用/删除 + 保存当前）
            Column({ space: 8 }) {
              Text(t(this.workspaceState.language, 'chart.tplSection'))
                .fontSize(12)
                .fontWeight(600)
                .fontColor(Theme.colorForeground())
                .alignSelf(ItemAlign.Start)
              Text(t(this.workspaceState.language, 'chart.savedTemplates'))
                .fontSize(11)
                .fontColor(Theme.colorMuted())
                .alignSelf(ItemAlign.Start)
              Row({ space: 8 }) {
                Select(this.templateOptions())
                  .fontColor(Theme.colorForeground())
                  .border({ width: 1, color: Theme.colorBorder() })
                  .selected(this.tplPickIdx)
                  .value(this.tplPickIdx >= 0 && this.tplPickIdx < this.templates.length
                    ? this.templates[this.tplPickIdx].name : '')
                  .font({ size: 12 })
                  .height(32)
                  .layoutWeight(1)
                  .backgroundColor(Theme.colorSurface())
                  .borderRadius(6)
                  .onSelect((i: number, _v: string) => {
                    this.tplPickIdx = i;
                  })
                Button() {
                  Text(t(this.workspaceState.language, 'chart.tplApply'))
                    .fontSize(12)
                    .fontColor(Color.White)
                }
                .type(ButtonType.Normal)
                .height(32)
                .padding({ left: 14, right: 14 })
                .backgroundColor(this.tplPickIdx >= 0 ? Theme.primary : Theme.colorBorder())
                .borderRadius(6)
                .onClick(() => {
                  this.applyTemplateByIndex(this.tplPickIdx);
                })
                Text('🗑')
                  .fontSize(14)
                  .fontColor(Theme.danger)
                  .padding(6)
                  .onClick(() => {
                    this.deleteTemplateByIndex(this.tplPickIdx);
                  })
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)

              Row({ space: 8 }) {
                TextInput({ placeholder: t(this.workspaceState.language, 'chart.tplName'), text: this.tplName })
                  .height(32)
                  .padding({ top: 0, bottom: 0 })
                  .fontSize(12)
                  .fontColor(Theme.colorForeground())
                  .placeholderColor(Theme.colorMuted())
                  .placeholderFont({ size: 12 })
                  .layoutWeight(1)
                  .backgroundColor(Theme.colorSurface())
                  .borderRadius(6)
                  .onChange((v: string) => {
                    this.tplName = v;
                  })
                Button() {
                  Row({ space: 4 }) {
                    Text('💾').fontSize(11)
                    Text(t(this.workspaceState.language, 'chart.tplSaveCurrent'))
                      .fontSize(12)
                      .fontColor(Theme.primary)
                  }
                }
                .type(ButtonType.Normal)
                .height(32)
                .padding({ left: 12, right: 12 })
                .backgroundColor(Theme.primaryDim)
                .borderRadius(6)
                .onClick(() => {
                  this.saveTemplate();
                })
              }
              .width('100%')
              .alignItems(VerticalAlign.Center)
            }
            .width('100%')
            .padding(12)
            .borderRadius(6)
            .border({ width: 1, color: Theme.primary })
            .backgroundColor(Theme.colorSurface())
            .alignItems(HorizontalAlign.Start)

            Scroll() {
              Column({ space: 12 }) {
                EncodingPanel({ syncTick: this.tplTick })
                  .width('100%')
                AnnotationPanel()
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
