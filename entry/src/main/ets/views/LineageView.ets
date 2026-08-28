import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { fmt } from '../common/Format';
import { DataFrame } from '../model/DataFrame';
import { DataState, DiffResult, diffFrames } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';

/** Join op params subset (engine/TransformOps JoinParams). */
interface JoinParamsShim {
  otherIndex?: number;
  how?: string;
}

/** Step-list row shim so @Builder params stay typed. */
interface StepRowShim {
  index: number;   // -1 = base
  title: string;
  params: string;
  rows: number;
  cols: number;
  delta: number;
  enabled: boolean;
  error: string;
  isJoin: boolean;
  rightLabel: string; // join cross-edge ghost label (web {右表} #{step})
}

/**
 * Lineage view (web: LineageView.tsx). Linear chain of base + applied steps
 * with row/col metadata, enable/disable, per-step preview, version compare
 * (baseline select) and join cross-edge ghost nodes for cross-dataset steps.
 */
@Component
export struct LineageView {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @StorageLink('lineageTick') @Watch('onLineageTick') lineageTick: number = 0;
  @State selected: number = -2; // -2 = none, -1 = base, >=0 = step index
  @State previewRows: number = -1;
  @State previewCols: number = -1;
  @State previewColumns: string[] = [];
  @State diff: DiffResult | null = null;
  @State baselineIdx: number = -1; // compare baseline (-1 = import state)

  onLineageTick(): void {
    const n = this.dataState.transformHistory.length;
    if (this.selected >= n) {
      this.selected = -2;
      this.diff = null;
      this.previewColumns = [];
      this.previewRows = -1;
      this.previewCols = -1;
    } else if (this.selected >= -1) {
      this.refreshPreview();
    }
  }

  private selectStep(index: number): void {
    if (this.selected === index) {
      this.selected = -2;
      this.diff = null;
      this.previewColumns = [];
      this.previewRows = -1;
      this.previewCols = -1;
      return;
    }
    this.selected = index;
    this.refreshPreview();
  }

  private refreshPreview(): void {
    this.diff = null;
    this.previewColumns = [];
    this.previewRows = -1;
    this.previewCols = -1;
    if (this.selected === -2) {
      return;
    }
    let frame: DataFrame | null = null;
    if (this.selected === -1) {
      frame = this.dataState.baseFrame !== null ? this.dataState.baseFrame.clone() : null;
    } else {
      frame = this.dataState.previewAtStep(this.selected);
    }
    if (frame === null) {
      return;
    }
    this.previewRows = frame.rowCount;
    this.previewCols = frame.colCount;
    const cols: string[] = [];
    for (let c = 0; c < frame.columns.length && c < 12; c++) {
      cols.push(frame.columns[c].name);
    }
    this.previewColumns = cols;
    const cur = this.dataState.activeDataFrame;
    if (cur !== null) {
      this.diff = diffFrames(frame, cur);
    }
  }

  private stepRows(): StepRowShim[] {
    const ds = this.dataState;
    const lang = this.workspaceState.language;
    const out: StepRowShim[] = [];
    if (ds.baseFrame !== null) {
      out.push({
        index: -1,
        title: t(lang, 'lineage.base'),
        params: '',
        rows: ds.baseFrame.rowCount,
        cols: ds.baseFrame.colCount,
        delta: 0,
        enabled: true,
        error: '',
        isJoin: false,
        rightLabel: '',
      });
    }
    let prevRows = ds.baseFrame !== null ? ds.baseFrame.rowCount : -1;
    for (let i = 0; i < ds.transformHistory.length; i++) {
      const s = ds.transformHistory[i];
      const delta = prevRows >= 0 && s.rowsAfter >= 0 ? s.rowsAfter - prevRows : 0;
      const join = s.op.type === 'join';
      out.push({
        index: i,
        title: s.op.type,
        params: s.op.params,
        rows: s.rowsAfter,
        cols: s.colsAfter,
        delta: s.enabled ? delta : 0,
        enabled: s.enabled,
        error: s.error,
        isJoin: join,
        rightLabel: join ? this.joinRightLabel(s.op.params) : '',
      });
      if (s.enabled && s.rowsAfter >= 0) {
        prevRows = s.rowsAfter;
      }
    }
    return out;
  }

  /** Ghost label for a join step: right table name (web {右表名} #{step}). */
  private joinRightLabel(params: string): string {
    try {
      const p = JSON.parse(params) as JoinParamsShim;
      const idx = p.otherIndex !== undefined ? p.otherIndex : -1;
      const df = idx >= 0 && idx < this.dataState.dataFrames.length ? this.dataState.dataFrames[idx] : null;
      const how = p.how !== undefined && p.how.length > 0 ? p.how : 'left';
      return (df !== null ? df.name : 'right table') + ' · ' + how;
    } catch (e) {
      return 'right table';
    }
  }

  /** k=v param summary (web summarizeParams pick + rename map). */
  private summarizeParams(params: string): string {
    if (params.length === 0) {
      return '';
    }
    let p: Record<string, Object> = {};
    try {
      p = JSON.parse(params) as Record<string, Object>;
    } catch (e) {
      return params;
    }
    const names: string[] = ['column', 'operator', 'value', 'columns', 'mappings', 'expression',
      'how', 'on', 'right_dataset_id', 'otherIndex'];
    const aliases: string[] = ['col', 'op', 'value', 'cols', 'map', 'expr', 'how', 'on', 'right', 'at'];
    const parts: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const v = p[names[i]];
      if (v !== undefined && v !== null) {
        const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        parts.push(aliases[i] + '=' + text);
      }
    }
    return parts.join('  ');
  }

  /** Version compare: baseline frame vs selected step frame (web diffSteps). */
  private compareBaseline(): void {
    if (this.selected < 0) {
      return;
    }
    let left: DataFrame | null = null;
    if (this.baselineIdx < 0) {
      left = this.dataState.baseFrame !== null ? this.dataState.baseFrame.clone() : null;
    } else {
      left = this.dataState.previewAtStep(this.baselineIdx);
    }
    let right: DataFrame | null = null;
    if (this.selected < 0) {
      right = this.dataState.baseFrame !== null ? this.dataState.baseFrame.clone() : null;
    } else {
      right = this.dataState.previewAtStep(this.selected);
    }
    if (left === null || right === null) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'lineage.compareSame') });
      return;
    }
    if (this.baselineIdx === this.selected) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'lineage.compareSame') });
      return;
    }
    this.diff = diffFrames(left, right);
  }

  private baselineOptions(): SelectOption[] {
    const opts: SelectOption[] = [{ value: t(this.workspaceState.language, 'lineage.importState') }];
    for (let i = 0; i < this.dataState.transformHistory.length; i++) {
      const s = this.dataState.transformHistory[i];
      opts.push({ value: t(this.workspaceState.language, 'lineage.step') + ' ' + (i + 1).toString()
        + ' · ' + s.op.type });
    }
    return opts;
  }

  private deltaText(delta: number): string {
    if (delta > 0) {
      return '+' + fmt(delta);
    }
    if (delta < 0) {
      return fmt(delta);
    }
    return '±0';
  }

  build() {
    Column({ space: 8 }) {
      if (this.dataState.baseFrame === null) {
        Text(t(this.workspaceState.language, 'lineage.empty'))
          .fontSize(12)
          .fontColor(Theme.colorMuted())
          .padding(12)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())
          .alignSelf(ItemAlign.Start)
      } else {
        Text(t(this.workspaceState.language, 'lineage.hint'))
          .fontSize(11)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)

        ForEach(this.stepRows(), (row: StepRowShim) => {
          this.stepRow(row)
          if (row.isJoin && row.rightLabel.length > 0) {
            this.joinGhost(row)
          }
        }, (row: StepRowShim) => {
          return row.index.toString() + '_' + row.enabled.toString() + '_sel'
            + (this.selected === row.index ? '1' : '0') + '_' + this.lineageTick.toString();
        })

        if (this.selected !== -2) {
          this.previewCard()
        }
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  stepRow(row: StepRowShim) {
    Row({ space: 8 }) {
      // Click-to-preview area (kept separate from the toggle chip so the
      // events never overlap — ArkUI ClickEvent has no stopPropagation).
      Row({ space: 8 }) {
        Text(row.index === -1 ? '·' : (row.index + 1).toString())
          .fontSize(11)
          .fontWeight(600)
          .fontColor(this.selected === row.index ? Theme.primary : Theme.colorMuted())
          .width(18)
        Column({ space: 2 }) {
          Row({ space: 6 }) {
            Text(row.title)
              .fontSize(12)
              .fontWeight(600)
              .fontColor(row.enabled ? Theme.colorForeground() : Theme.colorMuted())
            if (row.error.length > 0) {
              Text('! ' + row.error)
                .fontSize(10)
                .fontColor(Theme.danger)
                .maxLines(1)
                .textOverflow({ overflow: TextOverflow.Ellipsis })
                .layoutWeight(1)
            }
          }
          .width('100%')
          if (row.params.length > 0) {
            Text(row.params)
              .fontSize(10)
              .fontColor(Theme.colorMuted())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .width('100%')
          }
        }
        .layoutWeight(1)
        .alignItems(HorizontalAlign.Start)

        if (row.index !== -1 && row.enabled) {
          Text(this.deltaText(row.delta))
            .fontSize(10)
            .fontColor(row.delta < 0 ? Theme.warning : (row.delta > 0 ? Theme.success : Theme.colorMuted()))
        }
        if (row.rows >= 0) {
          Text(fmt(row.rows) + '×' + row.cols.toString())
            .fontSize(10)
            .fontColor(Theme.colorMuted())
        }
      }
      .layoutWeight(1)
      .onClick(() => {
        this.selectStep(row.index);
      })

      if (row.index >= 0) {
        Button() {
          Text(row.enabled ? t(this.workspaceState.language, 'lineage.disable') : t(this.workspaceState.language, 'lineage.enable'))
            .fontSize(10)
            .fontColor(row.enabled ? Theme.colorMuted() : Theme.primary)
        }
        .type(ButtonType.Normal)
        .height(22)
        .padding({ left: 8, right: 8 })
        .backgroundColor(Color.Transparent)
        .borderRadius(8)
        .border({ width: 1, color: Theme.colorBorder() })
        .onClick(() => {
          this.dataState.toggleStep(row.index);
        })
      }
    }
    .width('100%')
    .padding({ left: 8, right: 8, top: 6, bottom: 6 })
    .borderRadius(6)
    .backgroundColor(this.selected === row.index ? Theme.primaryDim : Theme.colorSurface())
    .border({ width: 1, color: this.selected === row.index ? Theme.primary : Theme.colorBorder() })
  }

  /** Join cross-edge ghost node (web dashed bezier to a dimmed right-table node). */
  @Builder
  joinGhost(row: StepRowShim) {
    Row({ space: 6 }) {
      Text('⌞')
        .fontSize(12)
        .fontColor(Theme.primary)
      Text(row.rightLabel)
        .fontSize(10)
        .fontColor(Theme.colorMuted())
        .layoutWeight(1)
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .width('92%')
    .margin({ left: 24 })
    .padding({ left: 8, right: 8, top: 4, bottom: 4 })
    .borderRadius(6)
    .border({ width: 1, color: Theme.primary })
    .opacity(0.65)
  }

  @Builder
  previewCard() {
    Column({ space: 6 }) {
      Row() {
        Text(this.selected === -1
          ? t(this.workspaceState.language, 'lineage.base')
          : t(this.workspaceState.language, 'lineage.step') + ' ' + (this.selected + 1).toString()
            + ' · ' + (this.selected >= 0 ? this.dataState.transformHistory[this.selected].op.type : ''))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorForeground())
          .layoutWeight(1)
        Text('×')
          .fontSize(12)
          .fontColor(Theme.colorMuted())
          .padding(4)
          .onClick(() => {
            this.selectStep(this.selected);
          })
      }
      .width('100%')

      Text(t(this.workspaceState.language, 'status.rows') + ' ' + fmt(this.previewRows)
        + ' · ' + t(this.workspaceState.language, 'status.cols') + ' ' + this.previewCols.toString())
        .fontSize(11)
        .fontColor(Theme.colorMuted())

      if (this.selected >= 0) {
        Text(this.summarizeParams(this.dataState.transformHistory[this.selected].op.params))
          .fontSize(10)
          .fontColor(Theme.colorMuted())
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }

      // Version compare (web 基线版本 select + 对比版本)
      if (this.selected >= 0) {
        Row({ space: 6 }) {
          Select(this.baselineOptions())
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.baselineIdx + 1)
            .value(this.baselineIdx < 0 ? t(this.workspaceState.language, 'lineage.importState')
              : t(this.workspaceState.language, 'lineage.step') + ' ' + (this.baselineIdx + 1).toString())
            .font({ size: 10 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((_i: number, _v: string) => {
              this.baselineIdx = _i - 1;
            })
          Button() {
            Text(t(this.workspaceState.language, 'lineage.compare'))
              .fontSize(10)
              .fontColor(Color.White)
          }
          .type(ButtonType.Normal)
          .height(26)
          .padding({ left: 10, right: 10 })
          .backgroundColor(Theme.primary)
          .borderRadius(6)
          .onClick(() => {
            this.compareBaseline();
          })
        }
        .width('100%')
      }

      if (this.previewColumns.length > 0) {
        Text(this.previewColumns.join(' · '))
          .fontSize(10)
          .fontColor(Theme.colorMuted())
          .maxLines(2)
          .textOverflow({ overflow: TextOverflow.Ellipsis })
          .width('100%')
      }

      if (this.diff !== null) {
        Row({ space: 8 }) {
          Text(t(this.workspaceState.language, 'lineage.diffTitle'))
            .fontSize(11)
            .fontWeight(600)
            .fontColor(Theme.colorMuted())
          Text(this.diff.onlyLeft.length.toString() + ' ' + t(this.workspaceState.language, 'lineage.onlyLeft'))
            .fontSize(10)
            .fontColor(Theme.warning)
          Text(this.diff.onlyRight.length.toString() + ' ' + t(this.workspaceState.language, 'lineage.onlyRight'))
            .fontSize(10)
            .fontColor(Theme.success)
          Text(this.diff.numericDiff.length.toString() + ' ' + t(this.workspaceState.language, 'lineage.numericDiff'))
            .fontSize(10)
            .fontColor(Theme.colorMuted())
        }
        .width('100%')

        ForEach(this.diffLines(), (line: string) => {
          Text(line)
            .fontSize(10)
            .fontColor(Theme.colorMuted())
            .maxLines(1)
            .textOverflow({ overflow: TextOverflow.Ellipsis })
            .width('100%')
        }, (line: string) => line)
      }
    }
    .width('100%')
    .padding(8)
    .borderRadius(6)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurface())
    .alignItems(HorizontalAlign.Start)
  }

  private diffLines(): string[] {
    const res = this.diff;
    const out: string[] = [];
    if (res === null) {
      return out;
    }
    const n = Math.min(3, res.numericDiff.length);
    for (let i = 0; i < n; i++) {
      const d = res.numericDiff[i];
      const left = d.leftMean !== null ? d.leftMean.toFixed(2) : '—';
      const right = d.rightMean !== null ? d.rightMean.toFixed(2) : '—';
      out.push(d.column + ': ' + left + ' → ' + right);
    }
    return out;
  }
}
