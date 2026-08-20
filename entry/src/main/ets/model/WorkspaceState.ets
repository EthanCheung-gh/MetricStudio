import { AggregateType, ChartConfig, EncodingChannel, FieldType, YFieldConfig } from './ChartConfig';
import { Theme } from '../common/Theme';

export enum Language {
  Zh = 0,
  En = 1
}

export enum PanelSection {
  None = 0,
  Charts = 1,
  Datasets = 2
}

export enum RightPanelSection {
  None = 0,
  Properties = 1
}

export enum CenterTab {
  Data = 0,
  Dashboard = 1,
  Chart = 2
}

export enum AppTheme {
  Dark = 0,
  Light = 1,
  System = 2
}

/** LLM service configuration (web: SettingsDialog LLM section). */
export class LlmConfig {
  baseUrl: string = '';
  model: string = '';
  apiKey: string = '';
  clearApiKey: boolean = false;
}

/**
 * Shell-level state (web: stores/workspaceStore.ts + uiStore.ts subset) plus
 * the chart registry (web: stores/chartStore.ts subset).
 */
@Observed
export class WorkspaceState {
  leftCollapsed: boolean = false;
  rightCollapsed: boolean = false;
  leftSection: PanelSection = PanelSection.None;
  rightSection: RightPanelSection = RightPanelSection.None;
  activeTab: CenterTab = CenterTab.Data;
  language: Language = Language.Zh;
  wizardDismissed: boolean = false;

  // Chart registry
  charts: ChartConfig[] = [];
  activeChartId: string = '';
  chartTick: number = 0;
  settingsOpen: boolean = false;
  chartConfigOpen: boolean = false;
  theme: AppTheme = AppTheme.System;
  llmConfig: LlmConfig = new LlmConfig();

  setSettingsOpen(open: boolean): void {
    this.settingsOpen = open;
  }

  setChartConfigOpen(open: boolean): void {
    this.chartConfigOpen = open;
  }

  setLanguage(lang: Language): void {
    this.language = lang;
  }

  setTheme(theme: AppTheme): void {
    this.theme = theme;
    Theme.setMode(theme === AppTheme.Light);
  }

  applyLlmConfig(config: LlmConfig): void {
    this.llmConfig.baseUrl = config.baseUrl;
    this.llmConfig.model = config.model;
    this.llmConfig.apiKey = config.apiKey;
    this.llmConfig.clearApiKey = config.clearApiKey === true;
  }

  toggleLeft(): void {
    this.leftCollapsed = !this.leftCollapsed;
  }

  toggleRight(): void {
    this.rightCollapsed = !this.rightCollapsed;
  }

  activateLeftSection(section: PanelSection): void {
    this.leftSection = section;
  }

  /** Expand the left panel and switch to the given section in one step. */
  openLeftSection(section: PanelSection): void {
    this.leftCollapsed = false;
    this.leftSection = section;
  }

  /** Expand the right panel and switch to the given section in one step. */
  openRightSection(section: RightPanelSection): void {
    this.rightCollapsed = false;
    this.rightSection = section;
  }

  activateRightSection(section: RightPanelSection): void {
    this.rightSection = section;
  }

  setActiveTab(tab: CenterTab): void {
    this.activeTab = tab;
  }

  toggleLanguage(): void {
    this.language = this.language === Language.Zh ? Language.En : Language.Zh;
  }

  get hasCharts(): boolean {
    return this.charts.length > 0;
  }

  activeChart(): ChartConfig | null {
    for (let i = 0; i < this.charts.length; i++) {
      if (this.charts[i].id === this.activeChartId) {
        return this.charts[i];
      }
    }
    return null;
  }

  createChart(datasetId: string, name?: string): ChartConfig {
    const id = 'chart_' + Date.now().toString();
    const n = name !== undefined && name.length > 0 ? name : 'Chart ' + (this.charts.length + 1).toString();
    const chart = new ChartConfig(id, n, datasetId);
    chart.title = n;
    this.charts.push(chart);
    this.activeChartId = id;
    this.bumpTick();
    return chart;
  }

  setActiveChart(id: string): void {
    this.activeChartId = id;
    this.bumpTick();
  }

  removeChart(id: string): void {
    const next: ChartConfig[] = [];
    for (let i = 0; i < this.charts.length; i++) {
      if (this.charts[i].id !== id) {
        next.push(this.charts[i]);
      }
    }
    this.charts = next;
    if (this.activeChartId === id) {
      this.activeChartId = this.charts.length > 0 ? this.charts[0].id : '';
    }
    this.bumpTick();
  }

  duplicateChart(id: string): ChartConfig | null {
    const src = this.findChart(id);
    if (src === null) {
      return null;
    }
    const chart = new ChartConfig('chart_' + Date.now().toString(), src.name + ' copy', src.datasetId);
    chart.encoding = src.encoding.clone();
    chart.title = chart.name;
    this.charts.push(chart);
    this.activeChartId = chart.id;
    this.bumpTick();
    return chart;
  }

  findChart(id: string): ChartConfig | null {
    for (let i = 0; i < this.charts.length; i++) {
      if (this.charts[i].id === id) {
        return this.charts[i];
      }
    }
    return null;
  }

  refreshChart(): void {
    this.bumpTick();
  }

  /** Serialize charts + preferences for project save (web saveProject). */
  exportJson(): string {
    const items: ProjectChart[] = [];
    for (let i = 0; i < this.charts.length; i++) {
      const c = this.charts[i];
      const enc = c.encoding;
      const yf: EncYJson[] = [];
      for (let k = 0; k < enc.yFields.length; k++) {
        const y = enc.yFields[k];
        const yj: EncYJson = {
          field: y.field,
          type: y.type,
          aggregate: y.aggregate,
          axis: y.axis,
          normalize: y.normalize,
        };
        yf.push(yj);
      }
      const xj: EncChannelJson | null = enc.x !== null
        ? { field: enc.x.field, type: enc.x.type, aggregate: enc.x.aggregate }
        : null;
      const cj: EncChannelJson | null = enc.color !== null
        ? { field: enc.color.field, type: enc.color.type, aggregate: enc.color.aggregate }
        : null;
      const zj: EncChannelJson | null = enc.z !== null
        ? { field: enc.z.field, type: enc.z.type, aggregate: enc.z.aggregate }
        : null;
      const item: ProjectChart = {
        id: c.id,
        name: c.name,
        datasetId: c.datasetId,
        title: c.title,
        chartType: enc.chartType,
        x: xj,
        yFields: yf,
        color: cj,
        z: zj,
      };
      items.push(item);
    }
    const payload: ProjectPayload = {
      charts: items,
      language: this.language,
      theme: this.theme,
      activeChartId: this.activeChartId,
    };
    return JSON.stringify(payload);
  }

  /** Restore charts + preferences from a saved project payload. */
  importJson(json: string): boolean {
    try {
      const data = JSON.parse(json) as ProjectPayload;
      this.charts = [];
      this.activeChartId = '';
      const list: ChartConfig[] = [];
      if (data.charts !== undefined) {
        for (let i = 0; i < data.charts.length; i++) {
          const c = data.charts[i];
          const chart = new ChartConfig(c.id !== undefined && c.id.length > 0 ? c.id : 'chart_' + i.toString(),
            c.name, c.datasetId);
          chart.title = c.title;
          chart.encoding.chartType = c.chartType;
          if (c.x !== null && c.x !== undefined) {
            chart.encoding.x = new EncodingChannel(c.x.field, c.x.type as FieldType, c.x.aggregate as AggregateType);
          }
          if (c.yFields !== undefined) {
            for (let k = 0; k < c.yFields.length; k++) {
              const y = c.yFields[k];
              chart.encoding.yFields.push(new YFieldConfig(y.field, y.type as FieldType, y.aggregate as AggregateType, y.axis, y.normalize));
            }
          }
          if (c.color !== null && c.color !== undefined) {
            chart.encoding.color = new EncodingChannel(c.color.field, c.color.type as FieldType, c.color.aggregate as AggregateType);
          }
          if (c.z !== null && c.z !== undefined) {
            chart.encoding.z = new EncodingChannel(c.z.field, c.z.type as FieldType, c.z.aggregate as AggregateType);
          }
          list.push(chart);
        }
      }
      this.charts = list;
      if (data.activeChartId !== undefined) {
        this.activeChartId = data.activeChartId;
      }
      if (data.language !== undefined) {
        this.language = data.language === 1 ? Language.En : Language.Zh;
      }
      if (data.theme !== undefined) {
        this.setTheme(data.theme);
      }
      this.bumpTick();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Bump the local tick and mirror it to AppStorage so @StorageLink watchers fire. */
  private bumpTick(): void {
    this.chartTick++;
    AppStorage.setOrCreate('chartTick', this.chartTick);
  }
}

/** JSON shape of a saved project (importJson). */
interface ProjectPayload {
  charts?: ProjectChart[];
  language?: number;
  theme?: number;
  activeChartId?: string;
}
interface ProjectChart {
  id?: string;
  name: string;
  datasetId: string;
  title: string;
  chartType: string;
  x: EncChannelJson | null;
  yFields?: EncYJson[];
  color: EncChannelJson | null;
  z: EncChannelJson | null;
}
interface EncChannelJson {
  field: string;
  type: string;
  aggregate: string | null;
}
interface EncYJson {
  field: string;
  type: string;
  aggregate: string | null;
  axis: string;
  normalize: string;
}
