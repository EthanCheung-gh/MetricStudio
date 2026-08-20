import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { fmt } from '../common/Format';
import { DataFrame, TransformOp } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { computeQualityMetrics } from '../engine/ColumnStats';
import { parseNlOps } from '../engine/NlParser';

/**
 * AI command bar (web: src/components/ai/AICommandBar.tsx). Bottom-centered
 * floating pill: 清洗 (transform) / 提问 (ask) modes. 清洗 parses the phrase
 * into local transform ops shown in a result card (apply/cancel); 提问 answers
 * from local dataframe statistics. Only visible when a dataset is loaded.
 */
@Component
export struct AICommandBar {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @State mode: string = 'query'; // 'query' | 'ask'
  @State input: string = '';
  @State operations: TransformOp[] = [];
  @State answer: string = '';

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

  private matchingColumn(): string {
    const q = this.input.toLowerCase();
    const cols = this.columns();
    for (let i = 0; i < cols.length; i++) {
      if (q.indexOf(cols[i].toLowerCase()) >= 0) {
        return cols[i];
      }
    }
    return '';
  }

  private parseQueryOps(): TransformOp[] {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return [];
    }
    // Local NL → operation chain (web backend/api/nl.py without LLM)
    const nl = parseNlOps(df, this.input);
    const ops: TransformOp[] = [];
    for (let i = 0; i < nl.length; i++) {
      ops.push(new TransformOp(nl[i].type, nl[i].params));
    }
    return ops;
  }

  private firstNumeric(): string {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return '';
    }
    for (let i = 0; i < df.columns.length; i++) {
      if (df.columns[i].dtype === 'number') {
        return df.columns[i].name;
      }
    }
    return '';
  }

  private buildAnswer(): string {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return '请先导入数据集';
    }
    const q = this.input.toLowerCase();
    const m = computeQualityMetrics(df);
    let text = `该数据集「${df.name}」共 ${fmt(df.rowCount)} 行 × ${fmt(df.colCount)} 列。`;
    text += `缺失单元格 ${fmt(m.missingCells)} 个，重复行 ${fmt(m.duplicateRows)} 行。`;

    // Numeric column summary (web _build_data_context describe())
    if (q.indexOf('统计') >= 0 || q.indexOf('均值') >= 0 || q.indexOf('平均') >= 0
      || q.indexOf('最值') >= 0 || q.indexOf('statistics') >= 0 || q.indexOf('summary') >= 0) {
      for (let c = 0; c < df.columns.length; c++) {
        const col = df.columns[c];
        if (col.dtype !== 'number') {
          continue;
        }
        const idx = df.columnIndex(col.name);
        let sum = 0;
        let cnt = 0;
        let min: number | null = null;
        let max: number | null = null;
        for (let r = 0; r < df.rows.length; r++) {
          const v = df.rows[r][idx];
          if (v !== null && v !== undefined) {
            const num = Number(v);
            if (!Number.isNaN(num)) {
              sum += num;
              cnt++;
              if (min === null || num < min) {
                min = num;
              }
              if (max === null || num > max) {
                max = num;
              }
            }
          }
        }
        if (cnt > 0) {
          text += `「${col.name}」: min=${min !== null ? min.toFixed(2) : '—'}, max=${max !== null ? max.toFixed(2) : '—'}, mean=${(sum / cnt).toFixed(2)}。`;
        }
      }
    }

    // Sample rows (web sample rows)
    if (q.indexOf('样例') >= 0 || q.indexOf('示例') >= 0 || q.indexOf('sample') >= 0 || q.indexOf('前') >= 0) {
      const n = Math.min(3, df.rowCount);
      text += ' 前' + n + '行: ';
      for (let r = 0; r < n; r++) {
        const parts: string[] = [];
        for (let c = 0; c < Math.min(3, df.colCount); c++) {
          parts.push(df.columns[c].name + '=' + String(df.rows[r][c] ?? ''));
        }
        text += parts.join(', ') + '; ';
      }
    }
    return text;
  }

  private submit(): void {
    if (this.input.trim().length === 0) {
      return;
    }
    if (this.mode === 'query') {
      this.operations = this.parseQueryOps();
      this.answer = '';
      if (this.operations.length === 0) {
        promptAction.showToast({ message: '未识别出可执行的清洗操作' });
      }
    } else {
      this.answer = this.buildAnswer();
      this.operations = [];
    }
  }

  private applyOps(): void {
    let applied = 0;
    for (let i = 0; i < this.operations.length; i++) {
      if (this.dataState.applyTransform(this.operations[i])) {
        applied++;
      }
    }
    if (applied > 0) {
      promptAction.showToast({ message: `已应用 ${applied} 个操作` });
      this.operations = [];
      this.input = '';
    } else {
      promptAction.showToast({ message: '应用失败' });
    }
  }

  build() {
    Column() {
      if (this.operations.length > 0) {
        Column({ space: 6 }) {
          Row() {
            Text(`${this.operations.length} 个操作`)
              .fontSize(12)
              .fontWeight(600)
              .fontColor(Theme.colorMuted())
            Blank()
            Text('×')
              .fontSize(12)
              .fontColor(Theme.colorMuted())
              .padding(4)
              .onClick(() => {
                this.operations = [];
              })
          }
          .width('100%')
          Column({ space: 2 }) {
            ForEach(this.operations, (op: TransformOp, idx: number) => {
              Row({ space: 6 }) {
                Text(op.type)
                  .fontSize(11)
                  .fontColor(Theme.primary)
                Text(op.params)
                  .fontSize(11)
                  .fontColor(Theme.colorMuted())
                  .maxLines(2)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                  .layoutWeight(1)
              }
              .width('100%')
            }, (op: TransformOp, idx: number) => idx.toString() + op.type + op.params)
          }
          .width('100%')
          Row({ space: 6 }) {
            Button() {
              Text('应用')
                .fontSize(11)
                .fontColor(Color.White)
            }
            .height(28)
            .padding({ left: 14, right: 14 })
            .backgroundColor(Theme.primary)
            .borderRadius(6)
            .onClick(() => {
              this.applyOps();
            })
            Button() {
              Text('取消')
                .fontSize(11)
                .fontColor(Theme.colorMuted())
            }
            .type(ButtonType.Normal)
            .height(28)
            .padding({ left: 14, right: 14 })
            .backgroundColor(Color.Transparent)
            .borderRadius(6)
            .onClick(() => {
              this.operations = [];
            })
          }
          .width('100%')
        }
        .width('100%')
        .padding(12)
        .borderRadius(12)
        .border({ width: 1, color: Theme.colorBorder() })
        .backgroundColor(Theme.colorSurfaceElevated())
        .alignItems(HorizontalAlign.Start)
        .margin({ bottom: 8 })
      }

      if (this.answer.length > 0) {
        Row({ space: 8 }) {
          SymbolGlyph($r('sys.symbol.wand_and_stars'))
            .fontSize(14)
            .fontColor([Theme.primary])
          Text(this.answer)
            .fontSize(12)
            .fontColor(Theme.colorForeground())
            .lineHeight(18)
            .layoutWeight(1)
          Text('×')
            .fontSize(12)
            .fontColor(Theme.colorMuted())
            .padding(4)
            .onClick(() => {
              this.answer = '';
            })
        }
        .width('100%')
        .padding(12)
        .borderRadius(12)
        .border({ width: 1, color: Theme.colorBorder() })
        .backgroundColor(Theme.colorSurfaceElevated())
        .alignItems(VerticalAlign.Top)
        .margin({ bottom: 8 })
      }

      // Pill input bar
      Row({ space: 4 }) {
        Button() {
          Row({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.wand_and_stars'))
              .fontSize(12)
              .fontColor([this.mode === 'query' ? Theme.primary : Theme.colorMuted()])
            Text('清洗')
              .fontSize(12)
              .fontColor(this.mode === 'query' ? Theme.primary : Theme.colorMuted())
          }
        }
        .type(ButtonType.Normal)
        .height(30)
        .padding({ left: 12, right: 12 })
        .backgroundColor(this.mode === 'query' ? Theme.primaryDim : Color.Transparent)
        .borderRadius(15)
        .onClick(() => {
          this.mode = 'query';
        })

        Button() {
          Row({ space: 4 }) {
            SymbolGlyph($r('sys.symbol.wand_and_stars'))
              .fontSize(12)
              .fontColor([this.mode === 'ask' ? Theme.primary : Theme.colorMuted()])
            Text('提问')
              .fontSize(12)
              .fontColor(this.mode === 'ask' ? Theme.primary : Theme.colorMuted())
          }
        }
        .type(ButtonType.Normal)
        .height(30)
        .padding({ left: 12, right: 12 })
        .backgroundColor(this.mode === 'ask' ? Theme.primaryDim : Color.Transparent)
        .borderRadius(15)
        .onClick(() => {
          this.mode = 'ask';
        })

        TextInput({ placeholder: this.mode === 'query' ? '例如：去重、填充缺失、按列排序…' : '例如：这个数据集有多少行？' })
          .layoutWeight(1)
          .height(30)
          .fontSize(14)
          .backgroundColor(Color.Transparent)
          .onChange((v: string) => {
            this.input = v;
          })

        Button() {
          SymbolGlyph($r('sys.symbol.paperplane'))
            .fontSize(14)
            .fontColor([Color.White])
        }
        .width(30)
        .height(30)
        .type(ButtonType.Circle)
        .backgroundColor(Theme.primary)
        .onClick(() => {
          this.submit();
        })
      }
      .width('100%')
      .height(44)
      .padding({ left: 6, right: 6 })
      .borderRadius(22)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .shadow({ radius: 24, color: 'rgba(0,0,0,0.5)', offsetY: 6 })
    }
    .width(680)
    .constraintSize({ maxWidth: '92%' })
    .alignItems(HorizontalAlign.Start)
  }
}
