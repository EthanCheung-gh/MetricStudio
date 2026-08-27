import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { fmt } from '../common/Format';
import { DataFrame } from '../model/DataFrame';
import { DataState, DiffResult, diffFrames } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';

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
}

/**
 * Lineage view (web: LineageView.tsx, linear-chain subset). Lists the base
 * snapshot plus every applied transform step with row/col metadata; steps can
 * be disabled/re-enabled (replay from base) and previewed with a diff against
 * the current state. No join DAG in the port — a list covers the whole chain.
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
      });
    }
    let prevRows = ds.baseFrame !== null ? ds.baseFrame.rowCount : -1;
    for (let i = 0; i < ds.transformHistory.length; i++) {
      const s = ds.transformHistory[i];
      const delta = prevRows >= 0 && s.rowsAfter >= 0 ? s.rowsAfter - prevRows : 0;
      out.push({
        index: i,
        title: s.op.type,
        params: s.op.params,
        rows: s.rowsAfter,
        cols: s.colsAfter,
        delta: s.enabled ? delta : 0,
        enabled: s.enabled,
        error: s.error,
      });
      if (s.enabled && s.rowsAfter >= 0) {
        prevRows = s.rowsAfter;
      }
    }
    return out;
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
