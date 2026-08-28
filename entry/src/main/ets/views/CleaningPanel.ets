import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { Settings } from '../common/Settings';
import { fmt } from '../common/Format';
import { CellValue, DataFrame, TransformOp } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { Insight, QualityReport, computeQualityReport } from '../engine/Insights';
import { ColumnStats, computeAllColumnStats } from '../engine/ColumnStats';
import { FillMissingParams } from '../engine/TransformOps';

/**
 * Cleaning panel (web: src/components/data/CleaningPanel.tsx). Quality scan,
 * suggested safe fixes with preview/apply, and named cleaning recipes —
 * recipes persist locally in Preferences (web stores them in the backend).
 */
interface RecipeShim {
  id: string;
  name: string;
  ops: TransformOp[];
}

const PRESET_DEDUPE = 'preset_dedupe';
const PRESET_DROPNA = 'preset_dropna';

/** JSON document shapes for recipe persistence. */
interface RecipeDoc {
  id: string;
  name: string;
  ops: RecipeOpDoc[];
}
interface RecipeOpDoc {
  type: string;
  params: string;
}

@Component
export struct CleaningPanel {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State report: QualityReport | null = null;
  @State fixOps: TransformOp[] = [];
  @State fixRightRows: number = -1;
  @State fixRightCols: number = -1;
  @State saveOpen: boolean = false;
  @State saveName: string = '';
  @State recipes: RecipeShim[] = [];
  @State showColStats: boolean = false;
  @State tick: number = 0;

  aboutToAppear(): void {
    this.rescan();
    this.loadRecipes();
  }

  private rescan(): void {
    const df = this.dataState.activeDataFrame;
    this.report = df !== null ? computeQualityReport(df) : null;
    this.fixOps = [];
    this.fixRightRows = -1;
    this.fixRightCols = -1;
    this.tick++;
  }

  private colStats(): ColumnStats[] {
    const df = this.dataState.activeDataFrame;
    return df !== null ? computeAllColumnStats(df) : [];
  }

  private hasFixableIssues(): boolean {
    const rep = this.report;
    if (rep === null) {
      return false;
    }
    return rep.summary.missingCells > 0 || rep.summary.duplicateRows > 0;
  }

  /** Derive a safe fix plan (web /quality-fix/preview): fill numeric missing with 0, dedupe. */
  private buildPlan(): void {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return;
    }
    const rep = computeQualityReport(df);
    const ops: TransformOp[] = [];
    for (let c = 0; c < df.columns.length; c++) {
      const col = df.columns[c];
      if (col.dtype !== 'number') {
        continue;
      }
      let missing = 0;
      for (let r = 0; r < df.rows.length; r++) {
        const v = df.rows[r][c];
        if (v === null || v === undefined) {
          missing++;
        }
      }
      if (missing > 0) {
        ops.push(new TransformOp('fillMissing', JSON.stringify({ column: col.name, value: '0' })));
      }
    }
    if (rep.summary.duplicateRows > 0) {
      ops.push(new TransformOp('dedupe', JSON.stringify({ columns: null })));
    }
    this.fixOps = ops;
    if (ops.length === 0) {
      promptAction.showToast({ message: l10n(this.workspaceState.language, '没有安全的自动修复项', 'No safe auto fixes') });
      return;
    }
    // Simulate on a clone to show the row/col delta (web fix plan diff).
    let sim = df.clone();
    for (let i = 0; i < ops.length; i++) {
      try {
        const op = ops[i];
        if (op.type === 'fillMissing') {
          const p = JSON.parse(op.params) as FillMissingParams;
          sim = applyFill(sim, p.column, p.value);
        } else if (op.type === 'dedupe') {
          sim = applyDedupe(sim);
        }
      } catch (e) {
        // skip broken step in preview
      }
    }
    this.fixRightRows = sim.rowCount;
    this.fixRightCols = sim.colCount;
    this.tick++;
  }

  private applyFixes(): void {
    if (this.fixOps.length === 0) {
      return;
    }
    let applied = 0;
    for (let i = 0; i < this.fixOps.length; i++) {
      if (this.dataState.applyTransform(this.fixOps[i])) {
        applied++;
      }
    }
    if (applied > 0) {
      promptAction.showToast({ message: l10n(this.workspaceState.language, '已应用 ' + applied + ' 个修复', applied + ' fixes applied') });
    } else {
      promptAction.showToast({ message: l10n(this.workspaceState.language, '应用失败', 'Apply failed') });
    }
    this.rescan();
  }

  private applyPreset(presetId: string): void {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return;
    }
    if (presetId === PRESET_DEDUPE) {
      this.dataState.applyTransform(new TransformOp('dedupe', JSON.stringify({ columns: null })));
    } else if (presetId === PRESET_DROPNA) {
      this.dataState.applyTransform(new TransformOp('dropNa', JSON.stringify({ columns: null })));
    }
    this.rescan();
  }

  private loadRecipes(): void {
    try {
      const raw = Settings.loadRecipes();
      if (raw.length === 0) {
        this.recipes = [];
        return;
      }
      const data = JSON.parse(raw) as RecipeDoc[];
      const out: RecipeShim[] = [];
      for (let i = 0; i < data.length; i++) {
        const r = data[i];
        const ops: TransformOp[] = [];
        if (r.ops !== undefined) {
          for (let k = 0; k < r.ops.length; k++) {
            if (r.ops[k].type !== undefined && r.ops[k].params !== undefined) {
              ops.push(new TransformOp(r.ops[k].type as string, r.ops[k].params as string));
            }
          }
        }
        out.push({
          id: r.id !== undefined ? r.id : 'recipe_' + i.toString(),
          name: r.name !== undefined ? r.name : 'recipe',
          ops: ops,
        });
      }
      this.recipes = out;
    } catch (e) {
      this.recipes = [];
    }
  }

  private persistRecipes(): void {
    const arr: RecipeDoc[] = [];
    for (let i = 0; i < this.recipes.length; i++) {
      const r = this.recipes[i];
      const ops: RecipeOpDoc[] = [];
      for (let k = 0; k < r.ops.length; k++) {
        const o: RecipeOpDoc = { type: r.ops[k].type, params: r.ops[k].params };
        ops.push(o);
      }
      const entry: RecipeDoc = { id: r.id, name: r.name, ops: ops };
      arr.push(entry);
    }
    Settings.saveRecipes(JSON.stringify(arr));
  }

  private saveRecipe(): void {
    const name = this.saveName.trim();
    if (name.length === 0) {
      return;
    }
    const steps = this.dataState.transformHistory;
    if (steps.length === 0) {
      promptAction.showToast({ message: l10n(this.workspaceState.language, '没有可保存的变换', 'No transforms to save') });
      return;
    }
    const ops: TransformOp[] = [];
    for (let i = 0; i < steps.length; i++) {
      ops.push(steps[i].op);
    }
    this.recipes.push({
      id: 'recipe_' + Date.now().toString(),
      name: name,
      ops: ops,
    });
    this.persistRecipes();
    this.saveName = '';
    this.saveOpen = false;
    this.tick++;
    promptAction.showToast({ message: l10n(this.workspaceState.language, '配方已保存', 'Recipe saved') });
  }

  private applyCustomRecipe(r: RecipeShim): void {
    let applied = 0;
    for (let i = 0; i < r.ops.length; i++) {
      if (this.dataState.applyTransform(r.ops[i])) {
        applied++;
      }
    }
    promptAction.showToast({
      message: applied > 0
        ? l10n(this.workspaceState.language, '配方已应用（' + applied + ' 步）', 'Recipe applied (' + applied + ' ops)')
        : l10n(this.workspaceState.language, '应用失败', 'Apply failed'),
    });
    this.rescan();
  }

  private deleteRecipe(id: string): void {
    const next: RecipeShim[] = [];
    for (let i = 0; i < this.recipes.length; i++) {
      if (this.recipes[i].id !== id) {
        next.push(this.recipes[i]);
      }
    }
    this.recipes = next;
    this.persistRecipes();
    this.tick++;
  }

  build() {
    Column({ space: 8 }) {
      Text(l10n(this.workspaceState.language, '清洗', 'Cleaning'))
        .fontSize(12)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)

      if (this.report === null) {
        Text(t(this.workspaceState.language, 'insights.noData'))
          .fontSize(11)
          .fontColor(Theme.colorMuted())
      } else {
        if (this.hasFixableIssues()) {
          Button() {
            Row({ space: 4 }) {
              SymbolGlyph($r('sys.symbol.wand_and_stars'))
                .fontSize(12)
                .fontColor([Color.White])
              Text(l10n(this.workspaceState.language, '预览建议修复', 'Preview suggested fixes'))
                .fontSize(11)
                .fontColor(Color.White)
            }
          }
          .width('100%')
          .height(28)
          .backgroundColor(Theme.primary)
          .borderRadius(6)
          .onClick(() => {
            this.buildPlan();
          })
        }

        if (this.report.issues.length === 0) {
          Text(l10n(this.workspaceState.language, '✓ 未发现数据质量问题', '✓ No quality issues found'))
            .fontSize(11)
            .fontColor(Theme.success)
        }

        if (this.report.summary.missingCells > 0 || this.report.summary.duplicateRows > 0) {
          Text(l10n(this.workspaceState.language,
            '缺失单元格 ' + this.report.summary.missingCells + ' · 重复行 ' + this.report.summary.duplicateRows,
            'missing cells ' + this.report.summary.missingCells + ' · duplicate rows ' + this.report.summary.duplicateRows))
            .fontSize(10)
            .fontColor(Theme.colorMuted())
            .width('100%')
            .padding(6)
            .borderRadius(6)
            .border({ width: 1, color: Theme.colorBorder() })
            .backgroundColor(Theme.colorSurface())
        }

        // Fix plan preview
        if (this.fixOps.length > 0) {
          Column({ space: 4 }) {
            Text(l10n(this.workspaceState.language, '修复计划', 'Fix plan'))
              .fontSize(11)
              .fontWeight(600)
              .fontColor(Theme.colorForeground())
            ForEach(this.fixOps, (op: TransformOp, idx: number) => {
              Text((idx + 1).toString() + '. ' + op.type + ' ' + op.params)
                .fontSize(10)
                .fontColor(Theme.colorMuted())
                .width('100%')
            }, (op: TransformOp, idx: number) => idx.toString() + '_' + op.type + '_' + this.tick.toString())
            Text(l10n(this.workspaceState.language,
              '行数 ' + this.fixOps.length + ' 项修复 → ' + this.fixRightRows + ' 行 × ' + this.fixRightCols + ' 列',
              this.fixOps.length + ' fixes → ' + this.fixRightRows + ' rows × ' + this.fixRightCols + ' cols'))
              .fontSize(10)
              .fontColor(Theme.colorMuted())
            Row({ space: 6 }) {
              Button() {
                Text(l10n(this.workspaceState.language, '应用', 'Apply'))
                  .fontSize(11)
                  .fontColor(Color.White)
              }
              .type(ButtonType.Normal)
              .layoutWeight(1)
              .height(26)
              .backgroundColor(Theme.primary)
              .borderRadius(6)
              .onClick(() => {
                this.applyFixes();
              })
              Button() {
                Text(l10n(this.workspaceState.language, '取消', 'Cancel'))
                  .fontSize(11)
                  .fontColor(Theme.colorMuted())
              }
              .type(ButtonType.Normal)
              .layoutWeight(1)
              .height(26)
              .backgroundColor(Theme.colorSurface())
              .borderRadius(6)
              .onClick(() => {
                this.fixOps = [];
              })
            }
            .width('100%')
          }
          .width('100%')
          .padding(8)
          .borderRadius(6)
          .border({ width: 1, color: Theme.primary })
          .backgroundColor(Theme.colorSurface())
          .alignItems(HorizontalAlign.Start)
        }

        // Issues
        ForEach(this.report.issues, (issue: Insight, idx: number) => {
          Column({ space: 2 }) {
            Row({ space: 6 }) {
              Text(issue.severity === 'warning' ? '⚠' : 'ℹ')
                .fontSize(11)
                .fontColor(issue.severity === 'warning' ? Theme.warning : Theme.primary)
              Text(issue.title)
                .fontSize(11)
                .fontWeight(600)
                .fontColor(Theme.colorForeground())
            }
            .width('100%')
            Text(issue.detail)
              .fontSize(11)
              .fontColor(Theme.colorMuted())
              .width('100%')
          }
          .width('100%')
          .padding(8)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())
          .alignItems(HorizontalAlign.Start)
        }, (issue: Insight, idx: number) => idx.toString() + '_' + issue.title + '_' + this.tick.toString())

        // Presets (web backend presets; local safe subset)
        Row({ space: 4 }) {
          Button() {
            Text(l10n(this.workspaceState.language, '去重', 'Dedupe')).fontSize(10).fontColor(Theme.colorMuted())
          }
          .type(ButtonType.Normal).height(24).padding({ left: 8, right: 8 })
          .backgroundColor(Theme.colorSurface()).borderRadius(8)
          .onClick(() => {
            this.applyPreset(PRESET_DEDUPE);
          })
          Button() {
            Text(l10n(this.workspaceState.language, '去缺失行', 'Drop NA')).fontSize(10).fontColor(Theme.colorMuted())
          }
          .type(ButtonType.Normal).height(24).padding({ left: 8, right: 8 })
          .backgroundColor(Theme.colorSurface()).borderRadius(8)
          .onClick(() => {
            this.applyPreset(PRESET_DROPNA);
          })
        }
        .width('100%')

        // Column-level quality stats (web details block)
        Button() {
          Text(l10n(this.workspaceState.language,
            (this.showColStats ? '▾ ' : '▸ ') + '列级质量统计',
            (this.showColStats ? '▾ ' : '▸ ') + 'Column quality stats'))
            .fontSize(10)
            .fontColor(Theme.colorMuted())
        }
        .type(ButtonType.Normal)
        .width('100%')
        .height(24)
        .backgroundColor(Color.Transparent)
        .padding({ left: 0, right: 0 })
        .onClick(() => {
          this.showColStats = !this.showColStats;
        })
        if (this.showColStats) {
          Column({ space: 2 }) {
            Row() {
              Text(l10n(this.workspaceState.language, '列', 'Column')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2)
              Text(l10n(this.workspaceState.language, '缺失', 'Miss')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(1)
              Text(l10n(this.workspaceState.language, '唯一', 'Uniq')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(1)
              Text(l10n(this.workspaceState.language, '范围', 'Range')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2)
            }
            .width('100%')
            ForEach(this.colStats(), (s: ColumnStats) => {
              Row() {
                Text(s.column).fontSize(9).fontColor(Theme.colorForeground()).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(2)
                Text(this.missPct(s)).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(1)
                Text(s.uniqueCount.toString()).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(1)
                Text(this.rangeText(s)).fontSize(9).fontColor(Theme.colorMuted()).maxLines(1).textOverflow({ overflow: TextOverflow.Ellipsis }).layoutWeight(2)
              }
              .width('100%')
              .padding({ top: 2, bottom: 2 })
              .border({ width: { top: 0.5 }, color: Theme.colorBorder() })
            }, (s: ColumnStats) => s.column + '_' + this.tick.toString())
          }
          .width('100%')
          .padding(6)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())
        }

        // My recipes
        Row() {
          Text(l10n(this.workspaceState.language, '我的配方', 'My recipes'))
            .fontSize(10)
            .fontWeight(600)
            .fontColor(Theme.colorMuted())
          Blank()
          Button() {
            Text(l10n(this.workspaceState.language, '保存当前变换', 'Save current'))
              .fontSize(10)
              .fontColor(Theme.colorMuted())
          }
          .type(ButtonType.Normal)
          .height(22)
          .padding({ left: 8, right: 8 })
          .backgroundColor(Color.Transparent)
          .onClick(() => {
            this.saveOpen = !this.saveOpen;
          })
        }
        .width('100%')

        if (this.saveOpen) {
          Row({ space: 4 }) {
            TextInput({ placeholder: l10n(this.workspaceState.language, '配方名称', 'Recipe name'), text: this.saveName })
              .layoutWeight(1)
              .height(28)
              .fontSize(12)
              .backgroundColor(Theme.colorSurface())
              .borderRadius(6)
              .onChange((v: string) => {
                this.saveName = v;
              })
            Button() {
              Text(l10n(this.workspaceState.language, '保存', 'Save')).fontSize(11).fontColor(Color.White)
            }
            .height(28)
            .padding({ left: 10, right: 10 })
            .backgroundColor(Theme.primary)
            .borderRadius(6)
            .onClick(() => {
              this.saveRecipe();
            })
          }
          .width('100%')
        }

        ForEach(this.recipes, (r: RecipeShim) => {
          Row({ space: 6 }) {
            Text(r.name)
              .fontSize(11)
              .fontColor(Theme.colorForeground())
              .maxLines(1)
              .textOverflow({ overflow: TextOverflow.Ellipsis })
              .layoutWeight(1)
            Text('▶')
              .fontSize(12)
              .fontColor(Theme.primary)
              .padding(4)
              .onClick(() => {
                this.applyCustomRecipe(r);
              })
            Text('🗑')
              .fontSize(11)
              .fontColor(Theme.colorMuted())
              .padding(4)
              .onClick(() => {
                this.deleteRecipe(r.id);
              })
          }
          .width('100%')
          .padding({ left: 8, right: 4, top: 4, bottom: 4 })
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())
        }, (r: RecipeShim) => r.id + '_' + this.tick.toString())

        if (this.recipes.length === 0 && !this.saveOpen) {
          Text(l10n(this.workspaceState.language, '做几步变换后，可保存为配方一键重放', 'Apply transforms, then save them as a reusable recipe'))
            .fontSize(10)
            .fontColor(Theme.colorMuted())
        }
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private missPct(s: ColumnStats): string {
    const total = s.count + s.missing;
    return total > 0 ? Math.round((s.missing / total) * 100).toString() + '%' : '0%';
  }

  private rangeText(s: ColumnStats): string {
    if (s.mean !== null) {
      return (s.min !== null ? s.min.toString() : '—') + '–' + (s.max !== null ? s.max.toString() : '—');
    }
    return '—';
  }
}

// local safe-fix appliers mirroring TransformOps behaviour for the preview
function applyFill(df: DataFrame, column: string, value: string): DataFrame {
  const next = df.clone();
  const idx = next.columnIndex(column);
  const meta = next.columns[idx];
  const v: CellValue = meta.dtype === 'number' ? (Number(value) || 0) : value;
  for (let r = 0; r < next.rows.length; r++) {
    if (next.rows[r][idx] === null || next.rows[r][idx] === undefined) {
      next.rows[r][idx] = v;
    }
  }
  return next;
}

function applyDedupe(df: DataFrame): DataFrame {
  const next = df.clone();
  const seen = new Set<string>();
  const out: CellValue[][] = [];
  for (let r = 0; r < next.rows.length; r++) {
    const parts: string[] = [];
    for (let c = 0; c < next.columns.length; c++) {
      const v = next.rows[r][c];
      parts.push(v === null || v === undefined ? '' : String(v));
    }
    const key = parts.join('\u0001');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(next.rows[r]);
    }
  }
  next.rows = out;
  return next;
}
