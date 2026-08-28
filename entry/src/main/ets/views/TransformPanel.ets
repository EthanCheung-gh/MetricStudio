import { promptAction, LengthMetrics } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { TransformOp } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { evalExpression } from '../engine/TransformOps';

/** Right-dataset shim for the join section. */
interface DatasetShim {
  index: number;
  name: string;
}

const OPS_FILTER = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains'];
const OPS_AGG = ['sum', 'mean', 'count', 'min', 'max'];
const OPS_STR = ['trim', 'lower', 'upper'];
const OPS_JOIN = ['inner', 'left'];

/**
 * Transform panel (web: src/components/data/TransformPanel.tsx). Card with
 * grouped operator sections — native Select dropdowns / Inputs / Buttons,
 * matching the web UI and control types. Applies ops to the active dataset
 * and supports undo.
 */
@Component
export struct TransformPanel {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;

  // filter
  @State filterCol: string = '';
  @State filterOp: string = 'eq';
  @State filterVal: string = '';
  // sort
  @State sortCol: string = '';
  @State sortAsc: boolean = true;
  // rename
  @State renameFrom: string = '';
  @State renameTo: string = '';
  // compute (expression, web computed field)
  @State computeName: string = '';
  @State computeExpr: string = '';
  // join
  @State joinRight: number = -1;
  @State joinOn: string = '';
  @State joinHow: string = 'inner';
  // pivot
  @State pivotIndex: string = '';
  @State pivotColumns: string = '';
  @State pivotValues: string = '';
  @State pivotAgg: string = 'sum';
  // melt
  @State meltIdVar: string = '';
  // drop
  @State dropCol: string = '';
  // str clean
  @State strCol: string = '';
  @State strAction: string = 'trim';
  @State strNewCol: string = '';
  // groupby
  @State groupBy: string = '';
  @State groupValue: string = '';
  @State groupAgg: string = 'sum';
  // sample
  @State sampleN: string = '';

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

  private colOptions(): SelectOption[] {
    const cols = this.columns();
    const opts: SelectOption[] = [];
    for (let i = 0; i < cols.length; i++) {
      opts.push({ value: cols[i] });
    }
    return opts;
  }

  private colIndex(field: string): number {
    const cols = this.columns();
    for (let i = 0; i < cols.length; i++) {
      if (cols[i] === field) {
        return i;
      }
    }
    return 0;
  }

  private stringOptions(list: string[]): SelectOption[] {
    const opts: SelectOption[] = [];
    for (let i = 0; i < list.length; i++) {
      opts.push({ value: list[i] });
    }
    return opts;
  }

  private stringIndex(list: string[], value: string): number {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === value) {
        return i;
      }
    }
    return 0;
  }

  private run(op: TransformOp): void {
    const ok = this.dataState.applyTransform(op);
    if (!ok && this.dataState.lastError.length > 0) {
      promptAction.showToast({ message: this.dataState.lastError });
    }
  }

  private applyFilter(): void {
    if (this.filterCol.length === 0 || this.filterVal.length === 0) {
      return;
    }
    this.run(new TransformOp('filter', JSON.stringify({ column: this.filterCol, operator: this.filterOp, value: this.filterVal })));
  }

  private applySort(): void {
    if (this.sortCol.length === 0) {
      return;
    }
    this.run(new TransformOp('sort', JSON.stringify({ column: this.sortCol, ascending: this.sortAsc })));
  }

  private applyDropNa(): void {
    this.run(new TransformOp('dropNa', JSON.stringify({ columns: null })));
  }

  private applyRename(): void {
    if (this.renameFrom.length === 0 || this.renameTo.length === 0) {
      return;
    }
    this.run(new TransformOp('rename', JSON.stringify({ oldName: this.renameFrom, newName: this.renameTo })));
  }

  private applyExpr(): void {
    if (this.computeName.length === 0 || this.computeExpr.trim().length === 0) {
      return;
    }
    this.run(new TransformOp('expr', JSON.stringify({ name: this.computeName, expression: this.computeExpr.trim() })));
    this.computeName = '';
    this.computeExpr = '';
  }

  private insertField(name: string): void {
    this.computeExpr = (this.computeExpr.trim().length > 0 && !this.computeExpr.endsWith(' ')
      ? this.computeExpr + ' ' : this.computeExpr) + name;
  }

  private exprPreview(): string {
    const df = this.dataState.activeDataFrame;
    if (df === null || this.computeExpr.trim().length === 0) {
      return '';
    }
    const out: string[] = [];
    const n = Math.min(5, df.rowCount);
    for (let r = 0; r < n; r++) {
      const v = evalExpression(df, r, this.computeExpr);
      out.push(v === null ? 'null' : v.toString());
    }
    return out.join(', ');
  }

  private otherDatasets(): DatasetShim[] {
    const out: DatasetShim[] = [];
    for (let i = 0; i < this.dataState.dataFrames.length; i++) {
      if (i !== this.dataState.activeIndex) {
        out.push({ index: i, name: this.dataState.dataFrames[i].name });
      }
    }
    return out;
  }

  private colOptionsForDatasets(): SelectOption[] {
    const opts: SelectOption[] = [];
    const ds = this.otherDatasets();
    for (let i = 0; i < ds.length; i++) {
      opts.push({ value: ds[i].name });
    }
    return opts;
  }

  private applyJoin(): void {
    if (this.joinRight < 0 || this.joinOn.length === 0) {
      return;
    }
    this.run(new TransformOp('join', JSON.stringify({
      otherIndex: this.joinRight,
      leftKey: this.joinOn,
      rightKey: this.joinOn,
      how: this.joinHow,
    })));
  }

  private applyPivot(): void {
    if (this.pivotIndex.length === 0 || this.pivotColumns.length === 0 || this.pivotValues.length === 0) {
      return;
    }
    this.run(new TransformOp('pivot', JSON.stringify({ index: this.pivotIndex, columns: this.pivotColumns, values: this.pivotValues, agg: this.pivotAgg })));
  }

  private applyMelt(): void {
    if (this.meltIdVar.length === 0) {
      return;
    }
    this.run(new TransformOp('melt', JSON.stringify({ idVars: [this.meltIdVar] })));
  }

  private applyDrop(): void {
    if (this.dropCol.length === 0) {
      return;
    }
    this.run(new TransformOp('dropCol', JSON.stringify({ columns: [this.dropCol] })));
  }

  private applyStrClean(): void {
    if (this.strCol.length === 0) {
      return;
    }
    this.run(new TransformOp('strClean', JSON.stringify({ column: this.strCol, action: this.strAction, newColumn: this.strNewCol })));
  }

  private applyGroupby(): void {
    if (this.groupBy.length === 0 || this.groupValue.length === 0) {
      return;
    }
    this.run(new TransformOp('aggregate', JSON.stringify({ groupBy: this.groupBy, column: this.groupValue, agg: this.groupAgg })));
  }

  private applySample(): void {
    const n = parseInt(this.sampleN, 10);
    if (Number.isNaN(n) || n <= 0) {
      return;
    }
    this.run(new TransformOp('sample', JSON.stringify({ n: n })));
  }

  build() {
    Column({ space: 12 }) {
      Text(t(this.workspaceState.language, 'transform.title'))
        .fontSize(12)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)

      if (this.dataState.activeDataFrame === null) {
        Text(t(this.workspaceState.language, 'transform.noData'))
          .fontSize(12)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)
      } else {
        // ---- Filter ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.filter'))
        Row({ space: 6 }) {
          Select(this.colOptions())
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndex(this.filterCol))
            .value(this.filterCol.length > 0 ? this.filterCol : t(this.workspaceState.language, 'transform.column'))
            .font({ size: 12 })
            .height(30)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.filterCol = value;
            })
          Select(this.stringOptions(OPS_FILTER))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.stringIndex(OPS_FILTER, this.filterOp))
            .value(this.filterOp)
            .font({ size: 12 })
            .height(30)
            .width(72)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.filterOp = value;
            })
        }
        .width('100%')
        TextInput({ placeholder: t(this.workspaceState.language, 'transform.value'), text: this.filterVal })
          .width('100%')
          .height(30)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 12 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(12)
          .onChange((v: string) => {
            this.filterVal = v;
          })
        this.primaryButton(t(this.workspaceState.language, 'transform.applyFilter'), () => {
          this.applyFilter();
        })

        // ---- Sort ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.sort'))
        Row({ space: 6 }) {
          Select(this.colOptions())
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndex(this.sortCol))
            .value(this.sortCol.length > 0 ? this.sortCol : t(this.workspaceState.language, 'transform.column'))
            .font({ size: 12 })
            .height(30)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.sortCol = value;
            })
          Button() {
            Text(this.sortAsc ? t(this.workspaceState.language, 'transform.ascending') : t(this.workspaceState.language, 'transform.descending'))
              .fontSize(11)
              .fontColor(this.sortAsc ? Theme.primary : Theme.colorForeground())
          }
          .type(ButtonType.Normal)
          .height(30)
          .padding({ left: 10, right: 10 })
          .backgroundColor(this.sortAsc ? Theme.primaryDim : Theme.colorSurface())
          .borderRadius(6)
          .onClick(() => {
            this.sortAsc = !this.sortAsc;
          })
        }
        .width('100%')
        this.primaryButton(t(this.workspaceState.language, 'transform.applySort'), () => {
          this.applySort();
        })

        // ---- Drop NA ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.dropMissing'))
        this.warningButton(t(this.workspaceState.language, 'transform.dropMissing'), () => {
          this.applyDropNa();
        })

        // ---- Rename ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.rename'))
        Row({ space: 6 }) {
          Select(this.colOptions())
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndex(this.renameFrom))
            .value(this.renameFrom.length > 0 ? this.renameFrom : t(this.workspaceState.language, 'transform.from'))
            .font({ size: 12 })
            .height(30)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.renameFrom = value;
            })
          TextInput({ placeholder: t(this.workspaceState.language, 'transform.to'), text: this.renameTo })
            .width('100%')
            .layoutWeight(1)
            .height(30)
            .padding({ top: 0, bottom: 0 })
            .placeholderFont({ size: 12 })
            .placeholderColor(Theme.colorMuted())
            .fontSize(12)
            .onChange((v: string) => {
              this.renameTo = v;
            })
        }
        .width('100%')
        this.primaryButton(t(this.workspaceState.language, 'transform.renameColumn'), () => {
          this.applyRename();
        })

        // ---- Compute (expression, web computed field) ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.compute'))
        TextInput({ placeholder: t(this.workspaceState.language, 'transform.newColumn'), text: this.computeName })
          .width('100%')
          .height(30)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 12 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(12)
          .onChange((v: string) => {
            this.computeName = v;
          })
        TextInput({ placeholder: l10n(this.workspaceState.language, '表达式，如 单价 * 数量', 'Expression, e.g. price * qty'), text: this.computeExpr })
          .width('100%')
          .height(30)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 12 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(12)
          .onChange((v: string) => {
            this.computeExpr = v;
          })
        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
          ForEach(this.columns(), (col: string) => {
            Button() {
              Text(col)
                .fontSize(10)
                .fontColor(Theme.colorMuted())
            }
            .type(ButtonType.Normal)
            .height(22)
            .padding({ left: 8, right: 8 })
            .backgroundColor(Theme.colorSurface())
            .borderRadius(8)
            .onClick(() => {
              this.insertField(col);
            })
          }, (col: string) => col)
        }
        .width('100%')
        if (this.exprPreview().length > 0) {
          Text(l10n(this.workspaceState.language, '预览: ' + this.exprPreview(), 'preview: ' + this.exprPreview()))
            .fontSize(10)
            .fontColor(Theme.colorMuted())
            .width('100%')
            .maxLines(2)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
        }
        this.primaryButton(t(this.workspaceState.language, 'transform.addComputed'), () => {
          this.applyExpr();
        })

        // ---- Pivot ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.pivot'))
        Row({ space: 6 }) {
          this.inlineColSelect(this.pivotIndex, t(this.workspaceState.language, 'transform.index'), (v: string) => {
            this.pivotIndex = v;
          })
          this.inlineColSelect(this.pivotColumns, t(this.workspaceState.language, 'table.columns'), (v: string) => {
            this.pivotColumns = v;
          })
        }
        .width('100%')
        Row({ space: 6 }) {
          this.inlineColSelect(this.pivotValues, t(this.workspaceState.language, 'transform.value'), (v: string) => {
            this.pivotValues = v;
          })
          Select(this.stringOptions(OPS_AGG))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.stringIndex(OPS_AGG, this.pivotAgg))
            .value(this.pivotAgg)
            .font({ size: 12 })
            .height(30)
            .width(80)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.pivotAgg = value;
            })
        }
        .width('100%')
        this.primaryButton(t(this.workspaceState.language, 'transform.applyPivot'), () => {
          this.applyPivot();
        })

        // ---- Melt ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.melt'))
        this.inlineColSelect(this.meltIdVar, t(this.workspaceState.language, 'transform.idColumns'), (v: string) => {
          this.meltIdVar = v;
        })
        this.primaryButton(t(this.workspaceState.language, 'transform.applyMelt'), () => {
          this.applyMelt();
        })

        // ---- Join (web join section) ----
        this.sectionLabel(l10n(this.workspaceState.language, '关联数据集', 'Join'))
        Select(this.colOptionsForDatasets())
          .fontColor(Theme.colorForeground())
          .border({ width: 1, color: Theme.colorBorder() })
          .selected(this.joinRight >= 0 ? this.joinRight : 0)
          .value(this.joinRight >= 0 && this.joinRight < this.dataState.dataFrames.length
            ? this.dataState.dataFrames[this.joinRight].name
            : l10n(this.workspaceState.language, '选择数据集', 'Select dataset'))
          .font({ size: 12 })
          .height(30)
          .width('100%')
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            const ds = this.otherDatasets();
            this.joinRight = index >= 0 && index < ds.length ? ds[index].index : -1;
          })
        this.inlineColSelect(this.joinOn, l10n(this.workspaceState.language, '关联键', 'Key'), (v: string) => {
          this.joinOn = v;
        })
        Select(this.stringOptions(OPS_JOIN))
          .fontColor(Theme.colorForeground())
          .border({ width: 1, color: Theme.colorBorder() })
          .selected(this.stringIndex(OPS_JOIN, this.joinHow))
          .value(this.joinHow)
          .font({ size: 12 })
          .height(30)
          .width('100%')
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            this.joinHow = value;
          })
        this.primaryButton(l10n(this.workspaceState.language, '执行关联', 'Join'), () => {
          this.applyJoin();
        })

        // ---- Drop columns ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.drop'))
        this.inlineColSelect(this.dropCol, t(this.workspaceState.language, 'transform.drop'), (v: string) => {
          this.dropCol = v;
        })
        this.primaryButton(t(this.workspaceState.language, 'transform.drop'), () => {
          this.applyDrop();
        })

        // ---- String clean ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.strClean'))
        Row({ space: 6 }) {
          this.inlineColSelect(this.strCol, t(this.workspaceState.language, 'transform.column'), (v: string) => {
            this.strCol = v;
          })
          Select(this.stringOptions(OPS_STR))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.stringIndex(OPS_STR, this.strAction))
            .value(this.strAction)
            .font({ size: 12 })
            .height(30)
            .width(90)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.strAction = value;
            })
        }
        .width('100%')
        TextInput({ placeholder: t(this.workspaceState.language, 'transform.newColumn'), text: this.strNewCol })
          .width('100%')
          .height(30)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 12 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(12)
          .onChange((v: string) => {
            this.strNewCol = v;
          })
        this.primaryButton(t(this.workspaceState.language, 'transform.strClean'), () => {
          this.applyStrClean();
        })

        // ---- Groupby ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.groupby'))
        Row({ space: 6 }) {
          this.inlineColSelect(this.groupBy, t(this.workspaceState.language, 'transform.groupColumns'), (v: string) => {
            this.groupBy = v;
          })
          this.inlineColSelect(this.groupValue, t(this.workspaceState.language, 'transform.valueColumn'), (v: string) => {
            this.groupValue = v;
          })
        }
        .width('100%')
        Select(this.stringOptions(OPS_AGG))
          .fontColor(Theme.colorForeground())
          .border({ width: 1, color: Theme.colorBorder() })
          .selected(this.stringIndex(OPS_AGG, this.groupAgg))
          .value(this.groupAgg)
          .font({ size: 12 })
          .height(30)
          .width(120)
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onSelect((index: number, value: string) => {
            this.groupAgg = value;
          })
        this.primaryButton(t(this.workspaceState.language, 'transform.groupby'), () => {
          this.applyGroupby();
        })

        // ---- Sample ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.sample'))
        TextInput({ placeholder: t(this.workspaceState.language, 'transform.sampleN'), text: this.sampleN })
          .width('100%')
          .height(30)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 12 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(12)
          .type(InputType.Number)
          .onChange((v: string) => {
            this.sampleN = v;
          })
        this.primaryButton(t(this.workspaceState.language, 'transform.sample'), () => {
          this.applySample();
        })

        // ---- Undo ----
        this.sectionLabel(t(this.workspaceState.language, 'transform.undo'))
        this.warningButton(t(this.workspaceState.language, 'transform.undo'), () => {
          if (this.dataState.transformHistory.length === 0) {
            promptAction.showToast({ message: t(this.workspaceState.language, 'transform.nothingToUndo') });
            return;
          }
          this.dataState.undo();
        })
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
  sectionLabel(label: string) {
    Text(label)
      .fontSize(10)
      .textCase(TextCase.UpperCase)
      .fontColor(Theme.colorMuted())
      .alignSelf(ItemAlign.Start)
      .margin({ top: 2 })
  }

  @Builder
  primaryButton(label: string, action: () => void) {
    Button() {
      Text(label)
        .fontSize(12)
        .fontColor(Color.White)
    }
    .width('100%')
    .height(30)
    .backgroundColor(Theme.primary)
    .borderRadius(6)
    .onClick(() => {
      action();
    })
  }

  @Builder
  warningButton(label: string, action: () => void) {
    Button() {
      Text(label)
        .fontSize(12)
        .fontColor(Theme.warning)
    }
    .width('100%')
    .height(30)
    .backgroundColor(Theme.colorSurface())
    .borderRadius(6)
    .onClick(() => {
      action();
    })
  }

  @Builder
  inlineColSelect(selected: string, placeholder: string, onPick: (v: string) => void) {
    Select(this.colOptions())
      .fontColor(Theme.colorForeground())
      .border({ width: 1, color: Theme.colorBorder() })
      .selected(this.colIndex(selected))
      .value(selected.length > 0 ? selected : placeholder)
      .font({ size: 12 })
      .height(30)
      .layoutWeight(1)
      .backgroundColor(Theme.colorSurface())
      .borderRadius(6)
      .onSelect((index: number, value: string) => {
        onPick(value);
      })
  }
}
