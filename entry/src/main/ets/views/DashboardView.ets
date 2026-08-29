import { LengthMetrics, promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { CellValue, DataFrame } from '../model/DataFrame';
import { ChartConfig } from '../model/ChartConfig';
import { applyDashboardFilters, DASH_COLS, DASH_GAP, DASH_ROW_H,
  DashboardFilter, DashboardItem, DashboardItemKind, formatKpiValue } from '../model/DashboardState';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { toNumber } from '../engine/Numeric';
import { ChartView, BrushSelectionSpec } from './ChartView';

/** Wire format handed to chart cards (web DashboardDataFilter subset). */
interface DashFilterSpec {
  field: string;
  kind: string;
  values: string[];
  lo: string;
  hi: string;
}

/**
 * Dashboard view (web: DashboardView.tsx). 12-col absolute grid with drag /
 * resize (edit mode, lockable), align/space tools, undo/redo, a filter list
 * (category multi-select + range/date bounds) and KPI cards in web value
 * format. Chart cards render through ChartView with the filter set applied.
 */
@Component
export struct DashboardView {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @StorageLink('dashboardTick') @Watch('onDashboardTick') dashboardTick: number = 0;
  @State renderTick: number = 0;
  @State containerW: number = 0;
  // ArkUI V1 无法观察 @Consume 对象的深层变更（items.push 等），用 @State
  // 镜像驱动渲染：dashboardTick watcher 里整体快照。
  @State dashItems: DashboardItem[] = [];
  @State dashFilters: DashboardFilter[] = [];
  @State dashEditMode: boolean = true;
  @State addMode: string = ''; // '' | 'chart' | 'kpi' | 'text'
  @State kpiCol: string = '';
  @State kpiAgg: string = 'sum';
  @State textDraft: string = '';
  @State editingId: string = '';
  @State editText: string = '';
  @State newFilterField: string = '';
  // brush 联动（web brushSelections，会话级）：chartItemId → selection JSON
  @State brushVersion: number = 0;
  private brushes: Record<string, string> = {};
  // drag/resize transient state
  @State dragId: string = '';
  private dragStartX: number = 0;
  private dragStartY: number = 0;

  aboutToAppear(): void {
    this.syncFromDashboard();
  }

  /** Snapshot dashboard state into observable mirrors. */
  private syncFromDashboard(): void {
    this.dashItems = this.workspaceState.dashboard.items.slice();
    this.dashFilters = this.workspaceState.dashboard.filters.slice();
    this.dashEditMode = this.workspaceState.dashboard.editMode;
  }

  onDashboardTick(): void {
    this.syncFromDashboard();
    this.renderTick++;
  }

  private activeFilterCountOf(list: DashboardFilter[]): number {
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      if (f.kind === 'category' && f.values.length > 0) {
        n++;
      }
      if (f.kind !== 'category' && (f.lo.length > 0 || f.hi.length > 0)) {
        n++;
      }
    }
    return n;
  }

  private brushCount(): number {
    const keys = Object.keys(this.brushes);
    let n = 0;
    for (let i = 0; i < keys.length; i++) {
      if (this.brushes[keys[i]].length > 0) {
        n++;
      }
    }
    return n;
  }

  /** Other cards' selections for one chart card (web externalBrushes). */
  private externalBrushes(itemId: string): string {
    const out: object[] = [];
    const keys = Object.keys(this.brushes);
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] === itemId || this.brushes[keys[i]].length === 0) {
        continue;
      }
      try {
        out.push(JSON.parse(this.brushes[keys[i]]) as object);
      } catch (e) {
        // skip malformed entry
      }
    }
    return JSON.stringify(out);
  }

  private handleBrush(itemId: string, json: string): void {
    try {
      const sel = JSON.parse(json) as BrushSelectionSpec;
      if (sel.xRange === null && sel.yRange === null) {
        // ArkTS has no delete operator — store empty marker, skipped on read.
        this.brushes[itemId] = '';
      } else {
        this.brushes[itemId] = json;
      }
      this.brushVersion++;
    } catch (e) {
      // ignore malformed bridge payloads
    }
  }

  private colW(): number {
    if (this.containerW <= 0) {
      return 100;
    }
    return (this.containerW - (DASH_COLS - 1) * DASH_GAP) / DASH_COLS;
  }

  private gridW(cols: number): number {
    return cols * this.colW() + (cols - 1) * DASH_GAP;
  }

  private gridH(rows: number): number {
    return rows * DASH_ROW_H + (rows - 1) * DASH_GAP;
  }

  // ---- data helpers ----

  private filteredFrame(): DataFrame | null {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return null;
    }
    return applyDashboardFilters(df, this.dashFilters);
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
    return out.slice(0, 50);
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

  /** KPI aggregate over the filtered rows (web /aggregate semantics). */
  private kpiAggregate(column: string, agg: string): number | null {
    const df = this.filteredFrame();
    if (df === null) {
      return null;
    }
    const idx = df.columnIndex(column);
    if (idx < 0) {
      return null;
    }
    const values: number[] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const n = toNumber(df.rows[r][idx]);
      if (n !== null) {
        values.push(n);
      }
    }
    if (agg === 'count') {
      return values.length > 0 ? values.length : null;
    }
    if (values.length === 0) {
      return null;
    }
    if (agg === 'mean') {
      let s = 0;
      for (let i = 0; i < values.length; i++) {
        s += values[i];
      }
      return s / values.length;
    }
    if (agg === 'min') {
      let m = values[0];
      for (let i = 1; i < values.length; i++) {
        if (values[i] < m) {
          m = values[i];
        }
      }
      return m;
    }
    if (agg === 'max') {
      let m = values[0];
      for (let i = 1; i < values.length; i++) {
        if (values[i] > m) {
          m = values[i];
        }
      }
      return m;
    }
    let s = 0;
    for (let i = 0; i < values.length; i++) {
      s += values[i];
    }
    return s;
  }

  /** Distinct count for nunique KPI (web aggregate option). */
  private kpiNunique(column: string): number | null {
    const df = this.filteredFrame();
    if (df === null) {
      return null;
    }
    const idx = df.columnIndex(column);
    if (idx < 0) {
      return null;
    }
    const seen = new Set<string>();
    for (let r = 0; r < df.rows.length; r++) {
      const v = df.rows[r][idx];
      if (v !== null && v !== undefined) {
        seen.add(String(v));
      }
    }
    return seen.size;
  }

  private kpiValue(item: DashboardItem): string {
    if (item.agg === 'nunique') {
      return formatKpiValue(this.kpiNunique(item.column));
    }
    return formatKpiValue(this.kpiAggregate(item.column, item.agg));
  }

  // ---- item helpers ----

  private sortedItems(): DashboardItem[] {
    return this.dashItems.slice().sort((a: DashboardItem, b: DashboardItem) =>
      (a.y - b.y) !== 0 ? (a.y - b.y) : (a.x - b.x));
  }

  private hasChartItemLocal(chartId: string): boolean {
    for (let i = 0; i < this.dashItems.length; i++) {
      if (this.dashItems[i].kind === DashboardItemKind.Chart && this.dashItems[i].chartId === chartId) {
        return true;
      }
    }
    return false;
  }

  private pendingCharts(): ChartConfig[] {
    const charts = this.workspaceState.charts;
    const out: ChartConfig[] = [];
    for (let i = 0; i < charts.length; i++) {
      if (!this.hasChartItemLocal(charts[i].id)) {
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
      + '_' + item.column + item.agg + '_' + item.locked.toString() + editing;
  }

  private filterFieldKind(field: string): string {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return 'category';
    }
    const idx = df.columnIndex(field);
    if (idx < 0) {
      return 'category';
    }
    const dt = df.columns[idx].dtype;
    if (dt === 'date') {
      return 'date';
    }
    if (dt === 'number') {
      return 'range';
    }
    return 'category';
  }

  private editable(item: DashboardItem): boolean {
    return this.dashEditMode && !item.locked;
  }

  private startDrag(item: DashboardItem, e: GestureEvent): void {
    const nx = this.dragStartX + Math.round(e.offsetX / (this.colW() + DASH_GAP));
    const ny = this.dragStartY + Math.round(e.offsetY / (DASH_ROW_H + DASH_GAP));
    if (item.x !== nx || item.y !== ny) {
      item.x = Math.max(0, Math.min(nx, DASH_COLS - item.w));
      item.y = Math.max(0, ny);
      this.workspaceState.dashboard.bump();
    }
  }

  private startResize(item: DashboardItem, e: GestureEvent): void {
    const nw = this.resizeStartW + Math.round(e.offsetX / (this.colW() + DASH_GAP));
    const nh = this.resizeStartH + Math.round(e.offsetY / (DASH_ROW_H + DASH_GAP));
    if (item.w !== nw || item.h !== nh) {
      item.w = Math.max(3, Math.min(nw, DASH_COLS - item.x));
      item.h = Math.max(2, nh);
      this.workspaceState.dashboard.bump();
    }
  }

  private resizeStartW: number = 0;
  private resizeStartH: number = 0;

  private dragFiltersJson(): string {
    const out: DashFilterSpec[] = [];
    const filters = this.dashFilters;
    for (let i = 0; i < filters.length; i++) {
      out.push({ field: filters[i].field, kind: filters[i].kind, values: filters[i].values,
        lo: filters[i].lo, hi: filters[i].hi });
    }
    return JSON.stringify(out);
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
    const order: string[] = ['sum', 'mean', 'count', 'min', 'max', 'nunique'];
    const opts: SelectOption[] = [];
    for (let i = 0; i < order.length; i++) {
      opts.push({ value: this.aggLabel(order[i]) });
    }
    return opts;
  }

  private aggIndex(agg: string): number {
    const order: string[] = ['sum', 'mean', 'count', 'min', 'max', 'nunique'];
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

  private fieldOptions(): SelectOption[] {
    const df = this.dataState.activeDataFrame;
    const opts: SelectOption[] = [];
    if (df !== null) {
      for (let i = 0; i < df.columns.length; i++) {
        opts.push({ value: df.columns[i].name });
      }
    }
    return opts;
  }

  private newFilterIndex(): number {
    const df = this.dataState.activeDataFrame;
    if (df === null || this.newFilterField.length === 0) {
      return -1;
    }
    for (let i = 0; i < df.columns.length; i++) {
      if (df.columns[i].name === this.newFilterField) {
        return i;
      }
    }
    return -1;
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Text(t(this.workspaceState.language, 'nav.dashboard'))
          .fontSize(14)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
          .alignSelf(ItemAlign.Start)

        if (this.dataState.hasData) {
          // Toolbar (web: edit toggle + undo/redo + align/space tools)
          Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
            this.toolChip(this.dashEditMode
              ? t(this.workspaceState.language, 'dashboard.editing')
              : t(this.workspaceState.language, 'dashboard.viewing'), () => {
              this.workspaceState.dashboard.setEditMode(!this.dashEditMode);
            }, this.dashEditMode)
            if (this.dashEditMode) {
              this.toolChip('↶', () => {
                if (!this.workspaceState.dashboard.undo()) {
                  promptAction.showToast({ message: t(this.workspaceState.language, 'transform.nothingToUndo') });
                }
              }, false)
              this.toolChip('↷', () => {
                if (!this.workspaceState.dashboard.redo()) {
                  promptAction.showToast({ message: t(this.workspaceState.language, 'transform.nothingToRedo') });
                }
              }, false)
              if (this.brushCount() > 0) {
                this.toolChip('Clear brushes (' + this.brushCount().toString() + ')', () => {
                  this.brushes = {};
                  this.brushVersion++;
                }, false)
              }
              this.toolChip(t(this.workspaceState.language, 'dashboard.alignLeft'), () => {
                this.workspaceState.dashboard.alignItems('x');
              }, false)
              this.toolChip(t(this.workspaceState.language, 'dashboard.alignTop'), () => {
                this.workspaceState.dashboard.alignItems('y');
              }, false)
              this.toolChip(t(this.workspaceState.language, 'dashboard.spaceX'), () => {
                this.workspaceState.dashboard.spaceItemsEvenly('x');
              }, false)
              this.toolChip(t(this.workspaceState.language, 'dashboard.spaceY'), () => {
                this.workspaceState.dashboard.spaceItemsEvenly('y');
              }, false)
              this.modeChip('chart', t(this.workspaceState.language, 'dashboard.addChart'))
              this.modeChip('kpi', t(this.workspaceState.language, 'dashboard.addKpi'))
              this.modeChip('text', t(this.workspaceState.language, 'dashboard.addText'))
            }
          }
          .width('100%')

          if (this.addMode === 'chart') {
            this.chartPicker()
          } else if (this.addMode === 'kpi') {
            this.kpiConfig()
          } else if (this.addMode === 'text') {
            this.textConfig()
          }

          this.filterBar()
        }

        // Absolute grid (12 cols × 80px rows, vertical compaction)
        if (this.dashItems.length === 0) {
          Text(t(this.workspaceState.language, 'dashboard.empty'))
            .fontSize(12)
            .fontColor(Theme.colorMuted())
            .alignSelf(ItemAlign.Start)
        } else {
          Stack({ alignContent: Alignment.TopStart }) {
            ForEach(this.sortedItems(), (item: DashboardItem) => {
              Column() {
                this.card(item)
              }
              .width(this.gridW(item.w))
              .height(this.gridH(item.h))
              .position({ x: this.gridW(item.x) + DASH_GAP, y: this.gridH(item.y) + DASH_GAP })
              .opacity(this.dragId === item.id ? 0.85 : 1)
            }, (item: DashboardItem) => this.itemKey(item))
          }
          .width('100%')
          .height(this.gridHeightTotal() + 24)
          .opacity((this.renderTick >= 0 && this.brushVersion >= 0) ? 1 : 1)
          .onAreaChange((_o: Area, n: Area) => {
            const w = Number(n.width);
            if (!Number.isNaN(w) && Math.abs(w - this.containerW) > 1) {
              this.containerW = w;
            }
          })
          .alignContent(Alignment.TopStart)
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

  private gridHeightTotal(): number {
    let maxBottom = 4;
    const items = this.dashItems;
    for (let i = 0; i < items.length; i++) {
      maxBottom = Math.max(maxBottom, items[i].y + items[i].h);
    }
    return this.gridH(maxBottom);
  }

  @Builder
  toolChip(label: string, action: () => void, active: boolean) {
    Button() {
      Text(label)
        .fontSize(11)
        .fontColor(active ? Theme.primary : Theme.colorMuted())
    }
    .type(ButtonType.Normal)
    .height(26)
    .padding({ left: 10, right: 10 })
    .backgroundColor(active ? Theme.primaryDim : Color.Transparent)
    .borderRadius(10)
    .border({ width: 1, color: active ? Theme.primary : Theme.colorBorder() })
    .onClick(() => {
      action();
    })
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

  // ---- filter bar (web DashboardFilterBar: category/range/date) ----

  @Builder
  filterBar() {
    Column({ space: 6 }) {
      Row() {
        Text(t(this.workspaceState.language, 'dashboard.filters'))
          .fontSize(11)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
          .layoutWeight(1)
        if (this.activeFilterCountOf(this.dashFilters) > 0) {
          Text(t(this.workspaceState.language, 'dashboard.clearFilters'))
            .fontSize(10)
            .fontColor(Theme.primary)
            .padding(4)
            .onClick(() => {
              this.workspaceState.dashboard.clearFilters();
            })
        }
      }
      .width('100%')

      Select(this.fieldOptions())
        .fontColor(Theme.colorForeground())
        .border({ width: 1, color: Theme.colorBorder() })
        .selected(this.newFilterIndex())
        .value(this.newFilterField.length > 0 ? this.newFilterField
          : t(this.workspaceState.language, 'dashboard.addFilter'))
        .font({ size: 11 })
        .height(28)
        .width('60%')
        .backgroundColor(Theme.colorSurface())
        .borderRadius(6)
        .onSelect((_index: number, value: string) => {
          if (value !== this.newFilterField) {
            this.newFilterField = value;
            this.workspaceState.dashboard.addFilter(value, this.filterFieldKind(value));
          }
        })

      Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
        ForEach(this.dashFilters, (f: DashboardFilter) => {
          this.filterEditor(f)
        }, (f: DashboardFilter) => f.id + '_' + f.values.length.toString() + '_' + f.lo + '_' + f.hi
          + '_' + this.renderTick.toString())
      }
      .width('100%')
    }
    .width('100%')
    .padding(10)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  filterEditor(f: DashboardFilter) {
    Column({ space: 4 }) {
      Row({ space: 4 }) {
        Text(f.field + (f.kind === 'category' ? '' : (f.kind === 'date' ? ' · 日期' : ' · 范围')))
          .fontSize(10)
          .fontColor(Theme.colorForeground())
          .layoutWeight(1)
          .maxLines(1)
        Text('×')
          .fontSize(12)
          .fontColor(Theme.colorMuted())
          .padding(2)
          .onClick(() => {
            this.newFilterField = '';
            this.workspaceState.dashboard.removeFilter(f.id);
          })
      }
      .width('100%')

      if (f.kind === 'category') {
        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(3), cross: LengthMetrics.vp(3) } }) {
          ForEach(this.uniqueValues(f.field), (val: string) => {
            Button() {
              Text(val)
                .fontSize(10)
                .fontColor(f.values.indexOf(val) >= 0 ? Theme.primary : Theme.colorMuted())
            }
            .type(ButtonType.Normal)
            .height(22)
            .padding({ left: 8, right: 8 })
            .backgroundColor(f.values.indexOf(val) >= 0 ? Theme.primaryDim : Color.Transparent)
            .borderRadius(8)
            .border({ width: 1, color: f.values.indexOf(val) >= 0 ? Theme.primary : Theme.colorBorder() })
            .onClick(() => {
              this.workspaceState.dashboard.toggleFilterValue(f.id, val);
            })
          }, (val: string) => val + (f.values.indexOf(val) >= 0 ? '_on' : '_off'))
        }
        .width('100%')
      } else {
        Row({ space: 4 }) {
          TextInput({ text: f.lo, placeholder: f.kind === 'date' ? '开始日期' : '最小值' })
            .fontSize(10)
            .fontColor(Theme.colorForeground())
            .placeholderColor(Theme.colorMuted())
            .placeholderFont({ size: 10 })
            .height(24)
            .padding({ top: 0, bottom: 0 })
            .layoutWeight(1)
            .backgroundColor(Theme.colorBackground())
            .borderRadius(4)
            .onChange((v: string) => {
              this.workspaceState.dashboard.setFilterRange(f.id, v, f.hi);
            })
          Text('–').fontSize(10).fontColor(Theme.colorMuted())
          TextInput({ text: f.hi, placeholder: f.kind === 'date' ? '结束日期' : '最大值' })
            .fontSize(10)
            .fontColor(Theme.colorForeground())
            .placeholderColor(Theme.colorMuted())
            .placeholderFont({ size: 10 })
            .height(24)
            .padding({ top: 0, bottom: 0 })
            .layoutWeight(1)
            .backgroundColor(Theme.colorBackground())
            .borderRadius(4)
            .onChange((v: string) => {
              this.workspaceState.dashboard.setFilterRange(f.id, f.lo, v);
            })
        }
        .width('100%')
      }
    }
    .width('47%')
    .padding(6)
    .borderRadius(6)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorBackground())
    .alignItems(HorizontalAlign.Start)
  }

  // ---- add flows (unchanged semantics, auto-placed) ----

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
      // 一键「新建图表并添加」：数据集就绪但尚无图表时闭环（web 需先去图表
      // 页新建；端侧补一个直达入口）
      this.newChartButton()
    }
    .width('100%')
    .padding(10)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  newChartButton() {
    Button() {
      Row({ space: 4 }) {
        SymbolGlyph($r('sys.symbol.plus'))
          .fontSize(11)
          .fontColor([Theme.primary])
        Text(t(this.workspaceState.language, 'dashboard.newChartAndAdd'))
          .fontSize(11)
          .fontColor(Theme.primary)
      }
    }
    .type(ButtonType.Normal)
    .height(26)
    .padding({ left: 10, right: 10 })
    .backgroundColor(Theme.primaryDim)
    .borderRadius(10)
    .border({ width: 1, color: Theme.primary })
    .onClick(() => {
      const df = this.dataState.activeDataFrame;
      if (df === null) {
        return;
      }
      const chart = this.workspaceState.createChart(df.name);
      this.workspaceState.dashboard.addChart(chart.id);
      this.workspaceState.refreshChart();
    })
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
          .width(96)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            const order: string[] = ['sum', 'mean', 'count', 'min', 'max', 'nunique'];
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

  // ---- cards ----

  @Builder
  cardHeader(item: DashboardItem, title: string) {
    Row({ space: 4 }) {
      Text(title)
        .fontSize(12)
        .fontWeight(600)
        .fontColor(Theme.colorForeground())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      if (this.dashEditMode) {
        SymbolGlyph(item.locked ? $r('sys.symbol.lock') : $r('sys.symbol.lock_open'))
          .fontSize(12)
          .fontColor([item.locked ? Theme.primary : Theme.colorMuted()])
          .padding(2)
          .onClick(() => {
            this.workspaceState.dashboard.toggleLock(item.id);
          })
        SymbolGlyph($r('sys.symbol.trash'))
          .fontSize(14)
          .fontColor([Theme.colorMuted()])
          .padding(2)
          .onClick(() => {
            this.workspaceState.dashboard.removeItem(item.id);
          })
      }
    }
    .width('100%')
    .padding({ left: 12, right: 8, top: 6 })
    .gesture(PanGesture({ fingers: 1, distance: 6 })
      .onActionStart((_e: GestureEvent) => {
        if (!this.editable(item)) {
          return;
        }
        this.dragId = item.id;
        this.dragStartX = item.x;
        this.dragStartY = item.y;
      })
      .onActionUpdate((e: GestureEvent) => {
        if (this.dragId === item.id) {
          this.startDrag(item, e);
        }
      })
      .onActionEnd((_e: GestureEvent) => {
        if (this.dragId === item.id) {
          this.dragId = '';
          this.workspaceState.dashboard.moveItem(item.id, item.x, item.y);
        }
      }))
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
        if (this.dashEditMode) {
          SymbolGlyph(item.locked ? $r('sys.symbol.lock') : $r('sys.symbol.lock_open'))
            .fontSize(11)
            .fontColor([item.locked ? Theme.primary : Theme.colorMuted()])
            .padding(2)
            .onClick(() => {
              this.workspaceState.dashboard.toggleLock(item.id);
            })
          SymbolGlyph($r('sys.symbol.trash'))
            .fontSize(12)
            .fontColor([Theme.colorMuted()])
            .padding(2)
            .onClick(() => {
              this.workspaceState.dashboard.removeItem(item.id);
            })
        }
      }
      .width('100%')
      Text(this.kpiValue(item))
        .fontSize(20)
        .fontWeight(600)
        .fontColor(Theme.primary)
        .margin({ top: 2 })
    }
    .width('100%')
    .height('100%')
    .padding(8)
    .justifyContent(FlexAlign.Center)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
  }

  @Builder
  card(item: DashboardItem) {
    Stack({ alignContent: Alignment.BottomEnd }) {
      Column() {
        if (item.kind === DashboardItemKind.Kpi) {
          this.kpiCard(item)
        } else if (item.kind === DashboardItemKind.Chart) {
          this.cardHeader(item, this.chartName(item.chartId))
          ChartView({
            chartId: item.chartId,
            filterJson: this.dragFiltersJson(),
            brushJson: this.externalBrushes(item.id),
            onBrush: (cid: string, bj: string): void => {
              this.handleBrush(item.id, bj);
            }
          })
            .width('100%')
            .layoutWeight(1)
        } else {
          this.cardHeader(item, t(this.workspaceState.language, 'dashboard.addText'))
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
              if (this.editable(item)) {
                this.startEdit(item);
              }
            })
          }
        }
      }
      .width('100%')
      .height('100%')
      .borderRadius(8)
      .border({ width: 1, color: this.dragId === item.id ? Theme.primary : Theme.colorBorder() })
      .backgroundColor(Theme.colorSurface())

      // resize handle (bottom-right corner, edit mode + unlocked)
      if (this.editable(item)) {
        Column()
          .width(16)
          .height(16)
          .margin({ right: 2, bottom: 2 })
          .borderRadius(4)
          .backgroundColor(Theme.colorBorder())
          .gesture(PanGesture({ fingers: 1, distance: 6 })
            .onActionStart((_e: GestureEvent) => {
              this.resizeStartW = item.w;
              this.resizeStartH = item.h;
            })
            .onActionUpdate((e: GestureEvent) => {
              this.startResize(item, e);
            })
            .onActionEnd((_e: GestureEvent) => {
              this.workspaceState.dashboard.resizeItem(item.id, item.w, item.h);
            }))
      }
    }
    .width('100%')
    .height('100%')
  }
}
