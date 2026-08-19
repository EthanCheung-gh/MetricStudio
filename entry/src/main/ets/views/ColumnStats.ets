import { Theme } from '../common/Theme';
import { fmt } from '../common/Format';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { computeAllColumnStats, ColumnStats } from '../engine/ColumnStats';

/**
 * Column stats panel (web: src/components/data/ColumnStats.tsx). Lists every
 * column with its inferred-type badge, dtype · unique count and numeric stats
 * (min/max/mean/sum) in a 2-column grid.
 */
@Component
export struct ColumnStatsPanel {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;

  private stats(): ColumnStats[] {
    const df = this.dataState.activeDataFrame;
    return df !== null ? computeAllColumnStats(df) : [];
  }

  private typeLabel(type: string): string {
    if (type === 'quantitative') {
      return 'num';
    }
    if (type === 'temporal') {
      return 'date';
    }
    return 'str';
  }

  build() {
    Column({ space: 8 }) {
      Text('Columns')
        .fontSize(12)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)

      if (this.dataState.activeDataFrame === null) {
        Text('No dataset selected.')
          .fontSize(12)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)
      }

      Scroll() {
        Column({ space: 4 }) {
          ForEach(this.stats(), (s: ColumnStats) => {
            this.statCard(s)
          }, (s: ColumnStats) => s.column)
        }
        .width('100%')
        .padding({ right: 2 })
      }
      .layoutWeight(1)
      .scrollBar(BarState.Auto)
      .align(Alignment.TopStart)
      .constraintSize({ maxHeight: 280 })
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurfaceElevated())
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  statCard(s: ColumnStats) {
    Column() {
      Row() {
        Text(s.column)
          .fontSize(12)
          .fontWeight(500)
          .fontColor(Theme.colorForeground())
          .maxLines(1)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .layoutWeight(1)
        Text(this.typeLabel(s.dtype === 'number' ? 'quantitative' : (s.dtype === 'date' ? 'temporal' : 'nominal')))
          .fontSize(10)
          .fontColor(Theme.colorMuted())
          .padding({ left: 6, right: 6, top: 1, bottom: 1 })
          .borderRadius(4)
          .backgroundColor(Theme.colorSurface())
      }
      .width('100%')

      Text(`${s.dtype} · ${s.uniqueCount} unique`)
        .fontSize(12)
        .fontColor(Theme.colorMuted())
        .width('100%')
        .margin({ top: 4 })

      if (s.dtype === 'number') {
        Column({ space: 2 }) {
          Row() {
            Text(`min: ${s.min !== null ? Number(s.min).toFixed(2) : '—'}`)
              .fontSize(10)
              .fontColor(Theme.colorMuted())
              .layoutWeight(1)
            Text(`max: ${s.max !== null ? Number(s.max).toFixed(2) : '—'}`)
              .fontSize(10)
              .fontColor(Theme.colorMuted())
              .layoutWeight(1)
          }
          .width('100%')
          Row() {
            Text(`mean: ${s.mean !== null ? Number(s.mean).toFixed(2) : '—'}`)
              .fontSize(10)
              .fontColor(Theme.colorMuted())
              .layoutWeight(1)
            Text(`sum: ${s.sum !== null ? fmt(Math.round(s.sum)) : '—'}`)
              .fontSize(10)
              .fontColor(Theme.colorMuted())
              .layoutWeight(1)
          }
          .width('100%')
        }
        .width('100%')
        .margin({ top: 4 })
      }
    }
    .width('100%')
    .padding(8)
    .borderRadius(6)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Start)
  }
}
