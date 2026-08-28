import { promptAction } from '@kit.ArkUI';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { Theme } from '../common/Theme';
import { fmt } from '../common/Format';
import { t } from '../common/Locale';
import { DataFrame, TransformOp } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { QaState, conversationToMarkdown } from '../model/QaState';
import { computeQualityMetrics } from '../engine/ColumnStats';
import { parseNlOps } from '../engine/NlParser';
import {
  ChatMessage, askSystemPrompt, buildDataContext, chatCompletion,
  llmConfigured, opsSystemPrompt, parseOpsReply
} from '../engine/LlmClient';

/**
 * AI command bar (web: src/components/ai/AICommandBar.tsx). Bottom-centered
 * floating pill: 清洗 (transform) / 提问 (ask) modes. 清洗 parses the phrase
 * into transform ops shown in a result card (apply/cancel); 提问 answers from
 * the configured LLM (OpenAI-compatible, web /api/v1/nl) and falls back to
 * local dataframe statistics when unconfigured or unreachable. Answers are
 * kept as a per-dataset conversation (web qaStore) and exportable as Markdown.
 */
@Component
export struct AICommandBar {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @Consume('qaState') qaState: QaState;
  @StorageLink('themeFlag') themeFlag: boolean = false; // re-render on theme switch
  @State mode: string = 'query'; // 'query' | 'ask'
  @State input: string = '';
  @State operations: TransformOp[] = [];
  @State opsModel: string = '';
  @State answer: string = '';
  @State answerModel: string = '';
  @State busy: boolean = false;

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

  private async submit(): Promise<void> {
    if (this.busy || this.input.trim().length === 0) {
      return;
    }
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return;
    }
    const question = this.input.trim();
    if (this.mode === 'query') {
      await this.submitQuery(df, question);
    } else {
      await this.submitAsk(df, question);
    }
  }

  /** 清洗 mode: LLM-first NL→ops (web backend), falling back to the local engine. */
  private async submitQuery(df: DataFrame, question: string): Promise<void> {
    this.operations = [];
    this.answer = '';
    this.opsModel = '';
    this.busy = true;
    let ops: TransformOp[] = [];
    if (llmConfigured(this.workspaceState.llmConfig)) {
      try {
        const messages: ChatMessage[] = [];
        const sys: ChatMessage = { role: 'system', content: opsSystemPrompt() };
        messages.push(sys);
        const usr: ChatMessage = { role: 'user', content: buildDataContext(df) + '\n\n用户指令: ' + question };
        messages.push(usr);
        const reply = await chatCompletion(this.workspaceState.llmConfig, messages, 512);
        ops = parseOpsReply(reply, df);
        if (ops.length > 0) {
          this.opsModel = this.workspaceState.llmConfig.model;
        }
      } catch (e) {
        promptAction.showToast({ message: t(this.workspaceState.language, 'ai.llmFallback') });
      }
    }
    if (ops.length === 0) {
      ops = this.parseQueryOps();
    }
    this.busy = false;
    this.operations = ops;
    if (ops.length === 0) {
      promptAction.showToast({ message: '未识别出可执行的清洗操作' });
    }
  }

  /** 提问 mode: LLM answer with conversation history, local statistics fallback. */
  private async submitAsk(df: DataFrame, question: string): Promise<void> {
    this.busy = true;
    this.answer = '';
    this.answerModel = '';
    this.operations = [];
    let text = '';
    let model = '';
    if (llmConfigured(this.workspaceState.llmConfig)) {
      try {
        const messages: ChatMessage[] = [];
        const sys: ChatMessage = { role: 'system', content: askSystemPrompt() };
        messages.push(sys);
        const conv = this.qaState.ensureForDataset(df.name, df.name);
        const recent = conv.turns.length > 3 ? conv.turns.slice(conv.turns.length - 3) : conv.turns;
        for (let i = 0; i < recent.length; i++) {
          const qm: ChatMessage = { role: 'user', content: recent[i].question };
          messages.push(qm);
          const am: ChatMessage = { role: 'assistant', content: recent[i].answer };
          messages.push(am);
        }
        const usr: ChatMessage = { role: 'user', content: buildDataContext(df) + '\n\n问题: ' + question };
        messages.push(usr);
        const reply = await chatCompletion(this.workspaceState.llmConfig, messages, 512);
        if (reply.trim().length > 0) {
          text = reply;
          model = this.workspaceState.llmConfig.model;
        }
      } catch (e) {
        promptAction.showToast({ message: t(this.workspaceState.language, 'ai.llmFallback') });
      }
    }
    if (text.trim().length === 0) {
      text = this.buildAnswer();
      model = '';
    }
    this.qaState.ensureForDataset(df.name, df.name);
    this.qaState.appendTurn(question, text, model);
    this.busy = false;
    this.answer = text;
    this.answerModel = model;
  }

  /** Export the current conversation as Markdown via the save picker (web qaExport). */
  private async exportMarkdown(): Promise<void> {
    const conv = this.qaState.current();
    if (conv === null || conv.turns.length === 0) {
      return;
    }
    try {
      const documentPicker = new picker.DocumentViewPicker(getContext(this));
      const options = new picker.DocumentSaveOptions();
      options.newFileNames = ['metricstudio-qa.md'];
      const uris = await documentPicker.save(options);
      if (uris.length === 0) {
        return;
      }
      const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
      fs.writeSync(file.fd, conversationToMarkdown(conv));
      fs.closeSync(file);
      promptAction.showToast({ message: t(this.workspaceState.language, 'ai.exported') });
    } catch (e) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'ai.exportFailed') });
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
          Row({ space: 6 }) {
            Text(`${this.operations.length} 个操作`)
              .fontSize(12)
              .fontWeight(600)
              .fontColor(Theme.colorMuted())
            if (this.opsModel.length > 0) {
              Text(this.opsModel)
                .fontSize(10)
                .fontColor(Theme.colorMuted())
                .padding({ left: 6, right: 6, top: 1, bottom: 1 })
                .borderRadius(4)
                .backgroundColor(Theme.colorSurface())
            }
            Blank()
            Text('×')
              .fontSize(12)
              .fontColor(Theme.colorMuted())
              .padding(4)
              .onClick(() => {
                this.operations = [];
                this.opsModel = '';
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

      if (this.busy) {
        Row({ space: 6 }) {
          LoadingProgress()
            .width(14)
            .height(14)
            .color(Theme.primary)
          Text(t(this.workspaceState.language, 'ai.thinking'))
            .fontSize(11)
            .fontColor(Theme.colorMuted())
        }
        .width('100%')
        .padding(10)
        .borderRadius(12)
        .border({ width: 1, color: Theme.colorBorder() })
        .backgroundColor(Theme.colorSurfaceElevated())
        .margin({ bottom: 8 })
      }

      if (this.answer.length > 0) {
        Column({ space: 6 }) {
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
                this.answerModel = '';
              })
          }
          .width('100%')
          .alignItems(VerticalAlign.Top)

          Row({ space: 6 }) {
            Text(this.answerModel.length > 0 ? this.answerModel : t(this.workspaceState.language, 'ai.localEngine'))
              .fontSize(10)
              .fontColor(Theme.colorMuted())
              .padding({ left: 6, right: 6, top: 1, bottom: 1 })
              .borderRadius(4)
              .backgroundColor(Theme.colorSurface())
            Blank()
            Button() {
              Row({ space: 4 }) {
                SymbolGlyph($r('sys.symbol.doc_plaintext'))
                  .fontSize(11)
                  .fontColor([Theme.colorMuted()])
                Text(t(this.workspaceState.language, 'ai.exportMd'))
                  .fontSize(11)
                  .fontColor(Theme.colorMuted())
              }
            }
            .type(ButtonType.Normal)
            .height(24)
            .padding({ left: 10, right: 10 })
            .backgroundColor(Color.Transparent)
            .borderRadius(6)
            .border({ width: 1, color: Theme.colorBorder() })
            .onClick(() => {
              this.exportMarkdown();
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
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 14 })
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
