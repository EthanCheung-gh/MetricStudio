import { common } from '@kit.AbilityKit';
import { LengthMetrics } from '@kit.ArkUI';
import { util } from '@kit.ArkTS';
import { promptAction } from '@kit.ArkUI';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { ChartConfig } from '../model/ChartConfig';
import { TransformOp } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { ReportOptions, buildReportHtml } from '../engine/ReportBuilder';

/** Toggle-chip shim for section selection. */
interface SectionChip {
  key: string;
  label: string;
}

/**
 * Report/story export dialog (web: ReportDialog.tsx + StoryDialog.tsx union,
 * local generation instead of the backend). Pick charts + sections + a
 * conclusion; buildReportHtml inlines plotly.min.js and DocumentSavePicker
 * writes a self-contained HTML file.
 */
@Component
export struct ReportDialog {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @State reportTitle: string = '';
  @State selectedChartIds: string[] = [];
  @State includeSource: boolean = true;
  @State includeSteps: boolean = true;
  @State includeInsights: boolean = true;
  @State includeConclusion: boolean = false;
  @State conclusion: string = '';
  @State busy: boolean = false;
  @State chipTick: number = 0;

  aboutToAppear(): void {
    // All charts selected by default (web ReportDialog behavior)
    const charts = this.workspaceState.charts;
    for (let i = 0; i < charts.length; i++) {
      this.selectedChartIds.push(charts[i].id);
    }
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

  private sectionChips(): SectionChip[] {
    const lang = this.workspaceState.language;
    const out: SectionChip[] = [];
    out.push({ key: 'source', label: t(lang, 'report.sectionSource') });
    out.push({ key: 'steps', label: t(lang, 'report.sectionSteps') });
    out.push({ key: 'insights', label: t(lang, 'report.sectionInsights') });
    out.push({ key: 'conclusion', label: t(lang, 'report.sectionConclusion') });
    return out;
  }

  private sectionOn(key: string): boolean {
    if (key === 'source') {
      return this.includeSource;
    }
    if (key === 'steps') {
      return this.includeSteps;
    }
    if (key === 'insights') {
      return this.includeInsights;
    }
    return this.includeConclusion;
  }

  private toggleSection(key: string): void {
    if (key === 'source') {
      this.includeSource = !this.includeSource;
    } else if (key === 'steps') {
      this.includeSteps = !this.includeSteps;
    } else if (key === 'insights') {
      this.includeInsights = !this.includeInsights;
    } else {
      this.includeConclusion = !this.includeConclusion;
    }
  }

  private async generate(): Promise<void> {
    const df = this.dataState.activeDataFrame;
    if (df === null || this.busy) {
      return;
    }
    const charts = this.selectedCharts();
    if (charts.length === 0 && !this.includeSource && !this.includeSteps && !this.includeInsights) {
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
      options.includeSource = this.includeSource;
      options.includeSteps = this.includeSteps;
      options.includeInsights = this.includeInsights;
      options.includeConclusion = this.includeConclusion;
      options.conclusion = this.conclusion;
      options.chartIds = this.selectedChartIds;
      const historyOps: TransformOp[] = [];
      const steps = this.dataState.transformHistory;
      for (let i = 0; i < steps.length; i++) {
        historyOps.push(steps[i].op);
      }
      const html = buildReportHtml(df, charts, historyOps, options, plotlyJs,
        this.workspaceState.language);

      const documentPicker = new picker.DocumentViewPicker(getContext(this));
      const saveOpts = new picker.DocumentSaveOptions();
      saveOpts.newFileNames = ['metricstudio-report.html'];
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
          Text(t(this.workspaceState.language, 'report.title'))
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

        TextInput({ placeholder: t(this.workspaceState.language, 'report.namePlaceholder'), text: this.reportTitle })
          .width('100%')
          .height(32)
          .padding({ top: 0, bottom: 0 })
          .placeholderFont({ size: 13 })
          .placeholderColor(Theme.colorMuted())
          .fontSize(13)
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

        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
          ForEach(this.sectionChips(), (chip: SectionChip) => {
            this.chip(chip.label, this.sectionOn(chip.key), () => {
              this.toggleSection(chip.key);
            })
          }, (chip: SectionChip) => chip.key)
        }
        .width('100%')

        if (this.includeConclusion) {
          TextArea({ placeholder: t(this.workspaceState.language, 'report.conclusionPlaceholder'), text: this.conclusion })
            .width('100%')
            .height(72)
            .fontSize(12)
            .fontColor(Theme.colorForeground())
            .backgroundColor(Theme.colorSurface())
            .borderRadius(6)
            .onChange((v: string) => {
              this.conclusion = v;
            })
        }

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
