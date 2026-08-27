/**
 * Dashboard item model (web: stores/dashboardStore.ts + types/dashboard.ts
 * subset). A single dashboard whose items reference charts, configured KPI
 * aggregations, or free text; rendering and global filters live in DashboardView.
 */
export enum DashboardItemKind {
  Chart = 0,
  Kpi = 1,
  Text = 2
}

@Observed
export class DashboardItem {
  id: string;
  kind: DashboardItemKind;
  chartId: string; // Chart: referenced chart id
  label: string;   // KPI: display label
  column: string;  // KPI: value column
  agg: string;     // KPI: sum | mean | count | min | max
  text: string;    // Text: content

  constructor(kind: DashboardItemKind, chartId: string = '', label: string = '', column: string = '',
    agg: string = 'sum', text: string = '') {
    this.id = 'dash_' + Date.now().toString() + '_' + Math.floor(Math.random() * 100000).toString();
    this.kind = kind;
    this.chartId = chartId;
    this.label = label;
    this.column = column;
    this.agg = agg;
    this.text = text;
  }
}

export class DashboardState {
  items: DashboardItem[] = [];
  tick: number = 0;

  findItem(id: string): DashboardItem | null {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id === id) {
        return this.items[i];
      }
    }
    return null;
  }

  addChart(chartId: string): DashboardItem {
    const item = new DashboardItem(DashboardItemKind.Chart, chartId);
    this.items.push(item);
    this.bump();
    return item;
  }

  addKpi(column: string, agg: string, label: string): DashboardItem {
    const item = new DashboardItem(DashboardItemKind.Kpi, '', label, column, agg);
    this.items.push(item);
    this.bump();
    return item;
  }

  addText(text: string): DashboardItem {
    const item = new DashboardItem(DashboardItemKind.Text, '', '', '', 'sum', text);
    this.items.push(item);
    this.bump();
    return item;
  }

  updateText(id: string, text: string): void {
    const item = this.findItem(id);
    if (item !== null) {
      item.text = text;
      this.bump();
    }
  }

  removeItem(id: string): void {
    const next: DashboardItem[] = [];
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].id !== id) {
        next.push(this.items[i]);
      }
    }
    this.items = next;
    this.bump();
  }

  hasChartItem(chartId: string): boolean {
    for (let i = 0; i < this.items.length; i++) {
      if (this.items[i].kind === DashboardItemKind.Chart && this.items[i].chartId === chartId) {
        return true;
      }
    }
    return false;
  }

  /** Bump the tick and mirror it to AppStorage so @StorageLink watchers fire. */
  bump(): void {
    this.tick++;
    AppStorage.setOrCreate('dashboardTick', this.tick);
  }
}
