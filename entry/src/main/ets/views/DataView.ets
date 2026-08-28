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

const PAGE_SIZE: number = 100;

/**
 * Data table view (web: src/components/data/DataView.tsx + DataTable.tsx).
 * Toolbar with view toggle (table / snapshots); table mode shows sortable
 * header + paginated body; snapshots mode shows the SnapshotView.
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

  private sortedRows(): CellValue[][] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    const rows = df.rows.slice();
    if (this.sortCol.length > 0) {
      const idx = df.columnIndex(this.sortCol);
      if (idx >= 0) {
        rows.sort((a: CellValue[], b: CellValue[]) => {
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
          return this.sortAsc ? c : -c;
        });
      }
    }
    return rows;
  }

  private pageRows(): CellValue[][] {
    const rows = this.sortedRows();
    const start = this.page * PAGE_SIZE;
    if (start >= rows.length) {
      return [];
    }
    const end = Math.min(start + PAGE_SIZE, rows.length);
    const out: CellValue[][] = [];
    for (let r = start; r < end; r++) {
      out.push(rows[r]);
    }
    return out;
  }

  private totalPages(): number {
    const df = this.dataState.activeDataFrame;
    const total = df !== null ? df.rowCount : 0;
    return Math.max(1, Math.ceil(total / PAGE_SIZE));
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
          this.railButton('wand_and_stars', 'cleaning')
          this.railButton('list_bullet', 'insights')
          this.railButton('square_grid_2x2', 'stats')
          this.railButton('slider_horizontal_2', 'transform')
          this.railButton('doc_plaintext', 'columns')
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
  railButton(symbol: string, panel: string) {
    Column() {
      SymbolGlyph($r('sys.symbol.' + symbol))
        .fontSize(16)
        .fontColor([this.openPanel === panel ? Theme.primary : Theme.colorMuted()])
    }
    .width(30)
    .height(30)
    .borderRadius(6)
    .backgroundColor(this.openPanel === panel ? Theme.primaryDim : Color.Transparent)
    .onClick(() => {
      this.openPanel = this.openPanel === panel ? '' : panel;
    })
  }

  @Builder
  tableArea() {
    Column() {
      // Single horizontal scroll hosts BOTH header and body so column widths
      // always stay perfectly aligned regardless of panel widths / collapses.
      Scroll() {
        Column() {
          // Header row
          Row() {
            ForEach(this.dataState.activeDataFrame !== null ? this.dataState.activeDataFrame.columns : [], (col: ColumnMetaShim, idx: number) => {
              this.headerCellBuilder(col, idx)
            }, (col: ColumnMetaShim, idx: number) => idx.toString())
          }
          .width(this.tableWidth())

          // Body (vertical scroll inside the shared horizontal scroll)
          Scroll() {
            Column() {
              ForEach(this.pageRows(), (row: CellValue[], rIdx: number) => {
                this.bodyRow(row, rIdx)
              }, (row: CellValue[], rIdx: number) => rIdx.toString())
            }
            .width(this.tableWidth())
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

      // Pager
      Row({ space: 8 }) {
        Text(`${this.page + 1} / ${this.totalPages()}`)
          .fontSize(12)
          .fontColor(Theme.colorMuted())
        Blank()
        Text('‹')
          .fontSize(18)
          .fontColor(this.page > 0 ? Theme.colorForeground() : Theme.colorMuted())
          .padding({ left: 8, right: 8 })
          .onClick(() => {
            if (this.page > 0) {
              this.page--;
            }
          })
        Text('›')
          .fontSize(18)
          .fontColor(this.page < this.totalPages() - 1 ? Theme.colorForeground() : Theme.colorMuted())
          .padding({ left: 8, right: 8 })
          .onClick(() => {
            if (this.page < this.totalPages() - 1) {
              this.page++;
            }
          })
      }
      .width('100%')
      .height(32)
      .padding({ left: 12, right: 12 })
      .border({ width: { top: 1 }, color: Theme.colorBorder() })
    }
    .width('100%')
    .height('100%')
    .backgroundColor(Theme.colorBackground())
  }

  /** Total table width = number of columns × 160px (web min column size). */
  private tableWidth(): number {
    const df = this.dataState.activeDataFrame;
    const n = df !== null ? df.colCount : 0;
    return Math.max(1, n) * 160;
  }

  @Builder
  headerCellBuilder(col: ColumnMetaShim, idx: number) {
    Column() {
      Row({ space: 4 }) {
        Text(col.name)
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
        Text(this.typeBadgeText(col.inferredType))
          .fontSize(10)
          .fontColor(this.typeBadgeColor(col.inferredType))
          .padding({ left: 6, right: 6, top: 1, bottom: 1 })
          .borderRadius(4)
          .backgroundColor(this.typeBadgeBg(col.inferredType))
      }
      .width(160)
      .padding({ left: 12, right: 12 })
      .onClick(() => {
        if (this.sortCol === col.name) {
          this.sortAsc = !this.sortAsc;
        } else {
          this.sortCol = col.name;
          this.sortAsc = true;
        }
        this.page = 0;
      })
    }
    .width(160)
    .justifyContent(FlexAlign.Center)
  }

  @Builder
  bodyRow(row: CellValue[], rIdx: number) {
    Row() {
      ForEach(this.dataState.activeDataFrame !== null ? this.dataState.activeDataFrame.columns : [], (col: ColumnMetaShim, cIdx: number) => {
        this.bodyCell(row, cIdx)
      }, (col: ColumnMetaShim, cIdx: number) => cIdx.toString())
    }
    .width('100%')
    .height(33)
    .backgroundColor(rIdx % 2 === 0 ? Theme.colorBackground() : Theme.colorSurface())
  }

  @Builder
  bodyCell(row: CellValue[], cIdx: number) {
    Text(row[cIdx] === null || row[cIdx] === undefined ? '—' : String(row[cIdx]))
      .fontSize(12)
      .fontColor(Theme.colorForeground())
      .width(160)
      .padding({ left: 12, right: 12 })
      .maxLines(1)
      .textOverflow({ overflow: TextOverflow.Ellipsis })
      .textAlign(TextAlign.Start)
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
