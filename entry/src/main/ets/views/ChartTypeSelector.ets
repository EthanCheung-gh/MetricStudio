import { Theme } from '../common/Theme';
import { t } from '../common/Locale';
import { WorkspaceState } from '../model/WorkspaceState';
import { chartTypeSpecs, chartTypeList } from '../model/ChartConfig';

/**
 * Chart type selector (web: src/components/chart/ChartConfigDialog.tsx left
 * column). Vertical button list in a 144px scroll column — selected = solid
 * primary, unselected = flat; each button is left-aligned (12px text).
 */
@Component
export struct ChartTypeSelector {
  @Consume('workspaceState') workspaceState: WorkspaceState;

  private currentType(): string {
    const c = this.workspaceState.activeChart();
    return c !== null ? c.encoding.chartType : '';
  }

  private setType(type: string): void {
    const c = this.workspaceState.activeChart();
    if (c === null) {
      return;
    }
    c.encoding.chartType = type;
    this.workspaceState.refreshChart();
  }

  build() {
    Column() {
      Text(t(this.workspaceState.language, 'chart.type'))
        .fontSize(12)
        .fontWeight(600)
        .fontColor(Theme.colorMuted())
        .alignSelf(ItemAlign.Start)
        .margin({ bottom: 8 })

      Scroll() {
        Column({ space: 4 }) {
          ForEach(chartTypeList, (type: string) => {
            this.typeButton(type)
          }, (type: string) => type)
        }
        .width('100%')
      }
      .layoutWeight(1)
      .scrollBar(BarState.Off)
      .align(Alignment.TopStart)
    }
    .width('100%')
    .height('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private typeLabel(type: string): string {
    const spec = chartTypeSpecs[type];
    return spec !== undefined ? spec.label : type;
  }

  @Builder
  typeButton(type: string) {
    Button() {
      Text(this.typeLabel(type))
        .fontSize(12)
        .fontColor(this.currentType() === type ? Color.White : Theme.colorForeground())
        .maxLines(1)
        .textOverflow({ overflow: TextOverflow.Ellipsis })
    }
    .type(ButtonType.Normal)
    .width('100%')
    .height(30)
    .padding({ left: 10, right: 10 })
    .backgroundColor(this.currentType() === type ? Theme.primary : Theme.colorSurface())
    .borderRadius(6)
    .onClick(() => {
      this.setType(type);
    })
  }
}
