import { picker, fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { common } from '@kit.AbilityKit';
import { webview } from '@kit.ArkWeb';
import { promptAction, LengthMetrics } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { CellValue } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { parseCsvText } from '../engine/CsvParser';
import { SheetParse, matrixToDataFrame, parseXlsxReply } from '../engine/ExcelBridge';
import { listSqliteTables, readSqliteTable, resultToDataFrame } from '../engine/SqlEngine';

/**
 * Data explorer (web: src/components/data/DataExplorer.tsx). Card with an
 * import-mode switch (文件 / SQLite / 粘贴): csv/txt parsed locally, xlsx/xls
 * via the SheetJS WebView bridge (multi-sheet select + merge), SQLite files
 * opened through the system relationalStore (web /sql/import), paste form.
 */
@Component
export struct DataExplorer {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State importMode: string = 'file';
  @State pasteText: string = '';
  @State pasteName: string = '';
  // Excel bridge state (hidden WebView + SheetJS)
  private xController: webview.WebviewController = new webview.WebviewController();
  private xReady: boolean = false;
  @State workbookB64: string = '';
  @State pendingName: string = '';
  @State sheetNames: string[] = [];
  @State currentSheet: string = '';
  @State mergeSheets: boolean = false;
  // SQLite file import
  @State sqliteTables: string[] = [];
  @State sqliteDbName: string = '';
  @State sqliteBusy: boolean = false;

  private importText(name: string, text: string): void {
    if (text.trim().length === 0) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
      return;
    }
    const result = parseCsvText(text, name);
    if (!result.ok || result.dataFrame === null) {
      promptAction.showToast({ message: result.error.length > 0 ? result.error : t(this.workspaceState.language, 'data.parseError') });
      return;
    }
    this.dataState.importDataFrame(result.dataFrame);
    this.pasteText = '';
    this.pasteName = '';
  }

  private importMatrix(name: string, parsed: SheetParse): void {
    const df = matrixToDataFrame(name, parsed.rows);
    if (df === null) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
      return;
    }
    this.dataState.importDataFrame(df);
  }

  /** Parse one sheet of the cached workbook via the bridge. */
  private async parseMatrix(sheet: string): Promise<SheetParse> {
    const arg = JSON.stringify(sheet);
    const reply = await this.xController.runJavaScript('parseXlsxBase64("' + this.workbookB64 + '", ' + arg + ')');
    return parseXlsxReply(reply);
  }

  private async parseSheet(sheet: string): Promise<void> {
    if (this.workbookB64.length === 0) {
      return;
    }
    try {
      const parsed = await this.parseMatrix(sheet);
      this.sheetNames = parsed.sheetNames;
      this.currentSheet = parsed.sheet;
      if (!parsed.ok) {
        promptAction.showToast({ message: parsed.error.length > 0 ? parsed.error : t(this.workspaceState.language, 'data.parseError') });
        return;
      }
      // merged mode imports all sheets together instead (importMerged)
      if (!(this.mergeSheets && this.sheetNames.length > 1)) {
        this.importMatrix(this.pendingName, parsed);
      }
    } catch (e) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
    }
  }

  /** web mergeSheets: concatenate every sheet under the first sheet's header. */
  private async importMerged(): Promise<void> {
    try {
      let header: CellValue[] | null = null;
      const body: CellValue[][] = [];
      for (let s = 0; s < this.sheetNames.length; s++) {
        const parsed = await this.parseMatrix(this.sheetNames[s]);
        if (!parsed.ok || parsed.rows.length === 0) {
          continue;
        }
        if (header === null) {
          header = parsed.rows[0];
        }
        const width = header.length;
        for (let r = 1; r < parsed.rows.length; r++) {
          const src = parsed.rows[r];
          const row: CellValue[] = [];
          for (let c = 0; c < width; c++) {
            row.push(c < src.length ? src[c] : null);
          }
          body.push(row);
        }
      }
      if (header === null) {
        promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
        return;
      }
      const merged: CellValue[][] = [header].concat(body);
      const df = matrixToDataFrame(this.pendingName, merged);
      if (df === null) {
        promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
        return;
      }
      this.dataState.importDataFrame(df);
    } catch (e) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
    }
  }

  /** xlsx/xls path: file bytes → base64 → SheetJS bridge → DataFrame. */
  private async importExcel(name: string, bytes: Uint8Array): Promise<void> {
    if (!this.xReady) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
      return;
    }
    try {
      this.workbookB64 = new util.Base64Helper().encodeToStringSync(bytes);
      this.pendingName = name;
      await this.parseSheet('');
      if (this.mergeSheets && this.sheetNames.length > 1) {
        await this.importMerged();
      }
    } catch (e) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
    }
  }

  /** SQLite path: copy file into sandbox → list tables (web /sql/upload + /sql/tables). */
  private async pickSqlite(): Promise<void> {
    try {
      this.sqliteBusy = true;
      const documentPicker = new picker.DocumentViewPicker(getContext(this));
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;
      options.fileSuffixFilters = ['.db', '.sqlite', '.sqlite3', '.db3'];
      const uris = await documentPicker.select(options);
      if (uris.length === 0) {
        this.sqliteBusy = false;
        return;
      }
      const uri = uris[0];
      const file = fs.openSync(uri, 0o0); // OpenMode.READ_ONLY
      const stat = fs.statSync(file.fd);
      const buffer = new ArrayBuffer(stat.size);
      fs.readSync(file.fd, buffer);
      fs.closeSync(file);
      const ctx = getContext(this) as common.UIAbilityContext;
      const dbName = 'import_' + Date.now().toString() + '.db';
      const out = fs.openSync(ctx.databaseDir + '/' + dbName,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
      fs.writeSync(out.fd, buffer);
      fs.closeSync(out);
      const tables = await listSqliteTables(ctx, dbName);
      if (tables.length === 0) {
        this.sqliteBusy = false;
        promptAction.showToast({ message: l10n(this.workspaceState.language, '库中没有数据表', 'No tables in database') });
        return;
      }
      this.sqliteDbName = dbName;
      this.sqliteTables = tables;
      this.sqliteBusy = false;
    } catch (e) {
      this.sqliteBusy = false;
      promptAction.showToast({ message: l10n(this.workspaceState.language, 'SQLite 打开失败', 'Failed to open SQLite file') });
    }
  }

  /** Import one table of the opened SQLite file as a dataset (web /sql/import). */
  private async importSqliteTable(table: string): Promise<void> {
    try {
      const ctx = getContext(this) as common.UIAbilityContext;
      const data = await readSqliteTable(ctx, this.sqliteDbName, table);
      if (!data.ok) {
        promptAction.showToast({ message: data.error.length > 0 ? data.error : t(this.workspaceState.language, 'data.parseError') });
        return;
      }
      const base = this.sqliteDbName.replace(/^import_/, '').replace(/\.db$/, '');
      this.dataState.importDataFrame(resultToDataFrame(data.columns, data.rows, base + '_' + table));
      if (data.truncated) {
        promptAction.showToast({ message: l10n(this.workspaceState.language, '行数较多，已截断至 20 万行', 'Truncated at 200000 rows') });
      }
    } catch (e) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
    }
  }

  private async pickFile(): Promise<void> {
    try {
      const documentPicker = new picker.DocumentViewPicker(getContext(this));
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;
      options.fileSuffixFilters = ['.csv', '.txt', '.xlsx', '.xls'];
      const uris = await documentPicker.select(options);
      if (uris.length === 0) {
        return;
      }
      const uri = uris[0];
      const file = fs.openSync(uri, 0o0); // OpenMode.READ_ONLY
      const stat = fs.statSync(file.fd);
      const buffer = new ArrayBuffer(stat.size);
      fs.readSync(file.fd, buffer);
      fs.closeSync(file);
      const base = uri.substring(uri.lastIndexOf('/') + 1);
      const lower = base.toLowerCase();
      const stem = base.replace(/\.(xlsx|xls|csv|txt)$/i, '');
      const name = stem.length > 0 ? stem : t(this.workspaceState.language, 'data.pasteName');
      if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        await this.importExcel(name, new Uint8Array(buffer));
      } else {
        const decoder = util.TextDecoder.create('utf-8');
        const text = decoder.decodeToString(new Uint8Array(buffer));
        this.importText(name, text);
      }
    } catch (e) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
    }
  }

  private handlePasteImport(): void {
    if (this.pasteText.trim().length === 0) {
      return;
    }
    const name = this.pasteName.trim().length > 0
      ? this.pasteName.trim()
      : t(this.workspaceState.language, 'data.pasteName');
    this.importText(name, this.pasteText);
  }

  private sheetOptions(): SelectOption[] {
    const opts: SelectOption[] = [];
    for (let i = 0; i < this.sheetNames.length; i++) {
      opts.push({ value: this.sheetNames[i] });
    }
    return opts;
  }

  private sheetIndex(name: string): number {
    for (let i = 0; i < this.sheetNames.length; i++) {
      if (this.sheetNames[i] === name) {
        return i;
      }
    }
    return 0;
  }

  build() {
    Stack() {
      Column({ space: 8 }) {
        Text(t(this.workspaceState.language, 'import.title'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)

        // Mode switch (web: file / sqlite / paste)
        Row({ space: 4 }) {
          this.modeButton('file', t(this.workspaceState.language, 'import.file'))
          this.modeButton('sqlite', 'SQLite')
          this.modeButton('paste', t(this.workspaceState.language, 'import.paste'))
        }
        .width('100%')

        if (this.importMode === 'file') {
          // Drop-zone style picker (no real drag&drop — tap to pick a file)
          Column({ space: 6 }) {
            SymbolGlyph($r('sys.symbol.upload'))
              .fontSize(24)
              .fontColor([Theme.colorMuted()])
            Text(t(this.workspaceState.language, 'import.dropHint'))
              .fontSize(12)
              .fontColor(Theme.colorMuted())
            Text(t(this.workspaceState.language, 'import.clickBrowse'))
              .fontSize(11)
              .fontColor(Theme.primary)
          }
          .width('100%')
          .padding(16)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .borderStyle(BorderStyle.Dashed)
          .onClick(() => {
            this.pickFile();
          })

          // Sheet switch for multi-sheet workbooks (web mergeSheets subset)
          if (this.sheetNames.length > 1) {
            Row({ space: 6 }) {
              Text(t(this.workspaceState.language, 'data.sheet'))
                .fontSize(11)
                .fontColor(Theme.colorMuted())
              Select(this.sheetOptions())
                .selected(this.sheetIndex(this.currentSheet))
                .value(this.currentSheet.length > 0 ? this.currentSheet : this.sheetNames[0])
                .font({ size: 12 })
                .height(28)
                .layoutWeight(1)
                .backgroundColor(Theme.colorSurface())
                .borderRadius(6)
                .onSelect((index: number, value: string) => {
                  if (value !== this.currentSheet) {
                    this.currentSheet = value;
                    this.parseSheet(value);
                  }
                })
            }
            .width('100%')
            Button() {
              Text(l10n(this.workspaceState.language,
                (this.mergeSheets ? '✓ ' : '') + '合并全部工作表',
                (this.mergeSheets ? '✓ ' : '') + 'Merge all sheets'))
                .fontSize(11)
                .fontColor(this.mergeSheets ? Theme.primary : Theme.colorMuted())
            }
            .type(ButtonType.Normal)
            .height(26)
            .padding({ left: 10, right: 10 })
            .backgroundColor(this.mergeSheets ? Theme.primaryDim : Color.Transparent)
            .borderRadius(10)
            .border({ width: 1, color: this.mergeSheets ? Theme.primary : Theme.colorBorder() })
            .margin({ top: 2 })
            .onClick(() => {
              this.mergeSheets = !this.mergeSheets;
            })
          }
        } else if (this.importMode === 'sqlite') {
          Column({ space: 6 }) {
            SymbolGlyph($r('sys.symbol.externaldrive'))
              .fontSize(20)
              .fontColor([Theme.colorMuted()])
            Text(l10n(this.workspaceState.language,
              '选择 SQLite 数据库文件（.db / .sqlite / .sqlite3 / .db3），导入其中的表',
              'Pick a SQLite database file (.db/.sqlite/.sqlite3/.db3) and import its tables'))
              .fontSize(11)
              .fontColor(Theme.colorMuted())
              .textAlign(TextAlign.Center)
            Button() {
              Text(l10n(this.workspaceState.language, '浏览数据库文件', 'Browse database file'))
                .fontSize(12)
                .fontColor(Theme.colorMuted())
            }
            .type(ButtonType.Normal)
            .height(28)
            .padding({ left: 12, right: 12 })
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .enabled(!this.sqliteBusy)
            .onClick(() => {
              this.pickSqlite();
            })
            if (this.sqliteBusy) {
              Row({ space: 6 }) {
                LoadingProgress()
                  .width(14)
                  .height(14)
                  .color(Theme.primary)
                Text(l10n(this.workspaceState.language, '正在读取…', 'Reading…'))
                  .fontSize(11)
                  .fontColor(Theme.colorMuted())
              }
            }
            if (this.sqliteTables.length > 0) {
              Text(l10n(this.workspaceState.language, '点击数据表导入', 'Tap a table to import'))
                .fontSize(11)
                .fontColor(Theme.colorMuted())
                .alignSelf(ItemAlign.Start)
              Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
                ForEach(this.sqliteTables, (table: string) => {
                  Button() {
                    Text(table)
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
                    this.importSqliteTable(table);
                  })
                }, (table: string) => table)
              }
              .width('100%')
            }
          }
          .width('100%')
          .padding(16)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
        } else {
          Column({ space: 6 }) {
            TextInput({ placeholder: t(this.workspaceState.language, 'data.pasteName'), text: this.pasteName })
              .width('100%')
              .height(30)
              .padding({ top: 0, bottom: 0 })
              .placeholderFont({ size: 12 })
              .fontSize(12)
              .onChange((v: string) => {
                this.pasteName = v;
              })
            TextArea({ placeholder: t(this.workspaceState.language, 'data.pastePlaceholder'), text: this.pasteText })
              .width('100%')
              .height(90)
              .fontSize(12)
              .onChange((v: string) => {
                this.pasteText = v;
              })
            Button() {
              Text(t(this.workspaceState.language, 'data.pasteImport'))
                .fontSize(12)
                .fontColor(Color.White)
            }
            .width('100%')
            .height(30)
            .backgroundColor(Theme.primary)
            .borderRadius(6)
            .onClick(() => {
              this.handlePasteImport();
            })
          }
          .width('100%')
        }
      }
      .width('100%')
      .padding(12)
      .borderRadius(8)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .alignItems(HorizontalAlign.Start)

      // Hidden SheetJS bridge (1×1, offscreen; runs xlsx.full.min.js offline)
      Web({ src: $rawfile('xlsx_bridge.html'), controller: this.xController })
        .width(1)
        .height(1)
        .opacity(0)
        .javaScriptAccess(true)
        .onPageEnd(() => {
          this.xReady = true;
        })
    }
    .width('100%')
  }

  @Builder
  modeButton(mode: string, label: string) {
    Button() {
      Text(label)
        .fontSize(12)
        .fontColor(this.importMode === mode ? Theme.primary : Theme.colorMuted())
    }
    .type(ButtonType.Normal)
    .layoutWeight(1)
    .height(28)
    .backgroundColor(this.importMode === mode ? Theme.primaryDim : Color.Transparent)
    .borderRadius(6)
    .onClick(() => {
      this.importMode = mode;
    })
  }
}
