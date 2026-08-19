import { Theme } from '../common/Theme';
import { CenterTab, WorkspaceState } from '../model/WorkspaceState';
import { DataState } from '../model/DataState';
import { EncodingChannel, YFieldConfig } from '../model/ChartConfig';

/**
 * Local NL query panel (web: src/components/data/AskPanel.tsx subset). Parses a
 * short Chinese/English phrase with keyword rules and builds a chart encoding:
 * 趋势/随时间 → line (date x); 占比/分布 → pie (category color);
 * 比较/分组 → bar (category x); default → bar.
 */
@Component
export struct AskPanel {
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @Consume('dataState') dataState: DataState;
  @State query: string = '';

  private dateColumn(): string {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return '';
    }
    for (let i = 0; i < df.columns.length; i++) {
      if (df.columns[i].dtype === 'date') {
        return df.columns[i].name;
      }
    }
    return '';
  }

  private firstNumeric(): string {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return '';
    }
    for (let i = 0; i < df.columns.length; i++) {
      if (df.columns[i].dtype === 'number') {
        return df.columns[i].name;
      }
    }
    return '';
  }

  private firstCategory(): string {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return '';
    }
    for (let i = 0; i < df.columns.length; i++) {
      const c = df.columns[i];
      if (c.dtype === 'string' || c.dtype === 'boolean') {
        return c.name;
      }
    }
    return '';
  }

  private run(): void {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return;
    }
    const q = this.query.toLowerCase();
    const numeric = this.firstNumeric();
    const category = this.firstCategory();
    const date = this.dateColumn();
    if (numeric.length === 0) {
      return;
    }
    const chart = this.workspaceState.createChart(df.name);
    const enc = chart.encoding;
    if (q.indexOf('趋势') >= 0 || q.indexOf('随时间') >= 0 || q.indexOf('trend') >= 0
      || q.indexOf('over time') >= 0) {
      enc.chartType = 'line';
      if (date.length > 0) {
        enc.x = new EncodingChannel(date, 'temporal', null);
      } else if (category.length > 0) {
        enc.x = new EncodingChannel(category, 'nominal', null);
      }
    } else if (q.indexOf('占比') >= 0 || q.indexOf('分布') >= 0 || q.indexOf('pie') >= 0
      || q.indexOf('share') >= 0) {
      enc.chartType = 'pie';
      if (category.length > 0) {
        enc.color = new EncodingChannel(category, 'nominal', null);
      }
    } else {
      // 比较/分组/default → bar
      enc.chartType = 'bar';
      if (category.length > 0) {
        enc.x = new EncodingChannel(category, 'nominal', null);
      } else if (date.length > 0) {
        enc.x = new EncodingChannel(date, 'temporal', null);
      }
    }
    enc.yFields = [new YFieldConfig(numeric, 'quantitative', 'sum', 'left', 'none')];
    this.query = '';
    this.workspaceState.setActiveTab(CenterTab.Chart);
  }

  build() {
    Column({ space: 8 }) {
      Row({ space: 6 }) {
        SymbolGlyph($r('sys.symbol.wand_and_stars'))
          .fontSize(14)
          .fontColor([Theme.primary])
        Text('AI 查询')
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
      }
      .width('100%')

      TextArea({ placeholder: '例如：按类别比较数值 / 随时间变化的趋势', text: this.query })
        .width('100%')
        .height(64)
        .fontSize(12)
        .onChange((v: string) => {
          this.query = v;
        })

      Button() {
        Row({ space: 6 }) {
          SymbolGlyph($r('sys.symbol.wand_and_stars'))
            .fontSize(12)
            .fontColor([Color.White])
          Text('生成图表')
            .fontSize(12)
            .fontColor(Color.White)
        }
      }
      .width('100%')
      .height(32)
      .backgroundColor(this.dataState.hasData ? Theme.primary : Theme.colorMuted())
      .borderRadius(6)
      .enabled(this.dataState.hasData)
      .onClick(() => {
        this.run();
      })
    }
    .width('100%')
    .padding(12)
    .borderRadius(8)
    .border({ width: 1, color: Theme.colorBorder() })
    .backgroundColor(Theme.colorSurfaceElevated())
    .alignItems(HorizontalAlign.Start)
  }
}

