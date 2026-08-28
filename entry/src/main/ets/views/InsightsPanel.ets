import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { fmt } from '../common/Format';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { AnalyticsInsight, computeAnalyticsInsights, computeQualityReport } from '../engine/Insights';

/** One row of the MoM workbench table (web tsResult.periods subset). */
interface TsRow {
  period: string;
  value: number;
  mom: number | null; // percent vs previous period
  ma: number | null;  // moving average, window 3
  anomaly: boolean;
}

/**
 * Insights panel (web: src/components/data/InsightsPanel.tsx, local variant).
 * 头部操作：环比（本地时序工作台）、叙述（本地摘要）、刷新；下方为分析洞察卡
 * （趋势/集中度/偏态/相关性/缺失），evidence 以 k=v 形式展示。
 */
@Component
export struct InsightsPanel {
  @Consume('dataState') dataState: DataState;
  @Consume('workspaceState') workspaceState: WorkspaceState;
  @State narrative: string = '';
  @State narrating: boolean = false;
  @State tsOn: boolean = false;
  @State tsRows: TsRow[] = [];
  @State tsColumn: string = '';
  @State tsPeriodCol: string = '';
  @State tick: number = 0;

  /** 环比工作台：按时间列分组求和首个数值列，计算 MoM 与 3 期移动平均。 */
  private buildTs(): void {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return;
    }
    let periodIdx = -1;
    for (let c = 0; c < df.columns.length; c++) {
      if (df.columns[c].dtype === 'date') {
        periodIdx = c;
        break;
      }
    }
    let valueIdx = -1;
    for (let c = 0; c < df.columns.length; c++) {
      if (df.columns[c].dtype === 'number') {
        valueIdx = c;
        break;
      }
    }
    if (periodIdx < 0 || valueIdx < 0) {
      promptAction.showToast({ message: l10n(this.workspaceState.language, '环比需要时间列 + 数值列', 'MoM needs a temporal + numeric column') });
      return;
    }
    this.tsPeriodCol = df.columns[periodIdx].name;
    this.tsColumn = df.columns[valueIdx].name;
    const groups = new Map<string, number>();
    const order: string[] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const key = String(df.rows[r][periodIdx] ?? '');
      if (!groups.has(key)) {
        groups.set(key, 0);
        order.push(key);
      }
      const n = Number(df.rows[r][valueIdx]);
      if (!Number.isNaN(n)) {
        groups.set(key, (groups.get(key) ?? 0) + n);
      }
    }
    order.sort((a: string, b: string) => (a < b ? -1 : 1));
    const rows: TsRow[] = [];
    for (let i = 0; i < order.length; i++) {
      const v = groups.get(order[i]) ?? 0;
      let mom: number | null = null;
      if (i > 0) {
        const prev = groups.get(order[i - 1]) ?? 0;
        mom = prev !== 0 ? Math.round(((v - prev) / Math.abs(prev)) * 100) : null;
      }
      let ma: number | null = null;
      if (i >= 2) {
        ma = ((groups.get(order[i]) ?? 0) + (groups.get(order[i - 1]) ?? 0) + (groups.get(order[i - 2]) ?? 0)) / 3;
      }
      rows.push({
        period: order[i],
        value: v,
        mom: mom,
        ma: ma,
        anomaly: mom !== null && Math.abs(mom) >= 50,
      });
    }
    this.tsRows = rows;
    this.tsOn = true;
  }

  /** 叙述：本地统计摘要（web 走 LLM narrate，接入后替换）。 */
  private narrate(): void {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return;
    }
    this.narrating = true;
    const rep = computeQualityReport(df);
    let text = l10n(this.workspaceState.language,
      '数据集「' + df.name + '」共 ' + fmt(df.rowCount) + ' 行 × ' + df.colCount + ' 列。',
      'Dataset "' + df.name + '" has ' + fmt(df.rowCount) + ' rows × ' + df.colCount + ' columns.');
    text += l10n(this.workspaceState.language,
      '缺失单元格 ' + rep.summary.missingCells + ' 个，重复行 ' + rep.summary.duplicateRows + ' 行。',
      ' ' + rep.summary.missingCells + ' missing cells, ' + rep.summary.duplicateRows + ' duplicate rows.');
    const cards = computeAnalyticsInsights(df);
    if (cards.length > 0) {
      text += l10n(this.workspaceState.language, '值得关注：', ' Notable: ');
      for (let i = 0; i < Math.min(2, cards.length); i++) {
        text += cards[i].text;
      }
    }
    this.narrative = text;
    this.narrating = false;
  }

  private cards(): AnalyticsInsight[] {
    const df = this.dataState.activeDataFrame;
    return df !== null ? computeAnalyticsInsights(df) : [];
  }

  build() {
    Column({ space: 8 }) {
      // Header + actions (web: 环比 / 叙述 / 刷新)
      Row({ space: 4 }) {
        Text(t(this.workspaceState.language, 'insights.title'))
          .fontSize(12)
          .fontWeight(600)
          .fontColor(Theme.colorMuted())
          .layoutWeight(1)
        Button() {
          Text(l10n(this.workspaceState.language, '环比', 'MoM')).fontSize(10).fontColor(Theme.colorMuted())
        }
        .type(ButtonType.Normal).height(22).padding({ left: 6, right: 6 })
        .backgroundColor(Theme.colorSurface())
        .onClick(() => {
          this.buildTs();
        })
        Button() {
          Text(l10n(this.workspaceState.language, '叙述', 'Narrate')).fontSize(10).fontColor(Theme.colorMuted())
        }
        .type(ButtonType.Normal).height(22).padding({ left: 6, right: 6 })
        .backgroundColor(Theme.colorSurface())
        .onClick(() => {
          this.narrate();
        })
        Button() {
          Text('⟳').fontSize(12).fontColor(Theme.colorMuted())
        }
        .type(ButtonType.Normal).height(22).width(24)
        .backgroundColor(Color.Transparent)
        .onClick(() => {
          this.tick++;
        })
      }
      .width('100%')

      if (this.dataState.activeDataFrame === null) {
        Text(t(this.workspaceState.language, 'insights.noData'))
          .fontSize(11)
          .fontColor(Theme.colorMuted())
      } else {
        // MoM workbench table (web tsResult table, local subset: value/MoM/MA)
        if (this.tsOn && this.tsRows.length > 0) {
          Column({ space: 4 }) {
            Text(l10n(this.workspaceState.language, '时序环比 · ' + this.tsColumn, 'Trend · ' + this.tsColumn))
              .fontSize(10)
              .fontWeight(600)
              .fontColor(Theme.colorMuted())
              .alignSelf(ItemAlign.Start)
            Row() {
              Text(l10n(this.workspaceState.language, '周期', 'Period')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2)
              Text(this.tsColumn).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2).textAlign(TextAlign.End)
              Text(l10n(this.workspaceState.language, '环比', 'MoM')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2).textAlign(TextAlign.End)
              Text(l10n(this.workspaceState.language, 'MA3', 'MA3')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2).textAlign(TextAlign.End)
            }
            .width('100%')
            ForEach(this.tsRows, (row: TsRow) => {
              Row() {
                Text(row.period + (row.anomaly ? ' ⚠' : ''))
                  .fontSize(9)
                  .fontColor(row.anomaly ? Theme.warning : Theme.colorMuted())
                  .layoutWeight(2)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(fmt(row.value)).fontSize(9).fontColor(Theme.colorForeground()).layoutWeight(2).textAlign(TextAlign.End)
                Text(row.mom !== null ? row.mom.toString() + '%' : '—')
                  .fontSize(9)
                  .fontColor(row.mom !== null && row.mom < 0 ? Theme.danger : Theme.success)
                  .layoutWeight(2)
                  .textAlign(TextAlign.End)
                Text(row.ma !== null ? row.ma.toFixed(1) : '—')
                  .fontSize(9)
                  .fontColor(Theme.colorMuted())
                  .layoutWeight(2)
                  .textAlign(TextAlign.End)
              }
              .width('100%')
              .padding({ top: 1, bottom: 1 })
              .backgroundColor(row.anomaly ? Theme.primaryDim : Color.Transparent)
            }, (row: TsRow) => row.period + '_' + this.tick.toString())
          }
          .width('100%')
          .padding(8)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())
          .alignItems(HorizontalAlign.Start)
        }

        // Narrative card
        if (this.narrative.length > 0) {
          Text(this.narrative)
            .fontSize(11)
            .fontColor(Theme.colorForeground())
            .lineHeight(16)
            .width('100%')
            .padding(8)
            .borderRadius(6)
            .border({ width: 1, color: Theme.primary })
            .backgroundColor(Theme.primaryDim)
        }

        // Analytics insight cards (web five types)
        ForEach(this.cards(), (card: AnalyticsInsight, idx: number) => {
          Column({ space: 2 }) {
            Row({ space: 6 }) {
              Text(this.typeMark(card.type))
                .fontSize(10)
                .fontColor(Theme.primary)
              Text(card.text)
                .fontSize(11)
                .fontColor(Theme.colorForeground())
                .layoutWeight(1)
                .lineHeight(15)
            }
            .width('100%')
            .alignItems(VerticalAlign.Top)
            Text(card.evidence)
              .fontSize(9)
              .fontColor(Theme.colorMuted())
              .width('100%')
              .margin({ left: 22 })
          }
          .width('100%')
          .padding(8)
          .borderRadius(6)
          .border({ width: 1, color: Theme.colorBorder() })
          .backgroundColor(Theme.colorSurface())
          .alignItems(HorizontalAlign.Start)
        }, (card: AnalyticsInsight, idx: number) => idx.toString() + '_' + card.type + '_' + this.tick.toString())

        if (this.cards().length === 0) {
          Text(l10n(this.workspaceState.language, '暂无分析洞察', 'No insights'))
            .fontSize(11)
            .fontColor(Theme.colorMuted())
        }
      }
    }
    .width('100%')
    .alignItems(HorizontalAlign.Start)
  }

  private typeMark(type: string): string {
    if (type === 'trend') {
      return '↗';
    }
    if (type === 'concentration') {
      return '◕';
    }
    if (type === 'skew') {
      return '≋';
    }
    if (type === 'correlation') {
      return '⇄';
    }
    if (type === 'missing') {
      return '⚠';
    }
    return '💡';
  }
}
