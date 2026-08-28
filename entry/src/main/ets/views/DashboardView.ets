import { LengthMetrics } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { fmtShort } from '../common/Format';
import { CellValue } from '../model/DataFrame';
import { ChartConfig } from '../model/ChartConfig';
import { DashboardItem, DashboardItemKind } from '../model/DashboardState';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { toNumber } from '../engine/Numeric';
import { ChartView } from './ChartView';

/** Column shim for the filter field chips. */
interface DashboardColumnShim {
  name: string;
}

/**
 * Dashboard view (web: src/components/dashboard/DashboardView.tsx subset).
 * Items-driven cards: chart cards (each renders its own WebView+Plotly),
 * configurable KPI cards and text cards (web dashboardStore). The global
 * category filter applies to chart cards AND KPI aggregations.
 */
@Component
export struct DashboardView {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @StorageLink('dashboardTick') @Watch('onDashboardTick') dashboardTick: number = 0;
  @State filterField: string = '';
  @State filterValue: string = '';
  @State addMode: string = ''; // '' | 'chart' | 'kpi' | 'text'
  @State kpiCol: string = '';
  @State kpiAgg: string = 'sum';
  @State textDraft: string = '';
  @State editingId: string = '';
  @State editText: string = '';

  onDashboardTick(): void {
  }

  // ---- data helpers ----

  /** Active rows after the dashboard category filter (also feeds chart cards). */
  private filteredRows(): CellValue[][] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    if (this.filterField.length === 0 || this.filterValue.length === 0) {
      return df.rows;
    }
    const idx = df.columnIndex(this.filterField);
    if (idx < 0) {
      return df.rows;
    }
    const out: CellValue[][] = [];
    for (let r = 0; r < df.rows.length; r++) {
      if (String(df.rows[r][idx]) === this.filterValue) {
        out.push(df.rows[r]);
      }
    }
    return out;
  }

  private uniqueValues(field: string): string[] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    const idx = df.columnIndex(field);
    if (idx < 0) {
      return [];
    }
    const seen = new Set<string>();
    for (let r = 0; r < df.rows.length; r++) {
      const v = df.rows[r][idx];
      if (v !== null && v !== undefined) {
        seen.add(String(v));
      }
    }
    const out: string[] = [];
    seen.forEach((v: string) => {
      out.push(v);
    });
    return out.slice(0, 20);
  }

  private numericColumns(): string[] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    const out: string[] = [];
    for (let i = 0; i < df.columns.length; i++) {
      if (df.columns[i].dtype === 'number') {
        out.push(df.columns[i].name);
      }
    }
    return out;
  }

  private kpiValue(column: string, agg: string): string {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return '—';
    }
    const idx = df.columnIndex(column);
    if (idx < 0) {
      return '—';
    }
    const rows = this.filteredRows();
    const values: number[] = [];
    for (let r = 0; r < rows.length; r++) {
      const n = toNumber(rows[r][idx]);
      if (n !== null) {
        values.push(n);
      }
    }
    if (values.length === 0) {
      return '—';
    }
    let out: number;
    switch (agg) {
      case 'mean': {
        let s = 0;
        for (let i = 0; i < values.length; i++) {
          s += values[i];
        }
        out = s / values.length;
        break;
      }
      case 'count':
        out = values.length;
        break;
      case 'min': {
        let m = values[0];
        for (let i = 1; i < values.length; i++) {
          if (values[i] < m) {
            m = values[i];
          }
        }
        out = m;
        break;
      }
      case 'max': {
        let m = values[0];
        for (let i = 1; i < values.length; i++) {
          if (values[i] > m) {
            m = values[i];
          }
        }
        out = m;
        break;
      }
      case 'sum':
      default: {
        let s = 0;
        for (let i = 0; i < values.length; i++) {
          s += values[i];
        }
        out = s;
        break;
      }
    }
    return fmtShort(out);
  }

  // ---- item helpers ----

  private kpiItems(): DashboardItem[] {
    const items = this.workspaceState.dashboard.items;
    const out: DashboardItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === DashboardItemKind.Kpi) {
        out.push(items[i]);
      }
    }
    return out;
  }

  private cardItems(): DashboardItem[] {
    const items = this.workspaceState.dashboard.items;
    const out: DashboardItem[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === DashboardItemKind.Chart || items[i].kind === DashboardItemKind.Text) {
        out.push(items[i]);
      }
    }
    return out;
  }

  private pendingCharts(): ChartConfig[] {
    const charts = this.workspaceState.charts;
    const out: ChartConfig[] = [];
    for (let i = 0; i < charts.length; i++) {
      if (!this.workspaceState.dashboard.hasChartItem(charts[i].id)) {
        out.push(charts[i]);
      }
    }
    return out;
  }

  private chartName(chartId: string): string {
    const c = this.workspaceState.findChart(chartId);
    return c !== null ? c.name : chartId;
  }

  private itemKey(item: DashboardItem): string {
    const editing = this.editingId === item.id ? '_edit' : '';
    return item.id + '_' + item.kind.toString() + '_' + item.label + '_' + item.text
      + '_' + item.column + item.agg + editing;
  }

  private gridHeight(): number {
    const rows = Math.max(1, Math.ceil(this.cardItems().length / 2));
    return rows * 240;
  }

  // ---- actions ----

  private confirmKpi(): void {
    if (this.kpiCol.length === 0) {
      return;
    }
    const label = this.kpiCol + ' · ' + this.aggLabel(this.kpiAgg);
    this.workspaceState.dashboard.addKpi(this.kpiCol, this.kpiAgg, label);
    this.addMode = '';
  }

  private confirmText(): void {
    if (this.textDraft.trim().length === 0) {
      return;
    }
    this.workspaceState.dashboard.addText(this.textDraft);
    this.textDraft = '';
    this.addMode = '';
  }

  private startEdit(item: DashboardItem): void {
    this.editingId = item.id;
    this.editText = item.text;
  }

  private saveEdit(): void {
    if (this.editingId.length > 0) {
      this.workspaceState.dashboard.updateText(this.editingId, this.editText);
    }
    this.editingId = '';
    this.editText = '';
  }

  private aggLabel(agg: string): string {
    return t(this.workspaceState.language, 'chart.' + (agg.length > 0 ? agg : 'sum'));
  }

  private aggOptions(): SelectOption[] {
    const order: string[] = ['sum', 'mean', 'count', 'min', 'max'];
    const opts: SelectOption[] = [];
    for (let i = 0; i < order.length; i++) {
      opts.push({ value: this.aggLabel(order[i]) });
    }
    return opts;
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

  private numericColOptions(): SelectOption[] {
    const cols = this.numericColumns();
    const opts: SelectOption[] = [];
    for (let i = 0; i < cols.length; i++) {
      opts.push({ value: cols[i] });
    }
    return opts;
  }

  private numericColIndex(col: string): number {
    const cols = this.numericColumns();
    for (let i = 0; i < cols.length; i++) {
      if (cols[i] === col) {
        return i;
      }
    }
    return 0;
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Text(t(this.workspaceState.language, 'nav.dashboard'))
          .fontSize(14)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
          .alignSelf(ItemAlign.Start)

        // Add bar (web: dashboard add card buttons)
        if (this.dataState.hasData) {
          Row({ space: 6 }) {
            this.modeChip('chart', t(this.workspaceState.language, 'dashboard.addChart'))
            this.modeChip('kpi', t(this.workspaceState.language, 'dashboard.addKpi'))
            this.modeChip('text', t(this.workspaceState.language, 'dashboard.addText'))
          }
          .width('100%')

          if (this.addMode === 'chart') {
            this.chartPicker()
          } else if (this.addMode === 'kpi') {
            this.kpiConfig()
          } else if (this.addMode === 'text') {
            this.textConfig()
          }
        }

        // Global filter bar (web: DashboardFilterBar, category subset)
        if (this.dataState.hasData) {
          Column({ space: 6 }) {
            Row() {
              Text(t(this.workspaceState.language, 'dashboard.filters'))
                .fontSize(11)
                .fontWeight(600)
                .fontColor(Theme.colorMuted())
              Blank()
              if (this.filterValue.length > 0) {
                Text('×')
                  .fontSize(12)
                  .fontColor(Theme.colorMuted())
                  .padding(4)
                  .onClick(() => {
                    this.filterField = '';
                    this.filterValue = '';
                    this.workspaceState.refreshChart();
                  })
              }
            }
            .width('100%')

            Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
              ForEach(this.dataState.activeDataFrame !== null ? this.dataState.activeDataFrame.columns : [], (col: DashboardColumnShim) => {
                Button() {
                  Text(col.name)
                    .fontSize(11)
                    .fontColor(this.filterField === col.name ? Theme.primary : Theme.colorMuted())
                }
                .type(ButtonType.Normal)
                .height(26)
                .padding({ left: 10, right: 10 })
                .backgroundColor(this.filterField === col.name ? Theme.primaryDim : Color.Transparent)
                .borderRadius(10)
                .border({ width: 1, color: this.filterField === col.name ? Theme.primary : Theme.colorBorder() })
                .onClick(() => {
                  this.filterField = this.filterField === col.name ? '' : col.name;
                  this.workspaceState.refreshChart();
                  this.filterValue = '';
                })
              }, (col: DashboardColumnShim) => col.name)
            }
            .width('100%')

            if (this.filterField.length > 0) {
              Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
                ForEach(this.uniqueValues(this.filterField), (val: string) => {
                  Button() {
                    Text(val)
                      .fontSize(11)
                      .fontColor(this.filterValue === val ? Theme.primary : Theme.colorMuted())
                  }
                  .type(ButtonType.Normal)
                  .height(26)
                  .padding({ left: 10, right: 10 })
                  .backgroundColor(this.filterValue === val ? Theme.primaryDim : Color.Transparent)
                  .borderRadius(10)
                  .border({ width: 1, color: this.filterValue === val ? Theme.primary : Theme.colorBorder() })
                  .onClick(() => {
                    this.filterValue = this.filterValue === val ? '' : val;
                    this.workspaceState.refreshChart();
                  })
                }, (val: string) => val)
              }
              .width('100%')
            }
          }
          .width('100%')
          .padding(10)
          .borderRadius(8)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())
          .alignItems(HorizontalAlign.Start)
        }

        // Cards
        if (this.workspaceState.dashboard.items.length === 0) {
          Text(t(this.workspaceState.language, 'dashboard.empty'))
            .fontSize(12)
            .fontColor(Theme.colorMuted())
            .textAlign(TextAlign.Center)
            .alignSelf(ItemAlign.Start)
        } else {
          if (this.kpiItems().length > 0) {
            Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(8), cross: LengthMetrics.vp(8) } }) {
              ForEach(this.kpiItems(), (item: DashboardItem) => {
                this.kpiCard(item)
              }, (item: DashboardItem) => this.itemKey(item))
            }
            .width('100%')
          }

          if (this.cardItems().length > 0) {
            Grid() {
              ForEach(this.cardItems(), (item: DashboardItem) => {
                GridItem() {
                  this.card(item)
                }
              }, (item: DashboardItem) => this.itemKey(item))
            }
            .columnsTemplate('1fr 1fr')
            .rowsGap(12)
            .columnsGap(12)
            .width('100%')
            .height(this.gridHeight())
          }
        }
      }
      .width('100%')
      .padding(12)
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorBackground())
    .scrollBar(BarState.Auto)
    .align(Alignment.TopStart)
  }

  @Builder
  modeChip(mode: string, label: string) {
    Button() {
      Text(label)
        .fontSize(11)
        .fontColor(this.addMode === mode ? Theme.primary : Theme.colorMuted())
    }
    .type(ButtonType.Normal)
    .height(26)
    .padding({ left: 10, right: 10 })
    .backgroundColor(this.addMode === mode ? Theme.primaryDim : Color.Transparent)
    .borderRadius(10)
    .border({ width: 1, color: this.addMode === mode ? Theme.primary : Theme.colorBorder() })
    .onClick(() => {
      this.addMode = this.addMode === mode ? '' : mode;
    })
  }

  @Builder
  chartPicker() {
    Column({ space: 6 }) {
      Text(t(this.workspaceState.language, 'dashboard.selectChart'))
        .fontSize(11)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
      if (this.pendingCharts().length === 0) {
        Text(t(this.workspaceState.language, 'dashboard.noChartsToAdd'))
          .fontSize(11)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)
      } else {
        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
          ForEach(this.pendingCharts(), (chart: ChartConfig) => {
            Button() {
              Text(chart.name)
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
              this.workspaceState.dashboard.addChart(chart.id);
            })
          }, (chart: ChartConfig) => chart.id)
        }
        .width('100%')
      }
    }
    .width('100%')
    .padding(10)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  kpiConfig() {
    Column({ space: 6 }) {
      Row({ space: 6 }) {
        Select(this.numericColOptions())
          .fontColor(Theme.colorForeground())
          .border({ width: 1, color: Theme.colorBorder() })
          .selected(this.numericColIndex(this.kpiCol))
          .value(this.kpiCol.length > 0 ? this.kpiCol : t(this.workspaceState.language, 'dashboard.kpiColumn'))
          .font({ size: 12 })
          .height(30)
          .layoutWeight(1)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            this.kpiCol = value;
          })
        Select(this.aggOptions())
          .fontColor(Theme.colorForeground())
          .border({ width: 1, color: Theme.colorBorder() })
          .selected(this.aggIndex(this.kpiAgg))
          .value(this.aggLabel(this.kpiAgg))
          .font({ size: 12 })
          .height(30)
          .width(90)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            const order: string[] = ['sum', 'mean', 'count', 'min', 'max'];
            this.kpiAgg = index >= 0 && index < order.length ? order[index] : 'sum';
          })
      }
      .width('100%')

      Button() {
        Text(t(this.workspaceState.language, 'dashboard.addConfirm'))
          .fontSize(12)
          .fontColor(Color.White)
      }
      .type(ButtonType.Normal)
      .width('100%')
      .height(30)
      .backgroundColor(Theme.primary)
      .borderRadius(6)
      .onClick(() => {
        this.confirmKpi();
      })
    }
    .width('100%')
    .padding(10)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  textConfig() {
    Column({ space: 6 }) {
      TextArea({ placeholder: t(this.workspaceState.language, 'dashboard.textPlaceholder'), text: this.textDraft })
        .width('100%')
        .height(80)
        .fontSize(12)
        .fontColor(Theme.colorForeground())
        .backgroundColor(Theme.colorBackground())
        .borderRadius(6)
        .onChange((v: string) => {
          this.textDraft = v;
        })
      Button() {
        Text(t(this.workspaceState.language, 'dashboard.addConfirm'))
          .fontSize(12)
          .fontColor(Color.White)
      }
      .type(ButtonType.Normal)
      .width('100%')
      .height(30)
      .backgroundColor(Theme.primary)
      .borderRadius(6)
      .onClick(() => {
        this.confirmText();
      })
    }
    .width('100%')
    .padding(10)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  cardHeader(title: string, itemId: string) {
    Row({ space: 4 }) {
      Text(title)
        .fontSize(12)
        .fontWeight(600)
        .fontColor(Theme.colorForeground())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      SymbolGlyph($r('sys.symbol.trash'))
        .fontSize(14)
        .fontColor([Theme.colorMuted()])
        .padding(4)
        .onClick(() => {
          this.workspaceState.dashboard.removeItem(itemId);
        })
    }
    .width('100%')
    .padding({ left: 12, right: 8, top: 8 })
  }

  @Builder
  kpiCard(item: DashboardItem) {
    Column() {
      Row() {
        Text(item.label)
          .fontSize(11)
          .fontColor(Theme.colorMuted())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        SymbolGlyph($r('sys.symbol.trash'))
          .fontSize(13)
          .fontColor([Theme.colorMuted()])
          .padding(2)
          .onClick(() => {
            this.workspaceState.dashboard.removeItem(item.id);
          })
      }
      .width('100%')
      Text(this.kpiValue(item.column, item.agg))
        .fontSize(20)
        .fontWeight(600)
        .fontColor(Theme.primary)
        .margin({ top: 2 })
    }
    .width('31%')
    .height(80)
    .padding(8)
    .justifyContent(FlexAlign.Center)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
  }

  @Builder
  card(item: DashboardItem) {
    Column() {
      if (item.kind === DashboardItemKind.Chart) {
        this.cardHeader(this.chartName(item.chartId), item.id)
        ChartView({ chartId: item.chartId, filterField: this.filterField, filterValue: this.filterValue })
          .width('100%')
          .layoutWeight(1)
      } else {
        this.cardHeader(t(this.workspaceState.language, 'dashboard.addText'), item.id)
        if (this.editingId === item.id) {
          TextArea({ text: this.editText })
            .width('100%')
            .layoutWeight(1)
            .fontSize(12)
            .fontColor(Theme.colorForeground())
            .backgroundColor(Theme.colorBackground())
            .borderRadius(6)
            .margin({ left: 8, right: 8, bottom: 4 })
            .onChange((v: string) => {
              this.editText = v;
            })
          Row({ space: 6 }) {
            Button() {
              Text(t(this.workspaceState.language, 'common.confirm'))
                .fontSize(11)
                .fontColor(Color.White)
            }
            .type(ButtonType.Normal)
            .layoutWeight(1)
            .height(26)
            .backgroundColor(Theme.primary)
            .borderRadius(6)
            .onClick(() => {
              this.saveEdit();
            })
            Button() {
              Text(t(this.workspaceState.language, 'layout.cancel'))
                .fontSize(11)
                .fontColor(Theme.colorForeground())
            }
            .type(ButtonType.Normal)
            .layoutWeight(1)
            .height(26)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onClick(() => {
              this.editingId = '';
              this.editText = '';
            })
          }
          .width('100%')
          .padding({ left: 8, right: 8, bottom: 8 })
        } else {
          Scroll() {
            Text(item.text.length > 0 ? item.text : t(this.workspaceState.language, 'dashboard.textEmpty'))
              .fontSize(12)
              .fontColor(item.text.length > 0 ? Theme.colorForeground() : Theme.colorMuted())
              .width('100%')
              .padding({ left: 12, right: 12, bottom: 8 })
          }
          .layoutWeight(1)
          .scrollBar(BarState.Off)
          .align(Alignment.TopStart)
          .onClick(() => {
            this.startEdit(item);
          })
        }
      }
    }
    .width('100%')
    .height('100%')
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
  }
}
