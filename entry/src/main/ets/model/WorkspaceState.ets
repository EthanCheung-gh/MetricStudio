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

  loadSampleData(): void {
    this.hasData = true;
    this.datasetName = 'sample_data.csv';
    this.rowCount = 128;
    this.colCount = 5;
    this.engine = 'pandas';
  }
}
