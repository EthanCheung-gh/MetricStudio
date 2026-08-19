import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { TransformOp } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { Language, WorkspaceState } from '../model/WorkspaceState';

const OP_DEDUPE = 'dedupe';
const OP_FILL = 'fillMissing';
const OP_CONVERT = 'convertType';
const OP_SORT = 'sort';
const OP_FILTER = 'filter';
const OP_RENAME = 'rename';
const OP_AGGREGATE = 'aggregate';
const OP_COMPUTE = 'compute';
const OP_DROP = 'dropCol';

/**
 * Transform panel (web: src/components/data/TransformPanel.tsx + CleaningPanel).
 * Operator select + minimal param form; Apply mutates the active dataset,
 * Undo replays history. Largely covers the ops implemented in TransformOps.
 */
@Component
export struct TransformPanel {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State op: string = OP_DEDUPE;
  @State col: string = '';
  @State col2: string = '';
  @State value: string = '';
  @State agg: string = 'sum';
  @State newName: string = '';

  private columns(): string[] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    const out: string[] = [];
    for (let i = 0; i < df.columns.length; i++) {
      out.push(df.columns[i].name);
    }
    return out;
  }

  private run(): void {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'transform.noData') });
      return;
    }
    if (this.op === OP_DEDUPE) {
      this.runOp(new TransformOp(OP_DEDUPE, JSON.stringify({ columns: null })));
      return;
    }
    if (this.op === OP_DROP) {
      if (this.col.length === 0) {
        return;
      }
      this.runOp(new TransformOp(OP_DROP, JSON.stringify({ columns: [this.col] })));
      return;
    }
    if (this.col.length === 0) {
      return;
    }
    switch (this.op) {
      case OP_FILL:
        this.runOp(new TransformOp(OP_FILL, JSON.stringify({ column: this.col, value: this.value })));
        break;
      case OP_CONVERT:
        this.runOp(new TransformOp(OP_CONVERT, JSON.stringify({ column: this.col, target: 'number' })));
        break;
      case OP_SORT:
        this.runOp(new TransformOp(OP_SORT, JSON.stringify({ column: this.col, ascending: true })));
        break;
      case OP_FILTER:
        if (this.value.length === 0) {
          return;
        }
        this.runOp(new TransformOp(OP_FILTER, JSON.stringify({ column: this.col, operator: 'eq', value: this.value })));
        break;
      case OP_RENAME:
        if (this.newName.length === 0) {
          return;
        }
        this.runOp(new TransformOp(OP_RENAME, JSON.stringify({ oldName: this.col, newName: this.newName })));
        break;
      case OP_AGGREGATE:
        if (this.col2.length === 0) {
          return;
        }
        this.runOp(new TransformOp(OP_AGGREGATE, JSON.stringify({ groupBy: this.col, column: this.col2, agg: this.agg })));
        break;
      case OP_COMPUTE:
        if (this.newName.length === 0) {
          return;
        }
        this.runOp(new TransformOp(OP_COMPUTE, JSON.stringify({ name: this.newName, sourceColumn: this.col, operation: 'abs' })));
        break;
      default:
        break;
    }
  }

  private runOp(op: TransformOp): void {
    const ok = this.dataState.applyTransform(op);
    if (!ok && this.dataState.lastError.length > 0) {
      promptAction.showToast({ message: this.dataState.lastError });
    }
  }

  build() {
    Column({ space: 8 }) {
      Row() {
        Text(t(this.workspaceState.language, 'transform.title'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
        Blank()
        if (this.dataState.transformHistory.length > 0) {
          Text(t(this.workspaceState.language, 'transform.undo'))
            .fontSize(12)
            .fontColor(Theme.primary)
            .onClick(() => {
              this.dataState.undo();
            })
        }
      }
      .width('100%')

      // Operator selector
      Scroll() {
        Row({ space: 4 }) {
          this.opChip(OP_DEDUPE, t(this.workspaceState.language, 'transform.dedupe'))
          this.opChip(OP_FILL, t(this.workspaceState.language, 'transform.fillMissing'))
          this.opChip(OP_CONVERT, t(this.workspaceState.language, 'transform.convertType'))
          this.opChip(OP_SORT, t(this.workspaceState.language, 'transform.sort'))
          this.opChip(OP_FILTER, t(this.workspaceState.language, 'transform.filter'))
          this.opChip(OP_RENAME, t(this.workspaceState.language, 'transform.rename'))
          this.opChip(OP_AGGREGATE, t(this.workspaceState.language, 'transform.aggregate'))
          this.opChip(OP_COMPUTE, t(this.workspaceState.language, 'transform.compute'))
          this.opChip(OP_DROP, t(this.workspaceState.language, 'transform.dropCol'))
        }
      }
      .width('100%')
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)

      // Column select
      if (this.op !== OP_DEDUPE) {
        this.columnSelect(this.col, (v: string) => {
          this.col = v;
        })
      }

      // Second column (aggregate)
      if (this.op === OP_AGGREGATE) {
        this.columnSelect(this.col2, (v: string) => {
          this.col2 = v;
        })
        Row({ space: 4 }) {
          this.aggChip('sum', t(this.workspaceState.language, 'chart.sum'))
          this.aggChip('mean', t(this.workspaceState.language, 'chart.mean'))
          this.aggChip('count', t(this.workspaceState.language, 'chart.count'))
          this.aggChip('min', t(this.workspaceState.language, 'chart.min'))
          this.aggChip('max', t(this.workspaceState.language, 'chart.max'))
        }
      }

      // Value input (fill/filter)
      if (this.op === OP_FILL || this.op === OP_FILTER) {
        TextInput({ placeholder: t(this.workspaceState.language, 'transform.value') })
          .width('100%')
          .height(32)
          .fontSize(12)
          .onChange((v: string) => {
            this.value = v;
          })
      }

      // Rename / compute new name
      if (this.op === OP_RENAME || this.op === OP_COMPUTE) {
        TextInput({ placeholder: t(this.workspaceState.language, 'chart.title') })
          .width('100%')
          .height(32)
          .fontSize(12)
          .onChange((v: string) => {
            this.newName = v;
          })
      }

      Button() {
        Text(t(this.workspaceState.language, 'transform.apply'))
          .fontSize(12)
          .fontColor(Color.White)
      }
      .width('100%')
      .height(32)
      .backgroundColor(this.dataState.hasData ? Theme.primary : Theme.colorMuted())
      .borderRadius(6)
      .enabled(this.dataState.hasData)
      .onClick(() => {
        this.run();
      })

      // History
      if (this.dataState.transformHistory.length > 0) {
        Column() {
          Text(t(this.workspaceState.language, 'transform.history'))
            .fontSize(11)
            .fontWeight(600)
            .fontColor(Theme.colorMuted())
            .alignSelf(ItemAlign.Start)
            .margin({ bottom: 4 })
          ForEach(this.dataState.transformHistory, (op: TransformOp, idx: number) => {
            Text(`${idx + 1}. ${op.type}`)
              .fontSize(11)
              .fontColor(Theme.colorMuted())
              .alignSelf(ItemAlign.Start)
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
          }, (op: TransformOp, idx: number) => idx.toString() + '_' + op.timestamp)
        }
        .width('100%')
        .alignItems(HorizontalAlign.Start)
      }
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurfaceElevated())
    .alignItems(HorizontalAlign.Start)
  }

  lang(): Language {
    return this.workspaceState.language;
  }

  @Builder
  opChip(opId: string, label: string) {
    Text(label)
      .fontSize(11)
      .fontColor(this.op === opId ? Theme.primary : Theme.colorMuted())
      .padding({ left: 10, right: 10, top: 4, bottom: 4 })
      .borderRadius(10)
      .backgroundColor(this.op === opId ? Theme.primaryDim : Color.Transparent)
      .border({ width: 1, color: this.op === opId ? Theme.primary : Theme.colorBorder() })
      .onClick(() => {
        this.op = opId;
      })
  }

  @Builder
  aggChip(aggId: string, label: string) {
    Text(label)
      .fontSize(11)
      .fontColor(this.agg === aggId ? Theme.primary : Theme.colorMuted())
      .padding({ left: 10, right: 10, top: 4, bottom: 4 })
      .borderRadius(10)
      .backgroundColor(this.agg === aggId ? Theme.primaryDim : Color.Transparent)
      .border({ width: 1, color: this.agg === aggId ? Theme.primary : Theme.colorBorder() })
      .onClick(() => {
        this.agg = aggId;
      })
  }

  @Builder
  columnSelect(selected: string, onChange: (v: string) => void) {
    Column() {
      Text(t(this.workspaceState.language, 'transform.column'))
        .fontSize(11)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
        .margin({ bottom: 4 })
      Scroll() {
        Row({ space: 4 }) {
          ForEach(this.columns(), (c: string) => {
            Text(c)
              .fontSize(11)
              .fontColor(selected === c ? Theme.primary : Theme.colorMuted())
              .padding({ left: 10, right: 10, top: 4, bottom: 4 })
              .borderRadius(10)
              .backgroundColor(selected === c ? Theme.primaryDim : Color.Transparent)
              .onClick(() => {
                onChange(c);
              })
          }, (c: string) => c)
        }
      }
      .width('100%')
      .scrollable(ScrollDirection.Horizontal)
      .scrollBar(BarState.Off)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }
}
