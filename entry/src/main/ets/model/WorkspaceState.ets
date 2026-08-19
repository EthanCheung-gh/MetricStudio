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
  System = 0,
  Dark = 1,
  Light = 2
}

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

export const EMPTY_LLM_CONFIG: LlmConfig = { baseUrl: '', model: '', apiKey: '' };

/**
 * Shell-level state (web: stores/workspaceStore.ts + stores/uiStore.ts subset).
 * Data layer / charts / dashboards are implemented in later porting tasks.
 */
@Observed
export class WorkspaceState {
  leftCollapsed: boolean = false;
  rightCollapsed: boolean = false;
  leftSection: PanelSection = PanelSection.None;
  rightSection: RightPanelSection = RightPanelSection.None;
  activeTab: CenterTab = CenterTab.Data;
  language: Language = Language.Zh;
  theme: AppTheme = AppTheme.Dark;
  settingsOpen: boolean = false;
  llmConfig: LlmConfig = { baseUrl: '', model: '', apiKey: '' };
  wizardDismissed: boolean = false;

  // Placeholder dataset info (populated by later data tasks)
  hasData: boolean = false;
  datasetName: string = '';
  rowCount: number = 0;
  colCount: number = 0;
  engine: string = 'pandas';

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

  setLanguage(lang: Language): void {
    this.language = lang;
  }

  setTheme(theme: AppTheme): void {
    this.theme = theme;
  }

  setSettingsOpen(open: boolean): void {
    this.settingsOpen = open;
  }

  applyLlmConfig(config: LlmConfig): void {
    this.llmConfig.baseUrl = config.baseUrl;
    this.llmConfig.model = config.model;
    this.llmConfig.apiKey = config.apiKey;
  }

  loadSampleData(): void {
    this.hasData = true;
    this.datasetName = 'sample_data.csv';
    this.rowCount = 128;
    this.colCount = 5;
    this.engine = 'pandas';
  }
}
