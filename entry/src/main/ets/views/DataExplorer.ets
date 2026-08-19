import { picker, fileIo as fs } from '@kit.CoreFileKit';
import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { SampleData } from '../engine/SampleData';
import { parseCsvText } from '../engine/CsvParser';

/**
 * Data explorer / importer (web: src/components/data/DataExplorer.tsx subset).
 * Three entry points: pick a CSV file, paste CSV/TSV text, or load the sample.
 */
@Component
export struct DataExplorer {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State pasteOpen: boolean = false;
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
    this.pasteOpen = false;
    this.pasteText = '';
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
      const text = fs.readTextSync(file.fd);
      fs.closeSync(file);
      const base = uri.substring(uri.lastIndexOf('/') + 1);
      const name = base.length > 0 ? base : t(this.workspaceState.language, 'data.pasteName');
      this.importText(name, text);
    } catch (e) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'data.parseError') });
    }
  }

  build() {
    Column({ space: 8 }) {
      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.doc_plaintext'))
          .fontSize(16)
          .fontColor([Theme.primary])
        Text(t(this.workspaceState.language, 'data.importCsv'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
      }
      .width('100%')
      .height(36)
      .padding({ left: 12, right: 12 })
      .borderRadius(6)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .onClick(() => {
        this.pickCsv();
      })

      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.doc_zipper'))
          .fontSize(16)
          .fontColor([Theme.primary])
        Text(t(this.workspaceState.language, 'data.importPaste'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
      }
      .width('100%')
      .height(36)
      .padding({ left: 12, right: 12 })
      .borderRadius(6)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .onClick(() => {
        this.pasteOpen = !this.pasteOpen;
      })

      if (this.pasteOpen) {
        TextInput({ placeholder: t(this.workspaceState.language, 'data.pasteName') })
          .width('100%')
          .height(32)
          .fontSize(12)
          .onChange((v: string) => {
            this.pasteName = v;
          })
        TextArea({ placeholder: t(this.workspaceState.language, 'data.pastePlaceholder') })
          .width('100%')
          .height(120)
          .fontSize(12)
          .onChange((v: string) => {
            this.pasteText = v;
          })
        Button() {
          Text(t(this.workspaceState.language, 'data.pasteImport'))
            .fontSize(12)
            .fontColor(Color.White)
        }
        .height(32)
        .backgroundColor(Theme.primary)
        .borderRadius(6)
        .onClick(() => {
          const name = this.pasteName.trim().length > 0 ? this.pasteName.trim() : t(this.workspaceState.language, 'data.pasteName');
          this.importText(name, this.pasteText);
        })
      }

      Row({ space: 8 }) {
        SymbolGlyph($r('sys.symbol.wand_and_stars'))
          .fontSize(16)
          .fontColor([Theme.primary])
        Text(t(this.workspaceState.language, 'data.importSample'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
      }
      .width('100%')
      .height(36)
      .padding({ left: 12, right: 12 })
      .borderRadius(6)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .onClick(() => {
        this.importText(SampleData.NAME, SampleData.CSV_TEXT);
      })
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurfaceElevated())
    .alignItems(HorizontalAlign.Start)
  }
}
