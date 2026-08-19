import { ChartConfig } from './ChartConfig';
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
  theme: AppTheme = AppTheme.System;
  llmConfig: LlmConfig = new LlmConfig();

  setSettingsOpen(open: boolean): void {
    this.settingsOpen = open;
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
    this.chartTick++;
    return chart;
  }

  setActiveChart(id: string): void {
    this.activeChartId = id;
    this.chartTick++;
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
    this.chartTick++;
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
    this.chartTick++;
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
    this.chartTick++;
  }
}
