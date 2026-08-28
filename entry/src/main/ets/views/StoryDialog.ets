import { common } from '@kit.AbilityKit';
import { util } from '@kit.ArkTS';
import { LengthMetrics, promptAction } from '@kit.ArkUI';
import { fileIo as fs, picker } from '@kit.CoreFileKit';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { ChartConfig } from '../model/ChartConfig';
import { TransformOp } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { ReportOptions, buildReportHtml } from '../engine/ReportBuilder';

/** Toggle-chip shim for story section material. */
interface StoryChip {
  key: string;
  label: string;
}

/**
 * Story dialog (web StoryDialog.tsx): narrative one-page HTML assembled from
 * section material — 数据来源 / 清洗步骤 / 图表 / 洞察 checkboxes plus a
 * hand-written conclusion. All-empty material → error toast (web 400 parity).
 */
@Component
export struct StoryDialog {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @State storyTitle: string = '';
  @State selectedChartIds: string[] = [];
  @State includeSource: boolean = true;
  @State includeSteps: boolean = true;
  @State includeInsights: boolean = true;
  @State conclusion: string = '';
  @State busy: boolean = false;
  @State chipTick: number = 0;

  aboutToAppear(): void {
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

  private chipList(): StoryChip[] {
    const lang = this.workspaceState.language;
    const out: StoryChip[] = [];
    out.push({ key: 'source', label: t(lang, 'story.sectionSource') });
    out.push({ key: 'steps', label: t(lang, 'story.sectionSteps') });
    out.push({ key: 'insights', label: t(lang, 'story.sectionInsights') });
    return out;
  }

  private chipOn(key: string): boolean {
    if (key === 'source') {
      return this.includeSource;
    }
    if (key === 'steps') {
      return this.includeSteps;
    }
    return this.includeInsights;
  }

  private toggleChip(key: string): void {
    if (key === 'source') {
      this.includeSource = !this.includeSource;
    } else if (key === 'steps') {
      this.includeSteps = !this.includeSteps;
    } else {
      this.includeInsights = !this.includeInsights;
    }
  }

  private storyFileName(): string {
    let name = this.storyTitle.trim();
    if (name.length === 0) {
      name = t(this.workspaceState.language, 'story.title');
    }
    return name.replace(/[^\w\u4e00-\u9fff-]+/g, '_') + '.html';
  }

  private async generate(): Promise<void> {
    const df = this.dataState.activeDataFrame;
    if (df === null || this.busy) {
      return;
    }
    const charts: ChartConfig[] = [];
    const all = this.workspaceState.charts;
    for (let i = 0; i < all.length; i++) {
      if (this.selectedChartIds.indexOf(all[i].id) >= 0) {
        charts.push(all[i]);
      }
    }
    const hasMaterial = charts.length > 0 || this.includeSource || this.includeSteps
      || this.includeInsights || this.conclusion.trim().length > 0;
    if (!hasMaterial) {
      promptAction.showToast({ message: t(this.workspaceState.language, 'story.empty') });
      return;
    }
    this.busy = true;
    try {
      const ctx = getContext(this) as common.UIAbilityContext;
      const raw = await ctx.resourceManager.getRawFileContent('plotly.min.js');
      const decoder = util.TextDecoder.create('utf-8');
      const plotlyJs = decoder.decodeToString(raw);
      const options: ReportOptions = new ReportOptions();
      options.title = this.storyTitle.trim().length > 0 ? this.storyTitle : t(this.workspaceState.language, 'story.title');
      options.includeSource = this.includeSource;
      options.includeSteps = this.includeSteps;
      options.includeInsights = this.includeInsights;
      options.includeConclusion = this.conclusion.trim().length > 0;
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
      saveOpts.newFileNames = [this.storyFileName()];
      const uris = await documentPicker.save(saveOpts);
      if (uris.length === 0) {
        this.busy = false;
        return;
      }
      const file = fs.openSync(uris[0], fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE);
      fs.writeSync(file.fd, html);
      fs.closeSync(file);
      promptAction.showToast({ message: t(this.workspaceState.language, 'story.generated') });
      this.workspaceState.setStoryOpen(false);
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
      Column()
        .width('100%')
        .height('100%')
        .backgroundColor('rgba(0,0,0,0.45)')
        .onClick(() => {
          this.workspaceState.setStoryOpen(false);
        })

      Column({ space: 10 }) {
        Row() {
          Text(t(this.workspaceState.language, 'story.dialogTitle'))
            .fontSize(14)
            .fontWeight(600)
            .fontColor(Theme.colorForeground())
          Blank()
          Text('×')
            .fontSize(16)
            .fontColor(Theme.colorMuted())
            .padding(4)
            .onClick(() => {
              this.workspaceState.setStoryOpen(false);
            })
        }
        .width('100%')

        Text(t(this.workspaceState.language, 'story.material'))
          .fontSize(11)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)

        Flex({ wrap: FlexWrap.Wrap, space: { main: LengthMetrics.vp(4), cross: LengthMetrics.vp(4) } }) {
          ForEach(this.chipList(), (chip: StoryChip) => {
            this.chip(chip.label, this.chipOn(chip.key), () => {
              this.toggleChip(chip.key);
            })
          }, (chip: StoryChip) => chip.key)
          ForEach(this.workspaceState.charts, (chart: ChartConfig) => {
            this.chip(chart.name, this.selectedChartIds.indexOf(chart.id) >= 0, () => {
              this.toggleChart(chart.id);
            })
          }, (chart: ChartConfig) => 'c_' + chart.id + '_' + this.chipTick.toString())
        }
        .width('100%')

        Text(t(this.workspaceState.language, 'story.conclusion'))
          .fontSize(11)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
          .alignSelf(ItemAlign.Start)
        TextArea({ placeholder: t(this.workspaceState.language, 'story.conclusionPlaceholder'), text: this.conclusion })
          .width('100%')
          .height(72)
          .fontSize(12)
          .fontColor(Theme.colorForeground())
          .backgroundColor(Theme.colorSurface())
          .borderRadius(6)
          .onChange((v: string) => {
            this.conclusion = v;
          })

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
            Text(t(this.workspaceState.language, 'story.generate'))
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
