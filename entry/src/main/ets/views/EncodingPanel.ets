import { LengthMetrics } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { EncodingChannel, FieldType, YFieldConfig } from '../model/ChartConfig';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { ChartTypeSelector } from './ChartTypeSelector';

/**
 * Encoding panel (web: src/components/chart/EncodingPanel.tsx). Field picks for
 * X / Y(1) / Color plus aggregate; every change refreshes the chart canvas.
 */
@Component
export struct EncodingPanel {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;

  private columns(): string[] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    const out: string[] = [];
    for (let i = 0; i < df.columns.length; i++) {
      out.push(df.columns[i].name);
    }
    return out;
  }

  private fieldType(col: string): FieldType {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return 'nominal';
    }
    const idx = df.columnIndex(col);
    if (idx < 0) {
      return 'nominal';
    }
    const t = df.columns[idx].inferredType;
    if (t === 'quantitative') {
      return 'quantitative';
    }
    if (t === 'temporal') {
      return 'temporal';
    }
    return 'nominal';
  }

  private setX(col: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    c.encoding.x = new EncodingChannel(col, this.fieldType(col), null);
    this.workspaceState.refreshChart();
  }

  private setY(col: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    c.encoding.yFields = [new YFieldConfig(col, this.fieldType(col), 'sum', 'left', 'none')];
    this.workspaceState.refreshChart();
  }

  private setColor(col: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    if (col.length === 0) {
      c.encoding.color = null;
    } else {
      c.encoding.color = new EncodingChannel(col, this.fieldType(col), null);
    }
    this.workspaceState.refreshChart();
  }

  private setAgg(agg: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null || c.encoding.yFields.length === 0) {
      return;
    }
    c.encoding.yFields[0].aggregate = agg as 'sum' | 'mean' | 'count' | 'min' | 'max';
    this.workspaceState.refreshChart();
  }

  build() {
    Column({ space: 10 }) {
      // Chart type
      Text(t(this.workspaceState.language, 'chart.type'))
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
      ChartTypeSelector()

      // X axis
      Text(t(this.workspaceState.language, 'chart.xAxis'))
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
      this.fieldRow(this.currentX(), (col: string) => {
        this.setX(col);
      })

      // Y axis
      Text(t(this.workspaceState.language, 'chart.yAxis'))
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
      this.fieldRow(this.currentY(), (col: string) => {
        this.setY(col);
      })

      // Aggregate
      Text(t(this.workspaceState.language, 'chart.aggregate'))
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
      Row({ space: 4 }) {
        this.aggChip('sum', t(this.workspaceState.language, 'chart.sum'))
        this.aggChip('mean', t(this.workspaceState.language, 'chart.mean'))
        this.aggChip('count', t(this.workspaceState.language, 'chart.count'))
        this.aggChip('min', t(this.workspaceState.language, 'chart.min'))
        this.aggChip('max', t(this.workspaceState.language, 'chart.max'))
      }

      // Color
      Text(t(this.workspaceState.language, 'chart.color'))
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
      this.fieldRow(this.currentColor(), (col: string) => {
        this.setColor(col);
      })
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurfaceElevated())
    .alignItems(HorizontalAlign.Start)
  }

  private currentX(): string {
    const c = this.workspaceState.activeChart();
    return c !== null && c.encoding.x !== null ? c.encoding.x.field : '';
  }

  private currentY(): string {
    const c = this.workspaceState.activeChart();
    return c !== null && c.encoding.yFields.length > 0 ? c.encoding.yFields[0].field : '';
  }

  private currentColor(): string {
    const c = this.workspaceState.activeChart();
    return c !== null && c.encoding.color !== null ? c.encoding.color.field : '';
  }

  private currentAgg(): string {
    const c = this.workspaceState.activeChart();
    return c !== null && c.encoding.yFields.length > 0 && c.encoding.yFields[0].aggregate !== null
      ? (c.encoding.yFields[0].aggregate as string)
      : 'sum';
  }

  @Builder
  fieldRow(selected: string, onPick: (col: string) => void) {
    // Flex wrap (no nested Scroll) so every field chip is directly tappable.
    Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
      ForEach(this.columns(), (col: string) => {
        Text(col)
          .fontSize(11)
          .fontColor(selected === col ? Theme.primary : Theme.colorMuted())
          .padding({ left: 10, right: 10, top: 4, bottom: 4 })
          .borderRadius(10)
          .backgroundColor(selected === col ? Theme.primaryDim : Color.Transparent)
          .border({ width: 1, color: selected === col ? Theme.primary : Theme.colorBorder() })
          .onClick(() => {
            onPick(col);
          })
      }, (col: string) => col)
    }
    .width('100%')
  }

  @Builder
  aggChip(agg: string, label: string) {
    Text(label)
      .fontSize(11)
      .fontColor(this.currentAgg() === agg ? Theme.primary : Theme.colorMuted())
      .padding({ left: 10, right: 10, top: 4, bottom: 4 })
      .borderRadius(10)
      .backgroundColor(this.currentAgg() === agg ? Theme.primaryDim : Color.Transparent)
      .onClick(() => {
        this.setAgg(agg);
      })
  }
}
