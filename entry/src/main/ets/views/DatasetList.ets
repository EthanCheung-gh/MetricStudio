import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { fmt } from '../common/Format';
import { DataFrame } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';

/**
 * Dataset list (web: src/components/data/DatasetList.tsx). Shows all imported
 * datasets; click to activate, delete button per row, rows-count badge.
 */
@Component
export struct DatasetList {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;

  build() {
    Column() {
      Row() {
        Text(t(this.workspaceState.language, 'nav.datasets'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
      }
      .width('100%')
      .margin({ bottom: 8 })

      if (this.dataState.dataFrames.length === 0) {
        Text(t(this.workspaceState.language, 'dataset.empty'))
          .fontSize(12)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)
      }

      Column() {
        ForEach(this.dataState.dataFrames, (df: DataFrame, idx: number) => {
          this.datasetRow(df, idx)
        }, (df: DataFrame, idx: number) => idx.toString() + '_' + df.name)
      }
      .width('100%')
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurfaceElevated())
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  datasetRow(df: DataFrame, idx: number) {
    Row({ space: 8 }) {
      SymbolGlyph($r('sys.symbol.externaldrive'))
        .fontSize(14)
        .fontColor([this.dataState.activeIndex === idx ? Theme.primary : Theme.colorMuted()])
      Text(df.name)
        .fontSize(12)
        .fontColor(this.dataState.activeIndex === idx ? Theme.primary : Theme.colorForeground())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
        .layoutWeight(1)
      Text(fmt(df.rowCount))
        .fontSize(10)
        .fontColor(Theme.colorMuted())
        .padding({ left: 6, right: 6, top: 1, bottom: 1 })
        .borderRadius(4)
        .backgroundColor(Theme.colorSurface())
      SymbolGlyph($r('sys.symbol.trash'))
        .fontSize(14)
        .fontColor([Theme.colorMuted()])
        .padding(2)
        .onClick(() => {
          this.dataState.removeDataFrame(idx);
        })
    }
    .width('100%')
    .height(30)
    .padding({ left: 8, right: 4 })
    .borderRadius(6)
    .backgroundColor(this.dataState.activeIndex === idx ? Theme.primaryDim : Color.Transparent)
    .onClick(() => {
      this.dataState.setActive(idx);
    })
  }
}
