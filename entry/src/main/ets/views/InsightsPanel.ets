import { promptAction } from '@kit.ArkUI';
import { Theme } from '../common/Theme';
import { l10n, t } from '../common/Locale';
import { fmt } from '../common/Format';
import { DataFrame } from '../model/DataFrame';
import { DataState } from '../model/DataState';
import { WorkspaceState } from '../model/WorkspaceState';
import { AnalyticsInsight, computeAnalyticsInsights, computeQualityReport } from '../engine/Insights';
import { ChatMessage, chatCompletion, llmConfigured } from '../engine/LlmClient';

/** One row of the time-series workbench (web tsResult periods + forecast). */
interface TsRow {
  period: string;
  value: number;
  mom: number | null;     // 环比 % vs previous period
  yoy: number | null;     // 同比 % vs same month last year
  ma: number | null;      // moving average, window 3
  anomaly: boolean;
  forecast: boolean;      // 趋势外推预测行（web naive drift）
}

/** 月度键：'YYYY-MM-DD…' → 'YYYY-MM'（web Period 月度聚合口径）。 */
function monthKey(raw: string): string {
  return raw.length >= 7 ? raw.slice(0, 7) : raw;
}

/** 下一个月的 'YYYY-MM' 键（预测行用）。 */
function nextMonthKey(key: string): string {
  if (key.length !== 7) {
    return key + '+';
  }
  let year = Number(key.slice(0, 4));
  let month = Number(key.slice(5, 7));
  if (Number.isNaN(year) || Number.isNaN(month)) {
    return key + '+';
  }
  month++;
  if (month > 12) {
    month = 1;
    year++;
  }
  const mm = month < 10 ? '0' + month.toString() : month.toString();
  return year.toString() + '-' + mm;
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

  /**
   * 时序工作台（web backend/core/timeseries.py 口径）：月度均值聚合、
   * 环比 / 同比、3 期移动平均、残差 z≥2 异常、naive drift 预测 3 期。
   */
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
    // 月度均值聚合（web groupby 月 → mean）
    const sums = new Map<string, number>();
    const counts = new Map<string, number>();
    const order: string[] = [];
    for (let r = 0; r < df.rows.length; r++) {
      const raw = df.rows[r][periodIdx];
      const key = monthKey(raw === null || raw === undefined ? '' : String(raw));
      if (key.length === 0) {
        continue;
      }
      const n = Number(df.rows[r][valueIdx]);
      if (Number.isNaN(n)) {
        continue;
      }
      if (!sums.has(key)) {
        sums.set(key, 0);
        counts.set(key, 0);
        order.push(key);
      }
      sums.set(key, (sums.get(key) ?? 0) + n);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (order.length < 2) {
      promptAction.showToast({ message: l10n(this.workspaceState.language,
        '时间序列数据不足（少于两个月）', 'Not enough time series data (< 2 months)') });
      return;
    }
    order.sort((a: string, b: string) => (a < b ? -1 : 1));
    const values: number[] = [];
    for (let i = 0; i < order.length; i++) {
      const cnt = counts.get(order[i]) ?? 1;
      values.push((sums.get(order[i]) ?? 0) / Math.max(1, cnt));
    }
    const rows: TsRow[] = [];
    for (let i = 0; i < order.length; i++) {
      const v = values[i];
      let mom: number | null = null;
      if (i > 0 && values[i - 1] !== 0) {
        mom = Math.round(((v - values[i - 1]) / Math.abs(values[i - 1])) * 1000) / 10;
      }
      // 同比：上年同月（键 'YYYY-MM'），查无或基数为 0 → null
      let yoy: number | null = null;
      const key = order[i];
      if (key.length === 7) {
        const year = Number(key.slice(0, 4));
        const mm = key.slice(4, 7);
        if (!Number.isNaN(year)) {
          const prevKey = (year - 1).toString() + mm;
          const pi = order.indexOf(prevKey);
          if (pi >= 0 && values[pi] !== 0) {
            yoy = Math.round(((v - values[pi]) / Math.abs(values[pi])) * 1000) / 10;
          }
        }
      }
      let ma: number | null = null;
      if (i >= 2) {
        ma = (values[i] + values[i - 1] + values[i - 2]) / 3;
      }
      rows.push({
        period: key,
        value: v,
        mom: mom,
        yoy: yoy,
        ma: ma,
        anomaly: false,
        forecast: false,
      });
    }
    // 异常：残差 = 本期 − MA3，|z| ≥ 2 标记（web _OUTLIER_SIGMA）
    const residuals: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].ma !== null) {
        residuals.push(rows[i].value - (rows[i].ma as number));
      }
    }
    if (residuals.length >= 2) {
      let mean = 0;
      for (let i = 0; i < residuals.length; i++) {
        mean += residuals[i];
      }
      mean /= residuals.length;
      let variance = 0;
      for (let i = 0; i < residuals.length; i++) {
        variance += (residuals[i] - mean) * (residuals[i] - mean);
      }
      const std = Math.sqrt(variance / residuals.length);
      if (std > 0) {
        for (let i = 0; i < rows.length; i++) {
          if (rows[i].ma !== null) {
            const z = (rows[i].value - (rows[i].ma as number) - mean) / std;
            rows[i].anomaly = Math.abs(z) >= 2;
          }
        }
      }
    }
    // 预测：naive drift 线性趋势外推 3 期（web _FORECAST_HORIZON）
    const window = Math.min(6, rows.length);
    if (window >= 2) {
      const first = values[rows.length - window];
      const last = values[rows.length - 1];
      const step = (last - first) / (window - 1);
      let lastKey = order[order.length - 1];
      for (let f = 1; f <= 3; f++) {
        const fv = Math.max(0, last + step * f);
        lastKey = nextMonthKey(lastKey);
        rows.push({
          period: lastKey,
          value: fv,
          mom: null,
          yoy: null,
          ma: null,
          anomaly: false,
          forecast: true,
        });
      }
    }
    this.tsRows = rows;
    this.tsOn = true;
  }

  /** 叙述：LLM 已配置时走 LLM（web /nl/narrate），否则本地摘要。 */
  private narrate(): void {
    const df = this.dataState.activeDataFrame;
    if (df === null) {
      return;
    }
    if (llmConfigured(this.workspaceState.llmConfig)) {
      this.narrateLlm(df);
      return;
    }
    this.narrateLocal(df);
  }

  /** LLM narrative (web nl_narrate): insights → 2-3 句连贯中文叙述。 */
  private narrateLlm(df: DataFrame): void {
    this.narrating = true;
    const cards = computeAnalyticsInsights(df);
    if (cards.length === 0) {
      this.narrateLocal(df);
      return;
    }
    const lines: string[] = [];
    for (let i = 0; i < cards.length; i++) {
      lines.push('- ' + cards[i].text);
    }
    const prompt = '以下是数据集的分析洞察：\n' + lines.join('\n') +
      '\n\n请用简体中文撰写一段 2-3 句的连贯分析叙述，基于上述洞察并引用具体数字，不要编造。';
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];
    chatCompletion(this.workspaceState.llmConfig, messages, 256).then((text: string) => {
      this.narrative = text.trim();
      this.narrating = false;
    }).catch(() => {
      this.narrating = false;
      promptAction.showToast({ message: l10n(this.workspaceState.language,
        'LLM 叙述失败，已用本地摘要', 'LLM narrate failed; local summary used') });
      this.narrateLocal(df);
    });
  }

  /** 叙述：本地统计摘要（LLM 未配置时的兜底）。 */
  private narrateLocal(df: DataFrame): void {
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
        // MoM workbench table (web tsResult: 月份/值/环比/同比/MA3 + 预测行)
        if (this.tsOn && this.tsRows.length > 0) {
          Column({ space: 4 }) {
            Text(l10n(this.workspaceState.language, '时间序列工作台 · ' + this.tsColumn, 'Time series · ' + this.tsColumn))
              .fontSize(10)
              .fontWeight(600)
              .fontColor(Theme.colorMuted())
              .alignSelf(ItemAlign.Start)
            Row() {
              Text(l10n(this.workspaceState.language, '月份', 'Month')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2)
              Text(this.tsColumn).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2).textAlign(TextAlign.End)
              Text(l10n(this.workspaceState.language, '环比', 'MoM')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2).textAlign(TextAlign.End)
              Text(l10n(this.workspaceState.language, '同比', 'YoY')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2).textAlign(TextAlign.End)
              Text(l10n(this.workspaceState.language, '3期均值', 'MA3')).fontSize(9).fontColor(Theme.colorMuted()).layoutWeight(2).textAlign(TextAlign.End)
            }
            .width('100%')
            ForEach(this.tsRows, (row: TsRow) => {
              Row() {
                Text(row.period + (row.anomaly ? ' ⚠' : '') + (row.forecast ? ' ↑' : ''))
                  .fontSize(9)
                  .fontColor(row.anomaly ? Theme.warning : (row.forecast ? Theme.primary : Theme.colorMuted()))
                  .layoutWeight(2)
                  .maxLines(1)
                  .textOverflow({ overflow: TextOverflow.Ellipsis })
                Text(fmt(row.value))
                  .fontSize(9)
                  .fontColor(row.forecast ? Theme.primary : Theme.colorForeground())
                  .layoutWeight(2)
                  .textAlign(TextAlign.End)
                Text(row.mom !== null ? row.mom.toString() + '%' : '—')
                  .fontSize(9)
                  .fontColor(row.mom !== null && row.mom < 0 ? Theme.danger : Theme.success)
                  .layoutWeight(2)
                  .textAlign(TextAlign.End)
                Text(row.yoy !== null ? row.yoy.toString() + '%' : '—')
                  .fontSize(9)
                  .fontColor(row.yoy !== null && row.yoy < 0 ? Theme.danger : Theme.success)
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
            }, (row: TsRow) => row.period + (row.forecast ? '_f' : '') + '_' + this.tick.toString())
            if (this.hasForecast()) {
              Text(l10n(this.workspaceState.language, '↑ 趋势外推预测', '↑ naive drift forecast'))
                .fontSize(9)
                .fontColor(Theme.primary)
                .alignSelf(ItemAlign.Start)
            }
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

  private hasForecast(): boolean {
    for (let i = 0; i < this.tsRows.length; i++) {
      if (this.tsRows[i].forecast) {
        return true;
      }
    }
    return false;
  }
}
