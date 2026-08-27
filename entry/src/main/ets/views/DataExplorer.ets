import { picker, fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { webview } from '@kit.ArkWeb';
import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { parseCsvText } from '../engine/CsvParser';
import { SheetParse, matrixToDataFrame, parseXlsxReply } from '../engine/ExcelBridge';

/**
 * Data explorer (web: src/components/data/DataExplorer.tsx). Card with an
 * import-mode switch (文件 / SQLite / 粘贴), file picker zone (csv/txt parsed
 * locally; xlsx/xls via the SheetJS WebView bridge), paste form.
 * SQLite file import is shown for parity but reports unavailable (二期).
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

  /** Parse one sheet of the cached workbook (first sheet when sheet is ''). */
  private async parseSheet(sheet: string): Promise<void> {
    if (this.workbookB64.length === 0) {
      return;
    }
    try {
      const arg = JSON.stringify(sheet);
      const reply = await this.xController.runJavaScript('parseXlsxBase64("' + this.workbookB64 + '", ' + arg + ')');
      const parsed = parseXlsxReply(reply);
      this.sheetNames = parsed.sheetNames;
      this.currentSheet = parsed.sheet;
      if (!parsed.ok) {
        promptAction.showToast({ message: parsed.error.length > 0 ? parsed.error : t(this.workspaceState.language, 'data.parseError') });
        return;
      }
      this.importMatrix(this.pendingName, parsed);
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
          }
        } else if (this.importMode === 'sqlite') {
          Column({ space: 6 }) {
            SymbolGlyph($r('sys.symbol.externaldrive'))
              .fontSize(20)
              .fontColor([Theme.colorMuted()])
            Text('SQLite 文件导入为二期规划，SQL 工作台已可查询已导入数据集')
              .fontSize(11)
              .fontColor(Theme.colorMuted())
              .textAlign(TextAlign.Center)
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
