import { picker, fileIo as fs } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { parseCsvText } from '../engine/CsvParser';

/**
 * Data explorer (web: src/components/data/DataExplorer.tsx). Card with an
 * import-mode switch (文件 / SQLite / 粘贴), file picker zone, paste form.
 * SQLite mode is shown for parity but reports unavailable (no local SQL engine).
 */
@Component
export struct DataExplorer {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State importMode: string = 'file';
  @State pasteText: string = '';
  @State pasteName: string = '';

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

  private async pickCsv(): Promise<void> {
    try {
      const documentPicker = new picker.DocumentViewPicker(getContext(this));
      const options = new picker.DocumentSelectOptions();
      options.maxSelectNumber = 1;
      options.fileSuffixFilters = ['.csv', '.txt'];
      const uris = await documentPicker.select(options);
      if (uris.length === 0) {
        return;
      }
      const uri = uris[0];
      const file = fs.openSync(uri, 0o0); // OpenMode.READ_ONLY
      const stat = fs.statSync(file.fd);
      const buffer = new ArrayBuffer(stat.size);
      fs.readSync(file.fd, buffer);
      const decoder = util.TextDecoder.create('utf-8');
      const text = decoder.decodeToString(new Uint8Array(buffer));
      fs.closeSync(file);
      const base = uri.substring(uri.lastIndexOf('/') + 1);
      const name = base.length > 0 ? base : t(this.workspaceState.language, 'data.pasteName');
      this.importText(name, text);
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

  build() {
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
          this.pickCsv();
        })
      } else if (this.importMode === 'sqlite') {
        Column({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.externaldrive'))
            .fontSize(20)
            .fontColor([Theme.colorMuted()])
          Text('SQLite 导入需本地 SQL 引擎，当前版本暂不支持')
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
