import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { LengthMetrics, promptAction } from '@kit.ArkUI';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { Settings } from '../common/Settings';
import { ChartConfig } from '../model/ChartConfig';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { ReportOptions, buildReportHtml } from '../engine/ReportBuilder';

/** Persisted report template (web types ReportTemplate). */
interface ReportTemplateJson {
  id: string;
  name: string;
  title: string;
  chartIds: string[];
  notes: string;
  includeInsights: boolean;
}

/**
 * Report dialog (web ReportDialog.tsx): title + chart multi-select (all
 * selected by default) + notes draft (persisted) + include-insights switch +
 * report templates (web uiStore reportTemplates → local Preferences).
 * Story mode lives in StoryDialog (web split).
 */
@Component
export struct ReportDialog {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @State reportTitle: string = '';
  @State selectedChartIds: string[] = [];
  @State includeInsights: boolean = true;
  @State notes: string = '';
  @State templates: ReportTemplateJson[] = [];
  @State busy: boolean = false;
  @State chipTick: number = 0;

  aboutToAppear(): void {
    // All charts selected by default (web ReportDialog behavior)
    const charts = this.workspaceState.charts;
    for (let i = 0; i < charts.length; i++) {
      this.selectedChartIds.push(charts[i].id);
    }
    this.reportTitle = t(this.workspaceState.language, 'report.untitled');
    this.notes = Settings.loadNotesDraft();
    this.loadTemplates();
  }

  private loadTemplates(): void {
    try {
      const raw = Settings.loadReportTemplates();
      if (raw.length > 0) {
        this.templates = JSON.parse(raw) as ReportTemplateJson[];
        return;
      }
    } catch (e) {
      // fall through
    }
    this.templates = [];
  }

  private persistTemplates(): void {
    Settings.saveReportTemplates(JSON.stringify(this.templates));
  }

  private saveTemplate(): void {
    const name = l10n(this.workspaceState.language, '模板 ' + (this.templates.length + 1).toString(),
      'Template ' + (this.templates.length + 1).toString());
    this.templates.push({
      id: 'tpl_' + Date.now().toString(),
      name: name,
      title: this.reportTitle,
      chartIds: this.selectedChartIds.slice(),
      notes: this.notes,
      includeInsights: this.includeInsights,
    });
    this.persistTemplates();
    this.chipTick++;
    promptAction.showToast({ message: t(this.workspaceState.language, 'report.templateSaved') });
  }

  private applyTemplate(id: string): void {
    for (let i = 0; i < this.templates.length; i++) {
      if (this.templates[i].id === id) {
        this.reportTitle = this.templates[i].title;
        this.selectedChartIds = this.templates[i].chartIds.slice();
        this.notes = this.templates[i].notes;
        this.includeInsights = this.templates[i].includeInsights;
        this.chipTick++;
        return;
      }
    }
  }

  private templateOptions(): SelectOption[] {
    const opts: SelectOption[] = [];
    for (let i = 0; i < this.templates.length; i++) {
      opts.push({ value: this.templates[i].name });
    }
    return opts;
  }

  private toggleChart(id: string): void {
    const next: string[] = [];
    let removed = false;
    for (let i = 0; i < this.selectedChartIds.length; i++) {
      if (this.selectedChartIds[i] === id) {
        removed = true;
      } else {
        next.push(this.selectedChartIds[i]);
      }
    }
    if (!removed) {
      next.push(id);
    }
    this.selectedChartIds = next;
    this.chipTick++;
  }

  private selectedCharts(): ChartConfig[] {
    const out: ChartConfig[] = [];
    const charts = this.workspaceState.charts;
    for (let i = 0; i < charts.length; i++) {
      if (this.selectedChartIds.indexOf(charts[i].id) >= 0) {
        out.push(charts[i]);
      }
    }
    return out;
  }

  private async generate(): Promise<void> {
    const df = this.dataState.activeDataFrame;
    if (df === null || this.busy) {
      return;
    }
    const charts = this.selectedCharts();
    if (charts.length === 0) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'report.noCharts') });
      return;
    }
    this.busy = true;
    try {
      const ctx = getContext(this) as common.UIAbilityContext;
      const raw = await ctx.resourceManager.getRawFileContent('plotly.min.js');
      const decoder = util.TextDecoder.create('utf-8');
      const plotlyJs = decoder.decodeToString(raw);
      const options: ReportOptions = new ReportOptions();
      options.title = this.reportTitle;
      options.includeSource = false;
      options.includeSteps = false;
      options.includeInsights = this.includeInsights;
      options.includeConclusion = false;
      options.notes = this.notes;
      options.chartIds = this.selectedChartIds;
      const html = buildReportHtml(df, charts, [], options, plotlyJs,
        this.workspaceState.language);

      const documentPicker = new picker.DocumentViewPicker(getContext(this));
      const saveOpts = new picker.DocumentSaveOptions();
      saveOpts.newFileNames = [t(this.workspaceState.language, 'report.fileName') + '.html'];
      const uris = await documentPicker.save(saveOpts);
      if (uris.length === 0) {
        this.busy = false;
        return;
      }
      const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
      fs.writeSync(file.fd, html);
      fs.closeSync(file);
      promptAction.showToast({ message: t(this.workspaceState.language, 'report.generated') });
      this.workspaceState.setReportOpen(false);
    } catch (e) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'report.failed') });
    }
    this.busy = false;
  }

  @Builder
  chip(label: string, active: boolean, onToggle: () => void) {
    Button() {
      Text(label)
        .fontSize(11)
        .fontColor(active ? Theme.primary : Theme.colorMuted())
    }
    .type(ButtonType.Normal)
    .height(26)
    .padding({ left: 10, right: 10 })
    .backgroundColor(active ? Theme.primaryDim : Color.Transparent)
    .borderRadius(10)
    .border({ width: 1, color: active ? Theme.primary : Theme.colorBorder() })
    .onClick(() => {
      onToggle();
    })
  }

  build() {
    Stack() {
      // Dim backdrop (tap to close)
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.workspaceState.setReportOpen(false);
        })

      Column({ space: 10 }) {
        Row() {
          Text(t(this.workspaceState.language, 'report.dialogTitle'))
            .fontSize(14)
            .fontWeight(600)
            .fontColor(Theme.colorForeground())
          Blank()
          Text('×')
            .fontSize(16)
            .fontColor(Theme.colorMuted())
            .padding(4)
            .onClick(() => {
              this.workspaceState.setReportOpen(false);
            })
        }
        .width('100%')

        TextInput({ text: this.reportTitle })
          .width('100%')
          .height(32)
          .padding({ top: 0, bottom: 0 })
          .fontSize(13)
          .fontColor(Theme.colorForeground())
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onChange((v: string) => {
            this.reportTitle = v;
          })

        Text(t(this.workspaceState.language, 'report.selectCharts'))
          .fontSize(11)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)

        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
          ForEach(this.workspaceState.charts, (chart: ChartConfig) => {
            this.chip(chart.name, this.selectedChartIds.indexOf(chart.id) >= 0, () => {
              this.toggleChart(chart.id);
            })
          }, (chart: ChartConfig) => chart.id + '_' + this.chipTick.toString())
        }
        .width('100%')

        if (this.workspaceState.charts.length === 0) {
          Text(t(this.workspaceState.language, 'report.noCharts'))
            .fontSize(11)
            .fontColor(Theme.colorMuted())
            .alignSelf(ItemAlign.Start)
        }

        // includeInsights + notes draft (web uiStore reportNotesDraft)
        Row({ space: 6 }) {
          Checkbox()
            .select(this.includeInsights)
            .width(16)
            .height(16)
            .onChange((v: boolean) => {
              this.includeInsights = v;
            })
          Text(t(this.workspaceState.language, 'report.includeInsights'))
            .fontSize(12)
            .fontColor(Theme.colorForeground())
          Blank()
        }
        .width('100%')
        .alignItems(VerticalAlign.Center)

        Text(t(this.workspaceState.language, 'report.notes'))
          .fontSize(11)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)
        TextArea({ placeholder: t(this.workspaceState.language, 'report.notesPlaceholder'), text: this.notes })
          .width('100%')
          .height(64)
          .fontSize(12)
          .fontColor(Theme.colorForeground())
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onChange((v: string) => {
            this.notes = v;
            Settings.saveNotesDraft(v);
          })

        // Templates (web 应用报告模板… / 保存模板)
        Row({ space: 6 }) {
          Select(this.templateOptions())
            .fontColor(Theme.colorForeground())
            .border({ width: 1, color: Theme.colorBorder() })
            .value(t(this.workspaceState.language, 'report.applyTemplate'))
            .font({ size: 11 })
            .height(28)
            .layoutWeight(1)
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onSelect((_i: number, value: string) => {
              for (let k = 0; k < this.templates.length; k++) {
                if (this.templates[k].name === value) {
                  this.applyTemplate(this.templates[k].id);
                  break;
                }
              }
            })
          Button() {
            Text(t(this.workspaceState.language, 'report.saveTemplate'))
              .fontSize(11)
              .fontColor(Theme.primary)
          }
          .type(ButtonType.Normal)
          .height(28)
          .padding({ left: 10, right: 10 })
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .onClick(() => {
            this.saveTemplate();
          })
        }
        .width('100%')

        Row() {
          Blank()
          if (this.busy) {
            LoadingProgress()
              .width(16)
              .height(16)
              .color(Theme.primary)
              .margin({ right: 8 })
          }
          Button() {
            Text(t(this.workspaceState.language, 'report.generate'))
              .fontSize(12)
              .fontColor(Color.White)
          }
          .height(30)
          .padding({ left: 16, right: 16 })
          .backgroundColor(Theme.primary)
          .borderRadius(6)
          .onClick(() => {
            this.generate();
          })
        }
        .width('100%')
      }
      .width(560)
      .constraintSize({ maxWidth: '92%' })
      .padding(14)
      .borderRadius(12)
      .border({ width: 1, color: Theme.colorBorder() })
      .backgroundColor(Theme.colorSurfaceElevated())
      .shadow({ radius: 32, color: 'rgba(0,0,0,0.5)', offsetY: 8 })
      .alignItems(HorizontalAlign.Start)
    }
    .width('100%')
    .height('100%')
  }
}
