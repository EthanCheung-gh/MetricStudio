import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { AggregateType, EncodingChannel, FieldType, YFieldConfig, chartTypeSpecs } from '../model/ChartConfig';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';

/**
 * Encoding panel (web: src/components/chart/EncodingPanel.tsx). Registry-driven
 * channel config with native Select dropdowns (field / aggregate) and a Y-field
 * row list (field + aggregate + remove, add-Y button) — UI aligned to the web.
 */
@Component
export struct EncodingPanel {
  @Consume('workspaceState') @Watch('onChartTick') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @State selX: string = '';
  @State selY: string = '';
  @State selZ: string = '';
  @State selColor: string = '';
  @State selAgg: string = 'sum';
  @State yMetaTick: number = 0; // bump to refresh axis/normalize selects

  aboutToAppear(): void {
    this.syncFromChart();
  }

  onChartTick(): void {
    this.syncFromChart();
  }

  private syncFromChart(): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    this.selX = c.encoding.x !== null ? c.encoding.x.field : '';
    this.selY = c.encoding.yFields.length > 0 ? c.encoding.yFields[0].field : '';
    this.selZ = c.encoding.z !== null ? c.encoding.z.field : '';
    this.selColor = c.encoding.color !== null ? c.encoding.color.field : '';
    this.selAgg = c.encoding.yFields.length > 0 && c.encoding.yFields[0].aggregate !== null
      ? (c.encoding.yFields[0].aggregate as string)
      : 'sum';
  }

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
    const ft = df.columns[idx].inferredType;
    if (ft === 'quantitative') {
      return 'quantitative';
    }
    if (ft === 'temporal') {
      return 'temporal';
    }
    return 'nominal';
  }

  private setX(col: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    c.encoding.x = col.length > 0 ? new EncodingChannel(col, this.fieldType(col), null) : null;
    this.selX = col;
    this.workspaceState.refreshChart();
  }

  private setY(col: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    if (c.encoding.yFields.length === 0) {
      c.encoding.yFields = [new YFieldConfig(col, this.fieldType(col), 'sum', 'left', 'none')];
    } else {
      c.encoding.yFields[0] = new YFieldConfig(col, this.fieldType(col), 'sum', 'left', 'none');
    }
    this.selY = col;
    this.syncFromChart();
    this.workspaceState.refreshChart();
  }

  private setColor(col: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    if (col.length === 0) {
      c.encoding.color = null;
      this.selColor = '';
    } else {
      c.encoding.color = new EncodingChannel(col, this.fieldType(col), null);
      this.selColor = col;
    }
    this.workspaceState.refreshChart();
  }

  private setZ(col: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    if (col.length === 0) {
      c.encoding.z = null;
      this.selZ = '';
    } else {
      c.encoding.z = new EncodingChannel(col, this.fieldType(col), null);
      this.selZ = col;
    }
    this.workspaceState.refreshChart();
  }

  private setYRowAgg(agg: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null || c.encoding.yFields.length === 0) {
      return;
    }
    c.encoding.yFields[0].aggregate = agg as AggregateType;
    this.selAgg = agg;
    this.workspaceState.refreshChart();
  }

  private setYRowAxis(index: number, label: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null || index < 0 || index >= c.encoding.yFields.length) {
      return;
    }
    c.encoding.yFields[index].axis =
      label === t(this.workspaceState.language, 'chart.axis.right') ? 'right' : 'left';
    this.yMetaTick++;
    this.workspaceState.refreshChart();
  }

  private setYRowNormalize(index: number, label: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null || index < 0 || index >= c.encoding.yFields.length) {
      return;
    }
    let norm = 'none';
    if (label === t(this.workspaceState.language, 'chart.norm.perSeries')) {
      norm = 'perSeries';
    } else if (label === t(this.workspaceState.language, 'chart.norm.global')) {
      norm = 'global';
    }
    c.encoding.yFields[index].normalize = norm;
    this.yMetaTick++;
    this.workspaceState.refreshChart();
  }

  private axisOptions(): SelectOption[] {
    const labels: string[] = [t(this.workspaceState.language, 'chart.axis.left'),
      t(this.workspaceState.language, 'chart.axis.right')];
    const opts: SelectOption[] = [];
    for (let i = 0; i < labels.length; i++) {
      opts.push({ value: labels[i] });
    }
    return opts;
  }

  private normOptions(): SelectOption[] {
    const labels: string[] = [t(this.workspaceState.language, 'chart.norm.none'),
      t(this.workspaceState.language, 'chart.norm.perSeries'),
      t(this.workspaceState.language, 'chart.norm.global')];
    const opts: SelectOption[] = [];
    for (let i = 0; i < labels.length; i++) {
      opts.push({ value: labels[i] });
    }
    return opts;
  }

  private axisLabel(axis: string): string {
    return axis === 'right'
      ? t(this.workspaceState.language, 'chart.axis.right')
      : t(this.workspaceState.language, 'chart.axis.left');
  }

  private normLabel(norm: string): string {
    if (norm === 'perSeries') {
      return t(this.workspaceState.language, 'chart.norm.perSeries');
    }
    if (norm === 'global') {
      return t(this.workspaceState.language, 'chart.norm.global');
    }
    return t(this.workspaceState.language, 'chart.norm.none');
  }

  /** Axis/normalize controls only apply to multi-Y chart types (web chartTypeSpecs). */
  private isMultiY(): boolean {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return false;
    }
    const spec = chartTypeSpecs[c.encoding.chartType];
    return spec !== undefined && spec.yFields === 'multi';
  }

  private addY(): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    if (c.encoding.yFields.length === 0) {
      // First Y field: default to the first numeric column of the dataset.
      // A new chart starts with an empty yFields list and the add button is
      // the only entry point, so it must not no-op here.
      const df = this.dataState.activeDataFrame;
      if (df === null) {
        return;
      }
      let field = '';
      let type: FieldType = 'quantitative';
      for (let i = 0; i < df.columns.length; i++) {
        if (df.columns[i].dtype === 'number') {
          field = df.columns[i].name;
          break;
        }
      }
      if (field.length === 0) {
        if (df.columns.length === 0) {
          return;
        }
        field = df.columns[0].name;
        type = this.fieldType(field);
      }
      c.encoding.yFields.push(new YFieldConfig(field, type, 'sum', 'left', 'none'));
    } else {
      const last = c.encoding.yFields[c.encoding.yFields.length - 1];
      c.encoding.yFields.push(new YFieldConfig(last.field, last.type, 'sum', 'left', 'none'));
    }
    this.yMetaTick++;
    this.syncFromChart();
    this.workspaceState.refreshChart();
  }

  private removeY(index: number): void {
    const c = this.workspaceState.activeChart();
    if (c === null || c.encoding.yFields.length <= 1) {
      return;
    }
    c.encoding.yFields.splice(index, 1);
    this.yMetaTick++;
    this.syncFromChart();
    this.workspaceState.refreshChart();
  }

  private needsZ(): boolean {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return false;
    }
    const spec = chartTypeSpecs[c.encoding.chartType];
    return spec !== undefined && spec.channels.indexOf('z') >= 0;
  }

  private hasY(): boolean {
    const c = this.workspaceState.activeChart();
    return c !== null && c.encoding.yFields.length > 0;
  }

  build() {
    Column({ space: 12 }) {
      // X axis
      this.fieldSelect(t(this.workspaceState.language, 'chart.xAxis'), this.columns(), this.selX,
        (col: string) => {
          this.setX(col);
        })

      // Y axis: row list (field + aggregate + remove) + add button
      Text(t(this.workspaceState.language, 'chart.yAxis'))
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
      if (this.hasY()) {
        Column({ space: 6 }) {
          ForEach(this.yRows(), (row: YRowShim, idx: number) => {
            this.yRow(row, idx)
          }, (row: YRowShim, idx: number) => {
            return idx.toString() + '_' + row.field + row.agg + row.axis + row.normalize
              + '_' + this.yMetaTick.toString();
          })
        }
        .width('100%')
      }
      Button() {
        Row({ space: 4 }) {
          SymbolGlyph($r('sys.symbol.plus'))
            .fontSize(12)
            .fontColor([Theme.colorMuted()])
          Text('添加 Y 字段')
            .fontSize(11)
            .fontColor(Theme.colorMuted())
        }
      }
      .type(ButtonType.Normal)
      .height(26)
      .padding({ left: 10, right: 10 })
      .backgroundColor(Color.Transparent)
      .borderRadius(10)
      .border({ width: 1, color: Theme.colorBorder() })
      .onClick(() => {
        this.addY();
      })

      // Color
      this.fieldSelect(t(this.workspaceState.language, 'chart.color'), this.columns(), this.selColor,
        (col: string) => {
          this.setColor(col);
        })

      // Z / value channel (heatmap & contour families)
      if (this.needsZ()) {
        this.fieldSelect('Z / Value', this.columns(), this.selZ, (col: string) => {
          this.setZ(col);
        })
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private yRows(): YRowShim[] {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return [];
    }
    const out: YRowShim[] = [];
    for (let i = 0; i < c.encoding.yFields.length; i++) {
      const y = c.encoding.yFields[i];
      out.push({
        field: y.field,
        agg: y.aggregate !== null ? (y.aggregate as string) : 'sum',
        axis: y.axis,
        normalize: y.normalize,
      });
    }
    return out;
  }

  @Builder
  yRow(row: YRowShim, idx: number) {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        // Field select
        Select(this.columnOptions())
          .selected(this.columnIndex(row.field))
          .value(row.field)
          .font({ size: 12 })
          .height(28)
          .layoutWeight(1)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            const c = this.workspaceState.activeChart();
            if (c !== null && idx < c.encoding.yFields.length) {
              c.encoding.yFields[idx].field = value;
              c.encoding.yFields[idx].type = this.fieldType(value);
              this.syncFromChart();
              this.workspaceState.refreshChart();
            }
          })

        // Aggregate select
        Select(this.aggOptions())
          .selected(this.aggIndex(row.agg))
          .value(this.aggLabel(row.agg))
          .font({ size: 12 })
          .height(28)
          .width(90)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            const c = this.workspaceState.activeChart();
            if (c !== null && idx < c.encoding.yFields.length) {
              c.encoding.yFields[idx].aggregate = this.aggFromLabel(value);
              this.syncFromChart();
              this.workspaceState.refreshChart();
            }
          })

        SymbolGlyph($r('sys.symbol.xmark'))
          .fontSize(14)
          .fontColor([Theme.colorMuted()])
          .padding(4)
          .onClick(() => {
            this.removeY(idx);
          })
      }
      .width('100%')

      // Axis + normalize row (multi-Y chart types only, web EncodingPanel)
      if (this.isMultiY()) {
        Row({ space: 6 }) {
          Select(this.axisOptions())
            .selected(row.axis === 'right' ? 1 : 0)
            .value(this.axisLabel(row.axis))
            .font({ size: 12 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.setYRowAxis(idx, value);
            })
          Select(this.normOptions())
            .selected(this.normIndex(row.normalize))
            .value(this.normLabel(row.normalize))
            .font({ size: 12 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.setYRowNormalize(idx, value);
            })
        }
        .width('100%')
      }
    }
    .width('100%')
    .padding(6)
    .borderRadius(6)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
  }

  private normIndex(norm: string): number {
    if (norm === 'perSeries') {
      return 1;
    }
    if (norm === 'global') {
      return 2;
    }
    return 0;
  }

  @Builder
  fieldSelect(label: string, cols: string[], selected: string, onPick: (col: string) => void) {
    Column({ space: 4 }) {
      Text(label)
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
      Select(this.columnOptions())
        .selected(this.columnIndex(selected))
        .value(selected.length > 0 ? selected : '请选择字段')
        .font({ size: 12 })
        .width('100%')
        .height(30)
        .backgroundColor(Theme.colorSurface())
        .borderRadius(6)
        .onSelect((index: number, value: string) => {
          onPick(value);
        })
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private columnOptions(): SelectOption[] {
    const cols = this.columns();
    const opts: SelectOption[] = [];
    for (let i = 0; i < cols.length; i++) {
      opts.push({ value: cols[i] });
    }
    return opts;
  }

  private columnIndex(field: string): number {
    const cols = this.columns();
    for (let i = 0; i < cols.length; i++) {
      if (cols[i] === field) {
        return i;
      }
    }
    return 0;
  }

  private aggOptions(): SelectOption[] {
    const labels: string[] = [t(this.workspaceState.language, 'chart.sum'),
      t(this.workspaceState.language, 'chart.mean'),
      t(this.workspaceState.language, 'chart.count'),
      t(this.workspaceState.language, 'chart.min'),
      t(this.workspaceState.language, 'chart.max')];
    const opts: SelectOption[] = [];
    for (let i = 0; i < labels.length; i++) {
      opts.push({ value: labels[i] });
    }
    return opts;
  }

  private aggLabel(agg: string): string {
    return t(this.workspaceState.language, 'chart.' + (agg.length > 0 ? agg : 'sum'));
  }

  private aggIndex(agg: string): number {
    const order: string[] = ['sum', 'mean', 'count', 'min', 'max'];
    for (let i = 0; i < order.length; i++) {
      if (order[i] === agg) {
        return i;
      }
    }
    return 0;
  }

  private aggFromLabel(label: string): AggregateType {
    if (label === t(this.workspaceState.language, 'chart.mean')) {
      return 'mean';
    }
    if (label === t(this.workspaceState.language, 'chart.count')) {
      return 'count';
    }
    if (label === t(this.workspaceState.language, 'chart.min')) {
      return 'min';
    }
    if (label === t(this.workspaceState.language, 'chart.max')) {
      return 'max';
    }
    return 'sum';
  }
}

/** Row shape for the multi-Y list. */
interface YRowShim {
  field: string;
  agg: string;
  axis: string;
  normalize: string;
}
