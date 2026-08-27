import { promptAction } from '@kit.ArkUI';
import { LengthMetrics } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { fmt } from '../common/Format';
import { Settings } from '../common/Settings';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { SqlQueryResult, mirrorDatasets, resultToDataFrame, runQuery, safeTableName } from '../engine/SqlEngine';

const HISTORY_LIMIT = 50;
const UI_MAX_ROWS = 200;

/** Chip shim for the mirrored-table list. */
interface TableChip {
  table: string;
  source: string;
}

/**
 * SQL workbench (web: SqlWorkbench.tsx + backend query_engine.py). Mirrors all
 * datasets into the system SQLite store, runs one validated read-only SELECT,
 * shows a paged result table and can save the result as a new dataset.
 */
@Component
export struct SqlWorkbench {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @State sqlText: string = '';
  @State tables: TableChip[] = [];
  @State mirrorReady: boolean = false;
  @State busy: boolean = false;
  @State result: SqlQueryResult | null = null;
  @State history: string[] = [];
  @State showHistory: boolean = false;

  aboutToAppear(): void {
    this.history = Settings.loadSqlHistory();
    this.mirror();
  }

  /** Mirror all datasets into SQLite (web: rebuild :memory: per connection). */
  private async mirror(): Promise<void> {
    this.busy = true;
    const ok = await mirrorDatasets(getContext(this), this.dataState.dataFrames);
    const chips: TableChip[] = [];
    if (ok) {
      const frames = this.dataState.dataFrames;
      for (let i = 0; i < frames.length; i++) {
        chips.push({ table: safeTableName(i, frames[i].name), source: frames[i].name });
      }
    } else {
      promptAction.showToast({ message: l10n(this.workspaceState.language, 'SQL 环境初始化失败', 'SQLite init failed') });
    }
    this.tables = chips;
    this.mirrorReady = ok;
    this.busy = false;
  }

  private async run(): Promise<void> {
    if (this.busy || this.sqlText.trim().length === 0) {
      return;
    }
    this.busy = true;
    const res = await runQuery(getContext(this), this.sqlText);
    this.result = res;
    if (res.ok) {
      this.pushHistory(this.sqlText.trim());
    }
    this.busy = false;
  }

  private pushHistory(sql: string): void {
    const next: string[] = [sql];
    for (let i = 0; i < this.history.length && next.length < HISTORY_LIMIT; i++) {
      if (this.history[i] !== sql) {
        next.push(this.history[i]);
      }
    }
    this.history = next;
    Settings.saveSqlHistory(JSON.stringify(next));
  }

  private clearHistory(): void {
    this.history = [];
    Settings.saveSqlHistory('[]');
  }

  private insertTable(table: string): void {
    this.sqlText = (this.sqlText.length > 0 && !this.sqlText.endsWith(' ') ? this.sqlText + ' ' : this.sqlText)
      + table + ' ';
  }

  /** Save the last result grid as a new dataset (web: importSqlResult). */
  private saveResult(): void {
    const res = this.result;
    if (res === null || !res.ok || res.columns.length === 0) {
      return;
    }
    const name = l10n(this.workspaceState.language, 'SQL 结果', 'SQL result')
      + ' ' + new Date().toISOString().substring(11, 19).replace(/:/g, '');
    this.dataState.importDataFrame(resultToDataFrame(res.columns, res.rows, name));
    promptAction.showToast({ message: t(this.workspaceState.language, 'sql.saved') });
  }

  build() {
    Stack() {
      // Dim backdrop (tap to close)
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.workspaceState.setSqlOpen(false);
        })

      Column({ space: 8 }) {
        // Header
        Row() {
          Text(t(this.workspaceState.language, 'sql.title'))
            .fontSize(14)
            .fontWeight(600)
            .fontColor(Theme.colorForeground())
          Blank()
          Text('×')
            .fontSize(16)
            .fontColor(Theme.colorMuted())
            .padding(4)
            .onClick(() => {
              this.workspaceState.setSqlOpen(false);
            })
        }
        .width('100%')

        // Mirrored table chips (tap to insert)
        if (this.tables.length > 0) {
          Text(t(this.workspaceState.language, 'sql.tables'))
            .fontSize(11)
            .fontWeight(600)
            .fontColor(Theme.colorMuted())
            .alignSelf(ItemAlign.Start)
          Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
            ForEach(this.tables, (chip: TableChip) => {
              Button() {
                Text(chip.table)
                  .fontSize(11)
                  .fontColor(Theme.colorForeground())
              }
              .type(ButtonType.Normal)
              .height(24)
              .padding({ left: 8, right: 8 })
              .backgroundColor(Theme.colorSurface())
              .borderRadius(8)
              .border({ width: 1, color: Theme.colorBorder() })
              .onClick(() => {
                this.insertTable(chip.table);
              })
            }, (chip: TableChip) => chip.table)
          }
          .width('100%')
        } else if (this.mirrorReady) {
          Text(t(this.workspaceState.language, 'sql.empty'))
            .fontSize(11)
            .fontColor(Theme.colorMuted())
            .alignSelf(ItemAlign.Start)
        }

        // SQL editor
        TextArea({ placeholder: t(this.workspaceState.language, 'sql.placeholder'), text: this.sqlText })
          .width('100%')
          .height(88)
          .fontSize(13)
          .fontColor(Theme.colorForeground())
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onChange((v: string) => {
            this.sqlText = v;
          })

        // Actions
        Row({ space: 8 }) {
          Button() {
            Text(t(this.workspaceState.language, 'sql.run'))
              .fontSize(12)
              .fontColor(Color.White)
          }
          .height(28)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.primary)
          .borderRadius(6)
          .enabled(!this.busy)
          .onClick(() => {
            this.run();
          })
          Button() {
            Text(t(this.workspaceState.language, 'sql.history'))
              .fontSize(11)
              .fontColor(this.showHistory ? Theme.primary : Theme.colorMuted())
          }
          .type(ButtonType.Normal)
          .height(28)
          .padding({ left: 10, right: 10 })
          .backgroundColor(this.showHistory ? Theme.primaryDim : Color.Transparent)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .onClick(() => {
            this.showHistory = !this.showHistory;
          })
          Blank()
          if (this.result !== null && this.result.ok) {
            Button() {
              Text(t(this.workspaceState.language, 'sql.saveResult'))
                .fontSize(11)
                .fontColor(Color.White)
            }
            .height(28)
            .padding({ left: 12, right: 12 })
            .backgroundColor(Theme.primary)
            .borderRadius(6)
            .onClick(() => {
              this.saveResult();
            })
          }
        }
        .width('100%')

        // History list
        if (this.showHistory) {
          Column({ space: 2 }) {
            Row() {
              Blank()
              Text(t(this.workspaceState.language, 'sql.clearHistory'))
                .fontSize(11)
                .fontColor(Theme.colorMuted())
                .padding(4)
                .onClick(() => {
                  this.clearHistory();
                })
            }
            .width('100%')
            List({ space: 2 }) {
              ForEach(this.history, (item: string, idx: number) => {
                ListItem() {
                  Text(item)
                    .fontSize(11)
                    .fontColor(Theme.colorForeground())
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .width('100%')
                    .padding({ left: 8, right: 8, top: 5, bottom: 5 })
                    .borderRadius(4)
                    .backgroundColor(Theme.colorSurface())
                    .onClick(() => {
                      this.sqlText = item;
                    })
                }
              }, (item: string, idx: number) => idx.toString() + '_' + item)
            }
            .height(88)
            .scrollBar(BarState.Auto)
          }
          .width('100%')
          .padding(6)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurfaceElevated())
        }

        // Result meta / error
        if (this.result !== null) {
          if (this.result.ok) {
            Row({ space: 8 }) {
              Text(fmt(this.result.rows.length) + ' ' + t(this.workspaceState.language, 'status.rows')
                + ' · ' + this.result.columns.length.toString() + ' ' + t(this.workspaceState.language, 'status.cols')
                + ' · ' + this.result.elapsedMs.toString() + 'ms')
                .fontSize(11)
                .fontColor(Theme.colorMuted())
              if (this.result.truncated) {
                Text(t(this.workspaceState.language, 'sql.truncated'))
                  .fontSize(10)
                  .fontColor(Theme.warning)
                  .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                  .borderRadius(4)
                  .backgroundColor(Theme.colorSurface())
              }
              Blank()
            }
            .width('100%')
          } else {
            Text(this.result.error)
              .fontSize(11)
              .fontColor(Theme.danger)
              .width('100%')
              .padding(8)
              .borderRadius(6)
              .border({ width: 1, color: Theme.danger })
              .backgroundColor(Theme.colorSurface())
          }
        }

        // Result grid (web renders at most 200 rows)
        if (this.result !== null && this.result.ok && this.result.columns.length > 0) {
          Scroll() {
            Column() {
              Row() {
                ForEach(this.resultColumns(), (col: string) => {
                  Text(col)
                    .fontSize(12)
                    .fontWeight(600)
                    .fontColor(Theme.colorForeground())
                    .width(140)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                    .padding({ left: 8, right: 8 })
                }, (col: string) => col)
              }
              .width(this.gridWidth())
              .height(30)
              .backgroundColor(Theme.colorSurface())
              .border({ width: { bottom: 1 }, color: Theme.colorBorder() })
              .alignItems(VerticalAlign.Center)

              ForEach(this.uiRows(), (row: string[], rIdx: number) => {
                Row() {
                  ForEach(row, (cell: string, cIdx: number) => {
                    Text(cell)
                      .fontSize(12)
                      .fontColor(Theme.colorForeground())
                      .width(140)
                      .maxLines(1)
                      .textOverflow({ overflow: TextOverflow.Ellipsis })
                      .padding({ left: 8, right: 8 })
                  }, (cell: string, cIdx: number) => cIdx.toString() + '_' + cell)
                }
                .width(this.gridWidth())
                .height(28)
                .backgroundColor(rIdx % 2 === 0 ? Theme.colorBackground() : Theme.colorSurface())
              }, (row: string[], rIdx: number) => rIdx.toString())
            }
          }
          .layoutWeight(1)
          .scrollable(ScrollDirection.Horizontal)
          .scrollBar(BarState.Auto)
          .align(Alignment.TopStart)
          .border({ width: 1, color: Theme.colorBorder() })
          .borderRadius(6)
        }
      }
      .width(720)
      .constraintSize({ maxWidth: '94%', maxHeight: '94%' })
      .height(560)
      .padding(12)
      .borderRadius(12)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .shadow({ radius: 32, color: 'rgba(0,0,0,0.5)', offsetY: 8 })
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
  }

  private uiRows(): string[][] {
    const res = this.result;
    if (res === null || !res.ok) {
      return [];
    }
    const out: string[][] = [];
    const n = Math.min(UI_MAX_ROWS, res.rows.length);
    for (let r = 0; r < n; r++) {
      const cells: string[] = [];
      for (let c = 0; c < res.columns.length; c++) {
        const v = res.rows[r][c];
        cells.push(v === null || v === undefined ? '—' : String(v));
      }
      out.push(cells);
    }
    return out;
  }

  private resultColumns(): string[] {
    const res = this.result;
    return res !== null && res.ok ? res.columns : [];
  }

  private gridWidth(): number {
    const res = this.result;
    return res !== null && res.ok ? res.columns.length * 140 : 0;
  }
}
