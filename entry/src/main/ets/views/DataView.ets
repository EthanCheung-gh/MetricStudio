import { pasteboard } from '@kit.BasicServicesKit';
import { promptAction, LengthMetrics } from '@kit.ArkUI';
import { picker, fileIo as fs } from '@kit.CoreFileKit';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { fmt } from '../common/Format';
import { CellValue } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { Language, WorkspaceState } from '../model/WorkspaceState';
import { toNumber } from '../engine/Numeric';
import { SnapshotView } from './SnapshotView';
import { LineageView } from './LineageView';
import { CleaningPanel } from './CleaningPanel';
import { InsightsPanel } from './InsightsPanel';
import { StatsPanel } from './StatsPanel';
import { TransformPanel } from './TransformPanel';
import { ColumnStatsPanel } from './ColumnStats';

/**
 * Data table view (web: src/components/data/DataView.tsx + DataTable.tsx).
 * Toolbar with view toggle (table / snapshots / lineage / sql) + right icon
 * rail (cleaning / insights / stats / transform / columns). Table matches
 * web DataTable: global search, per-column filter + sort cycle, column
 * visibility, resize, cell copy, CSV export, page-size select.
 */
@Component
export struct DataView {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State page: number = 0;
  @State sortCol: string = '';
  @State sortAsc: boolean = true;
  @State viewMode: string = 'table'; // 'table' | 'snapshots' | 'lineage'
  @State openPanel: string = ''; // '' | 'cleaning' | 'insights' | 'stats' | 'transform' | 'columns'
  // table display parity (web DataTable)
  @State globalFilter: string = '';
  @State pageSize: number = 200;
  @State hiddenCols: string[] = [];
  @State showColsPanel: boolean = false;
  @State copiedCell: string = '';
  @State colFilterTick: number = 0;
  @State widthTick: number = 0;
  @State hoveredPanel: string = '';
  private colFilters: Map<string, string> = new Map();
  private colWidths: Map<string, number> = new Map();
  // 表格双向滚动控制器（水平 PanGesture 手动驱动 + 垂直内层 Scroll）
  private hScroller: Scroller = new Scroller();
  private vScroller: Scroller = new Scroller();
  private panBaseX: number = 0;
  private resizeCol: string = '';
  private resizeStartX: number = 0;
  private resizeStartW: number = 0;

  private visibleColumns(): ColumnMetaShim[] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    const out: ColumnMetaShim[] = [];
    for (let c = 0; c < df.columns.length; c++) {
      if (this.hiddenCols.indexOf(df.columns[c].name) < 0) {
        out.push({ name: df.columns[c].name, inferredType: df.columns[c].inferredType });
      }
    }
    return out;
  }

  private allColumnShims(): ColumnMetaShim[] {
    const df = this.dataState.activeDataFrame;
    const out: ColumnMetaShim[] = [];
    if (df === null) {
      return out;
    }
    for (let c = 0; c < df.columns.length; c++) {
      out.push({ name: df.columns[c].name, inferredType: df.columns[c].inferredType });
    }
    return out;
  }

  private colWidth(name: string): number {
    const w = this.colWidths.get(name);
    return w !== undefined ? w : 160;
  }

  private setColWidth(name: string, width: number): void {
    this.colWidths.set(name, Math.max(80, Math.min(480, width)));
    this.widthTick++;
  }

  private colFilterText(name: string): string {
    const v = this.colFilters.get(name);
    return v !== undefined ? v : '';
  }

  private setColFilter(name: string, text: string): void {
    this.colFilters.set(name, text);
    this.colFilterTick++;
    this.page = 0;
  }

  private cycleSort(name: string): void {
    if (this.sortCol !== name) {
      this.sortCol = name;
      this.sortAsc = true;
    } else if (this.sortAsc) {
      this.sortAsc = false;
    } else {
      this.sortCol = '';
      this.sortAsc = true;
    }
    this.page = 0;
  }

  private sortIcon(name: string): string {
    if (this.sortCol !== name) {
      return '↕';
    }
    return this.sortAsc ? '↑' : '↓';
  }

  private cellMatches(v: CellValue, needle: string): boolean {
    if (needle.length === 0) {
      return true;
    }
    if (v === null || v === undefined) {
      return false;
    }
    return String(v).toLowerCase().indexOf(needle) >= 0;
  }

  /** Filter + sort over the full in-memory dataset (web does this server-side). */
  private processedRows(): CellValue[][] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    const g = this.globalFilter.toLowerCase();
    const out: CellValue[][] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const row = df.rows[r];
      let keep = true;
      this.colFilters.forEach((needle: string, name: string) => {
        if (!keep || needle.length === 0) {
          return;
        }
        const idx = df.columnIndex(name);
        if (idx < 0 || !this.cellMatches(row[idx], needle.toLowerCase())) {
          keep = false;
        }
      });
      if (keep && g.length > 0) {
        let any = false;
        for (let c = 0; c < df.columns.length && !any; c++) {
          if (this.cellMatches(row[c], g)) {
            any = true;
          }
        }
        keep = any;
      }
      if (keep) {
        out.push(row);
      }
    }
    if (this.sortCol.length > 0) {
      const idx = df.columnIndex(this.sortCol);
      if (idx >= 0) {
        const asc = this.sortAsc;
        out.sort((a: CellValue[], b: CellValue[]) => {
          const na = toNumber(a[idx]);
          const nb = toNumber(b[idx]);
          let c: number;
          if (na !== null && nb !== null) {
            c = na < nb ? -1 : (na > nb ? 1 : 0);
          } else {
            const sa = a[idx] === null ? '' : String(a[idx]);
            const sb = b[idx] === null ? '' : String(b[idx]);
            c = sa < sb ? -1 : (sa > sb ? 1 : 0);
          }
          return asc ? c : -c;
        });
      }
    }
    return out;
  }

  private filteredCount(): number {
    return this.processedRows().length;
  }

  private totalPages(): number {
    return Math.max(1, Math.ceil(this.filteredCount() / this.pageSize));
  }

  private pageRows(): CellValue[][] {
    const rows = this.processedRows();
    const start = this.page * this.pageSize;
    return rows.slice(start, start + this.pageSize);
  }

  private copyCell(key: string, v: CellValue): void {
    const text = v === null || v === undefined ? '' : String(v);
    const data = pasteboard.createData('text/plain', text);
    pasteboard.getSystemPasteboard().setData(data).then(() => {
      this.copiedCell = key;
      setTimeout(() => {
        if (this.copiedCell === key) {
          this.copiedCell = '';
        }
      }, 1200);
    }).catch(() => {
    });
  }

  private csvEscape(v: CellValue): string {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Export the current dataset as CSV via the save picker (web exportDatasetUrl). */
  private async exportCsv(): Promise<void> {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return;
    }
    const lines: string[] = [];
    const header: string[] = [];
    for (let c = 0; c < df.columns.length; c++) {
      header.push(this.csvEscape(df.columns[c].name));
    }
    lines.push(header.join(','));
    for (let r = 0; r < df.rows.length; r++) {
      const row: string[] = [];
      for (let c = 0; c < df.columns.length; c++) {
        row.push(this.csvEscape(df.rows[r][c]));
      }
      lines.push(row.join(','));
    }
    try {
      const documentPicker = new picker.DocumentViewPicker(getContext(this));
      const saveOpts = new picker.DocumentSaveOptions();
      saveOpts.newFileNames = ['metricstudio-export.csv'];
      const uris = await documentPicker.save(saveOpts);
      if (uris.length === 0) {
        return;
      }
      const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
      fs.writeSync(file.fd, lines.join('\n'));
      fs.closeSync(file);
      promptAction.showToast({ message: l10n(this.lang(), 'CSV 已导出', 'CSV exported') });
    } catch (e) {
      // cancelled or failed
    }
  }

  lang(): Language {
    return this.workspaceState.language;
  }

  build() {
    Row() {
      // Left: toolbar + active view (web DataView left card)
      Column() {
        // Toolbar: dataset name + view toggle + rows info
        Row() {
          Text(this.dataState.activeDataFrame !== null ? this.dataState.activeDataFrame.name : '')
            .fontSize(12)
            .fontWeight(600)
            .fontColor(Theme.colorForeground())
          Row({ space: 4 }) {
            Text('表格')
              .fontSize(11)
              .fontColor(this.viewMode === 'table' ? Theme.primary : Theme.colorMuted())
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .borderRadius(4)
              .backgroundColor(this.viewMode === 'table' ? Theme.primaryDim : Color.Transparent)
              .onClick(() => {
                this.viewMode = 'table';
              })
            Text('快照')
              .fontSize(11)
              .fontColor(this.viewMode === 'snapshots' ? Theme.primary : Theme.colorMuted())
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .borderRadius(4)
              .backgroundColor(this.viewMode === 'snapshots' ? Theme.primaryDim : Color.Transparent)
              .onClick(() => {
                this.viewMode = 'snapshots';
              })
            Text('血缘')
              .fontSize(11)
              .fontColor(this.viewMode === 'lineage' ? Theme.primary : Theme.colorMuted())
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .borderRadius(4)
              .backgroundColor(this.viewMode === 'lineage' ? Theme.primaryDim : Color.Transparent)
              .onClick(() => {
                this.viewMode = 'lineage';
              })
            Text('SQL')
              .fontSize(11)
              .fontColor(Theme.colorMuted())
              .padding({ left: 8, right: 8, top: 3, bottom: 3 })
              .borderRadius(4)
              .onClick(() => {
                this.workspaceState.setSqlOpen(true);
              })
          }
          .margin({ left: 12 })
          Blank()
          if (this.dataState.activeDataFrame !== null) {
            Text(`${fmt(this.dataState.activeDataFrame.rowCount)} ${t(this.lang(), 'status.rows')} × ${this.dataState.activeDataFrame.colCount} ${t(this.lang(), 'status.cols')}`)
              .fontSize(12)
              .fontColor(Theme.colorMuted())
          }
        }
        .width('100%')
        .height(32)
        .padding({ left: 12, right: 12 })

        if (this.viewMode === 'snapshots') {
          Scroll() {
            SnapshotView()
              .width('100%')
          }
          .layoutWeight(1)
          .scrollBar(BarState.Auto)
          .align(Alignment.TopStart)
        } else if (this.viewMode === 'lineage') {
          Scroll() {
            LineageView()
              .width('100%')
          }
          .layoutWeight(1)
          .scrollBar(BarState.Auto)
          .align(Alignment.TopStart)
        } else {
          this.tableArea()
        }
      }
      .layoutWeight(1)
      .height('100%')
      .backgroundColor(Theme.colorBackground())

      // Right: icon rail + single open panel (web CleaningPanel/InsightsPanel/
      // StatsPanel/TransformPanel/ColumnStats rail)
      Row() {
        Column({ space: 4 }) {
          this.railButton('wand_and_stars', 'cleaning', l10n(this.lang(), '清洗', 'Cleaning'))
          this.railButton('list_bullet', 'insights', t(this.lang(), 'insights.title'))
          this.railButton('square_grid_2x2', 'stats', l10n(this.lang(), '统计', 'Stats'))
          this.railButton('slider_horizontal_2', 'transform', t(this.lang(), 'transform.title'))
          this.railButton('doc_plaintext', 'columns', t(this.lang(), 'table.columns'))
        }
        .width(40)
        .height('100%')
        .padding({ top: 8 })
        .border({ width: { left: 1 }, color: Theme.colorBorder() })
        .backgroundColor(Theme.colorSurface())
        .alignItems(HorizontalAlign.Center)

        if (this.openPanel !== '') {
          Column() {
            Row() {
              Text(this.panelTitle())
                .fontSize(12)
                .fontWeight(600)
                .fontColor(Theme.colorMuted())
              Blank()
              Text('×')
                .fontSize(14)
                .fontColor(Theme.colorMuted())
                .padding(4)
                .onClick(() => {
                  this.openPanel = '';
                })
            }
            .width('100%')
            .height(34)
            .padding({ left: 10, right: 6 })
            .border({ width: { bottom: 1 }, color: Theme.colorBorder() })

            Scroll() {
              Column() {
                if (this.openPanel === 'cleaning') {
                  CleaningPanel()
                    .width('100%')
                } else if (this.openPanel === 'insights') {
                  InsightsPanel()
                    .width('100%')
                } else if (this.openPanel === 'stats') {
                  StatsPanel()
                    .width('100%')
                } else if (this.openPanel === 'transform') {
                  TransformPanel()
                    .width('100%')
                } else {
                  ColumnStatsPanel()
                    .width('100%')
                }
              }
              .width('100%')
              .padding(8)
              .alignItems(HorizontalAlign.Start)
            }
            .layoutWeight(1)
            .scrollBar(BarState.Auto)
            .align(Alignment.TopStart)
          }
          .width(288)
          .height('100%')
          .border({ width: { left: 1 }, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurfaceElevated())
        }
      }
      .height('100%')
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorBackground())
  }

  private panelTitle(): string {
    if (this.openPanel === 'cleaning') {
      return l10n(this.lang(), '清洗', 'Cleaning');
    }
    if (this.openPanel === 'insights') {
      return t(this.lang(), 'insights.title');
    }
    if (this.openPanel === 'stats') {
      return l10n(this.lang(), '统计', 'Stats');
    }
    if (this.openPanel === 'transform') {
      return t(this.lang(), 'transform.title');
    }
    return t(this.lang(), 'table.columns');
  }

  @Builder
  railButton(symbol: string, panel: string, label: string) {
    Stack({ alignContent: Alignment.Center }) {
      Column() {
        SymbolGlyph($r('sys.symbol.' + symbol))
          .fontSize(16)
          .fontColor([this.openPanel === panel ? Theme.primary : Theme.colorMuted()])
      }
      .width(30)
      .height(30)
      .borderRadius(6)
      .backgroundColor(this.openPanel === panel ? Theme.primaryDim : Color.Transparent)
      if (this.hoveredPanel === panel) {
        Text(label)
          .fontSize(10)
          .fontColor('#ffffff')
          .backgroundColor('#262626F2')
          .padding({ left: 8, right: 8, top: 4, bottom: 4 })
          .borderRadius(4)
          .position({ x: 34, y: 3 })
      }
    }
    .onHover((hover: boolean) => {
      this.hoveredPanel = hover ? panel : (this.hoveredPanel === panel ? '' : this.hoveredPanel);
    })
    .onClick(() => {
      this.openPanel = this.openPanel === panel ? '' : panel;
    })
  }

  @Builder
  tableArea() {
    Column() {
      // Toolbar (web DataTable toolbar): preview counts + search + columns + CSV
      Row({ space: 6 }) {
        Text(l10n(this.lang(), '预览: ' + fmt(this.filteredCount()) + ' / ' + fmt(this.dataState.rowCount) + ' 行',
          'preview: ' + fmt(this.filteredCount()) + ' / ' + fmt(this.dataState.rowCount) + ' rows'))
          .fontSize(11)
          .fontColor(Theme.colorMuted())
          .layoutWeight(1)
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        TextInput({ placeholder: l10n(this.lang(), '搜索全部列', 'Search all columns'), text: this.globalFilter })
          .width(150)
          .height(24)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 11 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(11)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onChange((v: string) => {
            this.globalFilter = v;
            this.page = 0;
          })
        Button() {
          Text(l10n(this.lang(), '列', 'Columns') + (this.hiddenCols.length > 0 ? ' (' + this.hiddenCols.length + ')' : ''))
            .fontSize(10)
            .fontColor(this.showColsPanel ? Theme.primary : Theme.colorMuted())
        }
        .type(ButtonType.Normal)
        .height(24)
        .padding({ left: 8, right: 8 })
        .backgroundColor(this.showColsPanel ? Theme.primaryDim : Theme.colorSurface())
        .borderRadius(6)
        .onClick(() => {
          this.showColsPanel = !this.showColsPanel;
        })
        Button() {
          Text('CSV').fontSize(10).fontColor(Theme.colorMuted())
        }
        .type(ButtonType.Normal)
        .height(24)
        .padding({ left: 8, right: 8 })
        .backgroundColor(Theme.colorSurface())
        .borderRadius(6)
        .onClick(() => {
          this.exportCsv();
        })
        // Pager moved to the top toolbar (bottom bar was occluded by the AI capsule)
        Text('«')
          .fontSize(13)
          .fontColor(this.page > 0 ? Theme.colorForeground() : Theme.colorMuted())
          .padding({ left: 4, right: 4 })
          .onClick(() => {
            this.page = 0;
          })
        Text('‹')
          .fontSize(16)
          .fontColor(this.page > 0 ? Theme.colorForeground() : Theme.colorMuted())
          .padding({ left: 4, right: 4 })
          .onClick(() => {
            if (this.page > 0) {
              this.page--;
            }
          })
        Text((this.page + 1).toString() + '/' + this.totalPages().toString())
          .fontSize(11)
          .fontColor(Theme.colorMuted())
        Text('›')
          .fontSize(16)
          .fontColor(this.page < this.totalPages() - 1 ? Theme.colorForeground() : Theme.colorMuted())
          .padding({ left: 4, right: 4 })
          .onClick(() => {
            if (this.page < this.totalPages() - 1) {
              this.page++;
            }
          })
        Text('»')
          .fontSize(13)
          .fontColor(this.page < this.totalPages() - 1 ? Theme.colorForeground() : Theme.colorMuted())
          .padding({ left: 4, right: 4 })
          .onClick(() => {
            this.page = this.totalPages() - 1;
          })
        Select(this.pageSizeOptions())
          .fontColor(Theme.colorForeground())
          .border({ width: 1, color: Theme.colorBorder() })
          .selected(this.pageSizeIndex())
          .value(this.pageSize.toString())
          .font({ size: 11 })
          .height(24)
          .width(84)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            this.pageSize = Number(value);
            this.page = 0;
          })
      }
      .width('100%')
      .height(30)
      .padding({ left: 10, right: 10 })

      // Column visibility panel (web columns dropdown)
      if (this.showColsPanel) {
        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
          ForEach(this.allColumnShims(), (col: ColumnMetaShim) => {
            Button() {
              Text((this.hiddenCols.indexOf(col.name) >= 0 ? '☐ ' : '☑ ') + col.name)
                .fontSize(10)
                .fontColor(this.hiddenCols.indexOf(col.name) >= 0 ? Theme.colorMuted() : Theme.colorForeground())
            }
            .type(ButtonType.Normal)
            .height(24)
            .padding({ left: 8, right: 8 })
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onClick(() => {
              const idx = this.hiddenCols.indexOf(col.name);
              if (idx >= 0) {
                this.hiddenCols.splice(idx, 1);
              } else if (this.hiddenCols.length < this.allColumnShims().length - 1) {
                this.hiddenCols.push(col.name); // keep at least one visible
              }
              this.page = 0;
              this.colFilterTick++;
            })
          }, (col: ColumnMetaShim) => col.name + '_' + this.hiddenCols.length.toString())
        }
        .width('100%')
        .padding({ left: 10, right: 10, bottom: 6 })
      }

      // 嵌套滚动：外层水平（触摸横滑由 PanGesture 手动驱动，绕过手势截获），
      // 内层垂直承接滚轮/触摸纵滚——两个方向都可靠（web DataTable overflow）。
      Scroll(this.hScroller) {
        Column() {
          // Header row (sort cycle + per-column filter + resize handle)
          Row() {
            ForEach(this.visibleColumns(), (col: ColumnMetaShim, idx: number) => {
              this.headerCellBuilder(col, idx)
            }, (col: ColumnMetaShim, idx: number) => {
              return col.name + '_' + this.sortCol + this.sortAsc + '_' + this.widthTick.toString()
                + '_' + this.colFilterText(col.name) + '_' + this.colFilterTick.toString();
            })
          }
          .width(this.tableWidth())

          // Body (vertical scroll; wheel/touch both handled here)
          Scroll(this.vScroller) {
            Column() {
              if (this.pageRows().length === 0) {
                Text(l10n(this.lang(), '没有匹配的行', 'No matching rows'))
                  .fontSize(12)
                  .fontColor(Theme.colorMuted())
                  .width(this.tableWidth())
                  .textAlign(TextAlign.Center)
                  .padding(24)
              } else {
                ForEach(this.pageRows(), (row: CellValue[], rIdx: number) => {
                  this.bodyRow(row, rIdx)
                }, (row: CellValue[], rIdx: number) => rIdx.toString() + '_' + this.copiedCell + '_' + this.widthTick.toString())
              }
            }
            .width(this.tableWidth())
            // Keep the last rows clear of the floating AI capsule
            .padding({ bottom: 56 })
          }
          .layoutWeight(1)
          .scrollBar(BarState.Auto)
          .align(Alignment.TopStart)
        }
        .width(this.tableWidth())
        .height('100%')
      }
      .layoutWeight(1)
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Auto)
      .align(Alignment.TopStart)
      .backgroundColor(Theme.colorSurface())
      .border({ width: { top: 1, bottom: 1 }, color: Theme.colorBorder() })
      .gesture(PanGesture({ fingers: 1, direction: PanDirection.Horizontal, distance: 8 })
        .onActionStart((_e: GestureEvent) => {
          this.panBaseX = this.hScroller.currentOffset().xOffset;
        })
        .onActionUpdate((e: GestureEvent) => {
          // 触摸横滑：手动驱动水平偏移（滚轮纵向仍由内层 Scroll 处理）
          this.hScroller.scrollTo({ xOffset: Math.max(0, this.panBaseX - e.offsetX), yOffset: 0 });
        }))
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorBackground())
  }

  private pageSizeOptions(): SelectOption[] {
    const sizes: number[] = [100, 200, 500, 1000];
    const opts: SelectOption[] = [];
    for (let i = 0; i < sizes.length; i++) {
      opts.push({ value: sizes[i].toString() });
    }
    return opts;
  }

  private pageSizeIndex(): number {
    const sizes: number[] = [100, 200, 500, 1000];
    for (let i = 0; i < sizes.length; i++) {
      if (sizes[i] === this.pageSize) {
        return i;
      }
    }
    return 1;
  }

  /** Total table width = sum of visible column widths. */
  private tableWidth(): number {
    const cols = this.visibleColumns();
    let total = 0;
    for (let i = 0; i < cols.length; i++) {
      total += this.colWidth(cols[i].name);
    }
    return Math.max(1, total);
  }

  @Builder
  headerCellBuilder(col: ColumnMetaShim, idx: number) {
    Stack({ alignContent: Alignment.TopEnd }) {
      Column({ space: 3 }) {
        Row({ space: 4 }) {
          Text(col.name)
            .fontSize(12)
            .fontWeight(600)
            .fontColor(Theme.colorForeground())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .layoutWeight(1)
          Text(this.typeBadgeText(col.inferredType))
            .fontSize(10)
            .fontColor(this.typeBadgeColor(col.inferredType))
            .padding({ left: 4, right: 4, top: 1, bottom: 1 })
            .borderRadius(4)
            .backgroundColor(this.typeBadgeBg(col.inferredType))
          Text(this.sortIcon(col.name))
            .fontSize(11)
            .fontColor(this.sortCol === col.name ? Theme.primary : Theme.colorMuted())
        }
        .width('100%')
        .onClick(() => {
          this.cycleSort(col.name);
        })
        TextInput({ placeholder: l10n(this.lang(), '筛选', 'Filter'), text: this.colFilterText(col.name) })
          .width('100%')
          .height(22)
          .padding({ top: 0, bottom: 0, left: 6, right: 6 })
          .placeholderFont({ size: 10 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(10)
          .backgroundColor(Theme.colorBackground())
          .borderRadius(4)
          .onChange((v: string) => {
            this.setColFilter(col.name, v);
          })
      }
      .width('100%')
      .padding({ left: 10, right: 10, top: 5, bottom: 4 })
      .alignItems(HorizontalAlign.Start)

      // Resize handle (web columnResizeMode onChange)
      Column()
        .width(8)
        .height('100%')
        .backgroundColor(this.resizeCol === col.name ? Theme.primary : Color.Transparent)
        .onTouch((event: TouchEvent) => {
          if (event.touches.length === 0) {
            return;
          }
          const t = event.touches[0];
          if (event.type === TouchType.Down) {
            this.resizeCol = col.name;
            this.resizeStartX = t.windowX;
            this.resizeStartW = this.colWidth(col.name);
          } else if (event.type === TouchType.Move && this.resizeCol === col.name) {
            this.setColWidth(col.name, this.resizeStartW + (t.windowX - this.resizeStartX));
          } else if (event.type === TouchType.Up || event.type === TouchType.Cancel) {
            this.resizeCol = '';
          }
        })
    }
    .width(this.colWidth(col.name))
    .height(56)
    .backgroundColor(Theme.colorSurface())
    .border({ width: { right: 0.5, bottom: 0.5 }, color: Theme.colorBorder() })
  }

  @Builder
  bodyRow(row: CellValue[], rIdx: number) {
    Row() {
      ForEach(this.visibleColumns(), (col: ColumnMetaShim, cIdx: number) => {
        this.bodyCell(row, cIdx, col.name, rIdx)
      }, (col: ColumnMetaShim, cIdx: number) => cIdx.toString() + '_' + col.name)
    }
    .width(this.tableWidth())
    .height(33)
    .backgroundColor(rIdx % 2 === 0 ? Theme.colorBackground() : Theme.colorSurface())
  }

  @Builder
  bodyCell(row: CellValue[], cIdx: number, colName: string, rIdx: number) {
    Stack({ alignContent: Alignment.TopEnd }) {
      Text(row[cIdx] === null || row[cIdx] === undefined ? '—' : String(row[cIdx]))
        .fontSize(12)
        .fontColor(Theme.colorForeground())
        .width('100%')
        .padding({ left: 12, right: 12 })
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .textAlign(TextAlign.Start)
      if (this.copiedCell === colName + '_' + rIdx.toString()) {
        Text('✓')
          .fontSize(10)
          .fontColor(Theme.success)
          .padding({ left: 2, right: 2 })
      }
    }
    .width(this.colWidth(colName))
    .height('100%')
    .onClick(() => {
      this.copyCell(colName + '_' + rIdx.toString(), row[cIdx]);
    })
  }

  private typeBadgeText(type: string): string {
    if (type === 'quantitative') {
      return 'num';
    }
    if (type === 'temporal') {
      return 'date';
    }
    return 'str';
  }

  private typeBadgeColor(type: string): string {
    if (type === 'quantitative') {
      return Theme.primary;
    }
    if (type === 'temporal') {
      return Theme.success;
    }
    return Theme.warning;
  }

  private typeBadgeBg(type: string): string {
    return Theme.primaryDim;
  }
}

/** Shim so @Builder params stay typed (columns are ColumnMeta objects). */
interface ColumnMetaShim {
  name: string;
  inferredType: string;
}
