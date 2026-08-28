import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import {
  CiMeanResult, PearsonMatrix, RegressionResult, TTestResult,
  ciMean, linearRegression, pearsonMatrix, welchTTest
} from '../engine/StatsTools';

/**
 * Stats panel (web: src/components/data/StatsPanel.tsx). Correlation matrix
 * heatmap, linear regression, two-group difference test and a 95% CI for the
 * mean — all computed locally (p-values use a normal approximation).
 */
@Component
export struct StatsPanel {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State corr: PearsonMatrix | null = null;
  @State regX: string = '';
  @State regY: string = '';
  @State regression: RegressionResult | null = null;
  @State groupCol: string = '';
  @State measureCol: string = '';
  @State groupA: string = '';
  @State groupB: string = '';
  @State groupOptions: string[] = [];
  @State difference: TTestResult | null = null;
  @State ciCol: string = '';
  @State ci: CiMeanResult | null = null;
  @State tick: number = 0;

  aboutToAppear(): void {
    this.rescanCorr();
  }

  private rescanCorr(): void {
    const df = this.dataState.activeDataFrame;
    this.corr = df !== null ? pearsonMatrix(df) : null;
  }

  private numericColumns(): string[] {
    const df = this.dataState.activeDataFrame;
    const out: string[] = [];
    if (df === null) {
      return out;
    }
    for (let i = 0; i < df.columns.length; i++) {
      if (df.columns[i].dtype === 'number') {
        out.push(df.columns[i].name);
      }
    }
    return out;
  }

  private allColumns(): string[] {
    const df = this.dataState.activeDataFrame;
    const out: string[] = [];
    if (df === null) {
      return out;
    }
    for (let i = 0; i < df.columns.length; i++) {
      out.push(df.columns[i].name);
    }
    return out;
  }

  private uniqueValues(col: string): string[] {
    const df = this.dataState.activeDataFrame;
    const out: string[] = [];
    if (df === null) {
      return out;
    }
    const idx = df.columnIndex(col);
    if (idx < 0) {
      return out;
    }
    const seen = new Set<string>();
    for (let r = 0; r < df.rows.length && out.length < 100; r++) {
      const v = df.rows[r][idx];
      if (v === null || v === undefined) {
        continue;
      }
      const key = String(v);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(key);
      }
    }
    return out;
  }

  private colOptions(cols: string[]): SelectOption[] {
    const opts: SelectOption[] = [];
    for (let i = 0; i < cols.length; i++) {
      opts.push({ value: cols[i] });
    }
    return opts;
  }

  private colIndexIn(cols: string[], col: string): number {
    for (let i = 0; i < cols.length; i++) {
      if (cols[i] === col) {
        return i;
      }
    }
    return 0;
  }

  private runRegression(): void {
    if (this.regX.length === 0 || this.regY.length === 0 || this.regX === this.regY) {
      return;
    }
    const df = this.dataState.activeDataFrame;
    this.regression = df !== null ? linearRegression(df, this.regX, this.regY) : null;
  }

  private refreshGroupOptions(): void {
    this.groupA = '';
    this.groupB = '';
    this.groupOptions = this.groupCol.length > 0 ? this.uniqueValues(this.groupCol) : [];
  }

  private runDiff(): void {
    if (this.measureCol.length === 0 || this.groupCol.length === 0
      || this.groupA.length === 0 || this.groupB.length === 0 || this.groupA === this.groupB) {
      return;
    }
    const df = this.dataState.activeDataFrame;
    this.difference = df !== null ? welchTTest(df, this.measureCol, this.groupCol, this.groupA, this.groupB) : null;
  }

  private runCi(): void {
    if (this.ciCol.length === 0) {
      return;
    }
    const df = this.dataState.activeDataFrame;
    this.ci = df !== null ? ciMean(df, this.ciCol) : null;
  }

  private corrBg(r: number | null, i: number, j: number): ResourceColor {
    if (r === null || i === j) {
      return Color.Transparent;
    }
    const alpha = Math.min(Math.abs(r), 1).toFixed(2);
    return r >= 0 ? 'rgba(59,130,246,' + alpha + ')' : 'rgba(239,68,68,' + alpha + ')';
  }

  @Builder
  private sectionTitle(label: string) {
    Text(label)
      .fontSize(10)
      .fontWeight(600)
      .fontColor(Theme.colorMuted())
      .alignSelf(ItemAlign.Start)
  }

  private corrColumns(): string[] {
    const c = this.corr;
    return c !== null ? c.columns : [];
  }

  build() {
    Column({ space: 8 }) {
      this.sectionTitle(l10n(this.workspaceState.language, '统计', 'Stats'))

      if (this.numericColumns().length < 2) {
        Text(l10n(this.workspaceState.language, '需要至少两个数值列', 'Needs ≥2 numeric columns'))
          .fontSize(11)
          .fontColor(Theme.colorMuted())
      }

      // Correlation matrix
      if (this.corr !== null && this.corr.ok && this.corr.columns.length >= 2) {
        Column({ space: 4 }) {
          this.sectionTitle(l10n(this.workspaceState.language, '相关系数', 'Correlation'))
          Scroll() {
            Column() {
              ForEach(this.corrColumns(), (rowName: string, i: number) => {
                Row() {
                  Text(rowName)
                    .fontSize(9)
                    .fontColor(Theme.colorMuted())
                    .width(56)
                    .maxLines(1)
                    .textOverflow({ overflow: TextOverflow.Ellipsis })
                  ForEach(this.corrColumns(), (colName: string, j: number) => {
                    Text(i === j ? '' : this.cellText(i, j))
                      .fontSize(9)
                      .fontColor(Theme.colorForeground())
                      .textAlign(TextAlign.Center)
                      .width(34)
                      .height(24)
                      .backgroundColor(this.corrBg(this.cellValue(i, j), i, j))
                  }, (colName: string, j: number) => i.toString() + '_' + j.toString() + '_' + this.tick.toString())
                }
                .width('100%')
              }, (rowName: string, i: number) => i.toString() + '_' + rowName)
            }
            .alignItems(HorizontalAlign.Start)
          }
          .width('100%')
          .scrollable(ScrollDirection.Horizontal)
          .scrollBar(BarState.Auto)
          if (this.corr.pairs.length > 0) {
            Text('• ' + this.corr.pairs[0])
              .fontSize(10)
              .fontColor(Theme.colorMuted())
              .width('100%')
          }
        }
        .width('100%')
        .padding(8)
        .borderRadius(6)
        .border({ width: 1, color: Theme.colorBorder() })
        .backgroundColor(Theme.colorSurface())
        .alignItems(HorizontalAlign.Start)
      }

      // Linear regression
      Column({ space: 6 }) {
        this.sectionTitle(l10n(this.workspaceState.language, '线性回归', 'Regression'))
        Row({ space: 4 }) {
          Select(this.colOptions(this.numericColumns()))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndexIn(this.numericColumns(), this.regX))
            .value(this.regX.length > 0 ? this.regX : 'X')
            .font({ size: 11 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.regX = value;
            })
          Text('~').fontSize(11).fontColor(Theme.colorMuted())
          Select(this.colOptions(this.numericColumns()))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndexIn(this.numericColumns(), this.regY))
            .value(this.regY.length > 0 ? this.regY : 'Y')
            .font({ size: 11 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.regY = value;
            })
          Button() {
            Text('Σ').fontSize(12).fontColor(Theme.primary)
          }
          .type(ButtonType.Normal)
          .height(26)
          .width(30)
          .backgroundColor(Theme.primaryDim)
          .borderRadius(6)
          .onClick(() => {
            this.runRegression();
          })
        }
        .width('100%')
        if (this.regression !== null && this.regression.ok) {
          Text(this.regression.interpretation)
            .fontSize(11)
            .fontColor(Theme.colorForeground())
            .width('100%')
          Text('n=' + this.regression.n.toString() + ' · slope=' + this.regression.slope.toFixed(3)
            + ' · R²=' + (this.regression.r2 !== null ? this.regression.r2.toFixed(3) : '—'))
            .fontSize(10)
            .fontColor(Theme.colorMuted())
            .width('100%')
        } else if (this.regression !== null) {
          Text(this.regression.detail).fontSize(11).fontColor(Theme.danger).width('100%')
        }
      }
      .width('100%')
      .padding(8)
      .borderRadius(6)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurface())
      .alignItems(HorizontalAlign.Start)

      // Difference test
      Column({ space: 6 }) {
        this.sectionTitle(l10n(this.workspaceState.language, '两组差异检验', 'Difference test'))
        Row({ space: 4 }) {
          Select(this.colOptions(this.allColumns()))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndexIn(this.allColumns(), this.groupCol))
            .value(this.groupCol.length > 0 ? this.groupCol : l10n(this.workspaceState.language, '分组列', 'Group'))
            .font({ size: 11 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.groupCol = value;
              this.refreshGroupOptions();
            })
          Select(this.colOptions(this.numericColumns()))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndexIn(this.numericColumns(), this.measureCol))
            .value(this.measureCol.length > 0 ? this.measureCol : l10n(this.workspaceState.language, '数值列', 'Measure'))
            .font({ size: 11 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.measureCol = value;
            })
        }
        .width('100%')
        Row({ space: 4 }) {
          Select(this.colOptions(this.groupOptions))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndexIn(this.groupOptions, this.groupA))
            .value(this.groupA.length > 0 ? this.groupA : 'A')
            .font({ size: 11 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.groupA = value;
            })
          Text(l10n(this.workspaceState.language, '对比', 'vs')).fontSize(10).fontColor(Theme.colorMuted())
          Select(this.colOptions(this.groupOptions))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndexIn(this.groupOptions, this.groupB))
            .value(this.groupB.length > 0 ? this.groupB : 'B')
            .font({ size: 11 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.groupB = value;
            })
          Button() {
            Text('Σ').fontSize(12).fontColor(Theme.primary)
          }
          .type(ButtonType.Normal)
          .height(26)
          .width(30)
          .backgroundColor(Theme.primaryDim)
          .borderRadius(6)
          .onClick(() => {
            this.runDiff();
          })
        }
        .width('100%')
        if (this.difference !== null && this.difference.ok) {
          Column({ space: 2 }) {
            Text(this.difference.interpretation)
              .fontSize(11)
              .fontColor(Theme.colorForeground())
              .width('100%')
            Text(this.difference.method + ' · t=' + this.difference.t.toFixed(2)
              + ' · p≈' + (this.difference.significant ? '<0.05' : '≥0.05') + '（近似）')
              .fontSize(10)
              .fontColor(Theme.colorMuted())
              .width('100%')
          }
          .width('100%')
          .padding(6)
          .borderRadius(6)
          .backgroundColor(this.difference.significant ? Theme.primaryDim : Theme.colorSurface())
          .alignItems(HorizontalAlign.Start)
        } else if (this.difference !== null) {
          Text(this.difference.detail).fontSize(11).fontColor(Theme.danger).width('100%')
        }
      }
      .width('100%')
      .padding(8)
      .borderRadius(6)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurface())
      .alignItems(HorizontalAlign.Start)

      // CI of mean
      Column({ space: 6 }) {
        this.sectionTitle(l10n(this.workspaceState.language, '均值 95% 置信区间', '95% CI of mean'))
        Row({ space: 4 }) {
          Select(this.colOptions(this.numericColumns()))
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .selected(this.colIndexIn(this.numericColumns(), this.ciCol))
            .value(this.ciCol.length > 0 ? this.ciCol : l10n(this.workspaceState.language, '数值列', 'Column'))
            .font({ size: 11 })
            .height(26)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((index: number, value: string) => {
              this.ciCol = value;
            })
          Button() {
            Text('95%').fontSize(11).fontColor(Theme.primary)
          }
          .type(ButtonType.Normal)
          .height(26)
          .padding({ left: 10, right: 10 })
          .backgroundColor(Theme.primaryDim)
          .borderRadius(6)
          .onClick(() => {
            this.runCi();
          })
        }
        .width('100%')
        if (this.ci !== null && this.ci.ok) {
          Text(l10n(this.workspaceState.language,
            this.ci.column + ' 均值 ' + this.ci.mean.toFixed(2) + '，95% CI [' + this.ci.low.toFixed(2) + ', ' + this.ci.high.toFixed(2) + ']',
            this.ci.column + ' mean ' + this.ci.mean.toFixed(2) + ', 95% CI [' + this.ci.low.toFixed(2) + ', ' + this.ci.high.toFixed(2) + ']'))
            .fontSize(11)
            .fontColor(Theme.colorForeground())
            .width('100%')
          Text('n=' + this.ci.n.toString() + ' · level=0.95')
            .fontSize(10)
            .fontColor(Theme.colorMuted())
            .width('100%')
        } else if (this.ci !== null) {
          Text(this.ci.detail).fontSize(11).fontColor(Theme.danger).width('100%')
        }
      }
      .width('100%')
      .padding(8)
      .borderRadius(6)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurface())
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private cellValue(i: number, j: number): number | null {
    const c = this.corr;
    if (c === null || i >= c.matrix.length || j >= c.matrix[i].length) {
      return null;
    }
    return c.matrix[i][j];
  }

  private cellText(i: number, j: number): string {
    const v = this.cellValue(i, j);
    return v === null ? '—' : v.toFixed(2);
  }
}
