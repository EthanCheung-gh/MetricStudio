import { Theme } from '../common/Theme';
import { WorkspaceState } from '../model/WorkspaceState';
import { chartTypeSpecs } from '../model/ChartConfig';

const GROUP_CORE = ['line', 'bar', 'barh', 'area', 'step', 'scatter', 'dot', 'scatter3d', 'pie'];
const GROUP_DIST = ['histogram', 'box', 'violin', 'ecdf', 'density_heatmap', 'density_contour'];
const GROUP_MATRIX = ['heatmap', 'contour', 'splom'];
const GROUP_HIER = ['treemap', 'sunburst', 'icicle', 'sankey', 'parcoords', 'parcats'];

/**
 * Chart type selector (web: src/components/chart/ChartTypeSelector.tsx).
 * Grouped chips over all 33 chart types; selecting updates the active chart.
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
    Column({ space: 6 }) {
      this.groupRow(GROUP_CORE)
      this.groupRow(GROUP_DIST)
      this.groupRow(GROUP_MATRIX)
      this.groupRow(GROUP_HIER)
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  @Builder
  groupRow(types: string[]) {
    Scroll() {
      Row({ space: 4 }) {
        ForEach(types, (type: string) => {
          this.typeChip(type)
        }, (type: string) => type)
      }
    }
    .width('100%')
    .scrollable(ScrollDirection.Horizontal)
    .scrollBar(BarState.Off)
  }

  private typeLabel(type: string): string {
    const spec = chartTypeSpecs[type];
    return spec !== undefined ? spec.label : type;
  }

  @Builder
  typeChip(type: string) {
    Text(this.typeLabel(type))
      .fontSize(11)
      .fontColor(this.currentType() === type ? Theme.primary : Theme.colorMuted())
      .padding({ left: 10, right: 10, top: 4, bottom: 4 })
      .borderRadius(10)
      .backgroundColor(this.currentType() === type ? Theme.primaryDim : Color.Transparent)
      .border({ width: 1, color: this.currentType() === type ? Theme.primary : Theme.colorBorder() })
      .onClick(() => {
        this.setType(type);
      })
  }
}
