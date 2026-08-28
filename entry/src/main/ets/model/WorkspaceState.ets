import { AggregateType, ChartAnnotation, ChartConfig, ChartLayout, ChartOptions, ChartShape, EncodingChannel, FieldType, YFieldConfig } from './ChartConfig';
import { DashboardItem, DashboardItemKind, DashboardState } from './DashboardState';
import { CellValue, ColumnMeta, DataFrame, DType, TransformOp, TransformStep } from './DataFrame';
import { DataState, DataSnapshot } from './DataState';
import { QaConvJson, QaState } from './QaState';
import { ShortcutKey } from '../common/Shortcuts';
import { Settings } from '../common/Settings';
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
  paletteOpen: boolean = false;
  reportOpen: boolean = false;
  sqlOpen: boolean = false;
  theme: AppTheme = AppTheme.Light;
  llmConfig: LlmConfig = new LlmConfig();
  dashboard: DashboardState = new DashboardState();
  // Sibling states wired by Index so project save/load covers datasets + QA.
  private dataState: DataState | null = null;
  private qaState: QaState | null = null;
  // Shortcuts (web: uiStore shortcutOverrides + ShortcutsPanel open flag).
  shortcutsOpen: boolean = false;
  shortcutOverrides: Record<string, ShortcutKey | null> = {};
  shortcutTick: number = 0;

  /** Wire sibling states (web: project save reaches dataStore + qaStore). */
  attach(dataState: DataState, qaState: QaState): void {
    this.dataState = dataState;
    this.qaState = qaState;
  }

  setShortcutsOpen(open: boolean): void {
    this.shortcutsOpen = open;
    this.bumpTick();
  }

  /** Replace the override map (load-time). */
  setShortcutOverrides(map: Record<string, ShortcutKey | null>): void {
    this.shortcutOverrides = map;
    this.bumpShortcutTick();
  }

  /** Write one override and persist (web setShortcutOverride). */
  applyShortcutOverride(id: string, key: ShortcutKey | null): void {
    this.shortcutOverrides[id] = key;
    Settings.saveShortcutOverrides(JSON.stringify(this.shortcutOverrides));
    this.bumpShortcutTick();
  }

  /** Clear all overrides back to defaults (web resetShortcuts). */
  resetShortcuts(): void {
    this.shortcutOverrides = {};
    Settings.saveShortcutOverrides('{}');
    this.bumpShortcutTick();
  }

  private bumpShortcutTick(): void {
    this.shortcutTick++;
    AppStorage.setOrCreate('shortcutTick', this.shortcutTick);
  }

  setSettingsOpen(open: boolean): void {
    this.settingsOpen = open;
  }

  setChartConfigOpen(open: boolean): void {
    this.chartConfigOpen = open;
  }

  setPaletteOpen(open: boolean): void {
    this.paletteOpen = open;
  }

  setReportOpen(open: boolean): void {
    this.reportOpen = open;
  }

  setSqlOpen(open: boolean): void {
    this.sqlOpen = open;
  }

  setLanguage(lang: Language): void {
    this.language = lang;
  }

  setTheme(theme: AppTheme): void {
    this.theme = theme;
    Theme.setMode(theme === AppTheme.Light);
    // Force a full appContent remount so every Theme token re-resolves
    // (colors are read at build time; nothing else re-renders the tree).
    const prev = AppStorage.get<boolean>('themeFlag');
    AppStorage.setOrCreate('themeFlag', !(prev !== undefined && prev));
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
    chart.layout = src.layout.clone();
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
      const fj: EncChannelJson | null = enc.facet !== null
        ? { field: enc.facet.field, type: enc.facet.type, aggregate: enc.facet.aggregate }
        : null;
      const sj: EncChannelJson | null = enc.source !== null
        ? { field: enc.source.field, type: enc.source.type, aggregate: enc.source.aggregate }
        : null;
      const tj: EncChannelJson | null = enc.target !== null
        ? { field: enc.target.field, type: enc.target.type, aggregate: enc.target.aggregate }
        : null;
      let oj: EncOptionsJson | null = null;
      if (enc.options !== null) {
        const o = enc.options;
        oj = {
          orientation: o.orientation,
          barmode: o.barmode,
          histnorm: o.histnorm,
          cumulative: o.cumulative,
          boxPoints: o.boxPoints,
          startField: o.startField,
          endField: o.endField,
          openField: o.openField,
          highField: o.highField,
          lowField: o.lowField,
          closeField: o.closeField,
        };
      }
      let pathj: string[] | null = enc.path.length > 0 ? [] : null;
      if (pathj !== null) {
        for (let k = 0; k < enc.path.length; k++) {
          pathj.push(enc.path[k]);
        }
      }
      const lay = c.layout;
      const anns: string[] = [];
      for (let k = 0; k < lay.annotations.length; k++) {
        anns.push(lay.annotations[k].text);
      }
      const shps: ProjectShapeJson[] = [];
      for (let k = 0; k < lay.shapes.length; k++) {
        const s = lay.shapes[k];
        shps.push({ kind: s.kind, value: s.value, color: s.color });
      }
      const layoutJson: ProjectLayoutJson | null =
        anns.length > 0 || shps.length > 0 ? { annotations: anns, shapes: shps } : null;
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
        layout: layoutJson,
        facet: fj,
        source: sj,
        target: tj,
        options: oj,
        path: pathj,
      };
      items.push(item);
    }
    const dashItems: DashboardItemJson[] = [];
    for (let i = 0; i < this.dashboard.items.length; i++) {
      const it = this.dashboard.items[i];
      const dj: DashboardItemJson = {
        kind: it.kind,
        chartId: it.chartId,
        label: it.label,
        column: it.column,
        agg: it.agg,
        text: it.text,
      };
      dashItems.push(dj);
    }
    // Datasets: current frames incl. rows (web zip data/{id} equivalent),
    // plus per-dataset lineage base + chain (web transforms/{id}.json).
    const datasets: ProjectDatasetJson[] = [];
    const snaps: ProjectSnapshotJson[] = [];
    if (this.dataState !== null) {
      for (let i = 0; i < this.dataState.dataFrames.length; i++) {
        const df = this.dataState.dataFrames[i];
        const base = this.dataState.baseAt(i);
        const hist = this.dataState.historyAt(i);
        let baseJson: ProjectFrameJson | null = null;
        if (base !== null) {
          baseJson = { columns: columnsToJson(base.columns), rows: base.rows };
        }
        const steps: ProjectStepJson[] = [];
        for (let k = 0; k < hist.length; k++) {
          steps.push({ type: hist[k].op.type, params: hist[k].op.params,
            timestamp: hist[k].op.timestamp, enabled: hist[k].enabled });
        }
        datasets.push({
          id: df.name,
          name: df.name,
          columns: columnsToJson(df.columns),
          rows: df.rows,
          active: i === this.dataState.activeIndex,
          base: baseJson,
          history: steps,
        });
      }
      for (let i = 0; i < this.dataState.snapshots.length; i++) {
        const s = this.dataState.snapshots[i];
        snaps.push({
          id: s.id,
          name: s.name,
          description: s.description,
          createdAt: s.createdAt,
          columns: columnsToJson(s.frame.columns),
          rows: s.frame.rows,
        });
      }
    }
    const payload: ProjectPayload = {
      charts: items,
      language: this.language,
      theme: this.theme,
      activeChartId: this.activeChartId,
      dashboardItems: dashItems,
      datasets: datasets,
      snapshots: snaps,
      qaConversations: this.qaState !== null ? this.qaState.exportList() : [],
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
          if (c.facet !== null && c.facet !== undefined) {
            chart.encoding.facet = new EncodingChannel(c.facet.field, c.facet.type as FieldType, c.facet.aggregate as AggregateType);
          }
          if (c.source !== null && c.source !== undefined) {
            chart.encoding.source = new EncodingChannel(c.source.field, c.source.type as FieldType, c.source.aggregate as AggregateType);
          }
          if (c.target !== null && c.target !== undefined) {
            chart.encoding.target = new EncodingChannel(c.target.field, c.target.type as FieldType, c.target.aggregate as AggregateType);
          }
          if (c.options !== null && c.options !== undefined) {
            const o = new ChartOptions();
            o.orientation = c.options.orientation;
            o.barmode = c.options.barmode;
            o.histnorm = c.options.histnorm;
            o.cumulative = c.options.cumulative;
            o.boxPoints = c.options.boxPoints;
            o.startField = c.options.startField;
            o.endField = c.options.endField;
            o.openField = c.options.openField;
            o.highField = c.options.highField;
            o.lowField = c.options.lowField;
            o.closeField = c.options.closeField;
            chart.encoding.options = o;
          }
          if (c.path !== null && c.path !== undefined) {
            for (let k = 0; k < c.path.length; k++) {
              chart.encoding.path.push(c.path[k]);
            }
          }
          if (c.layout !== null && c.layout !== undefined) {
            const lay = new ChartLayout();
            for (let k = 0; k < c.layout.annotations.length; k++) {
              lay.annotations.push(new ChartAnnotation(c.layout.annotations[k]));
            }
            for (let k = 0; k < c.layout.shapes.length; k++) {
              const s = c.layout.shapes[k];
              lay.shapes.push(new ChartShape(s.kind, s.value, s.color));
            }
            chart.layout = lay;
          }
          list.push(chart);
        }
      }
      this.charts = list;
      if (data.activeChartId !== undefined) {
        this.activeChartId = data.activeChartId;
      }
      this.dashboard.items = [];
      if (data.dashboardItems !== undefined) {
        const restored: DashboardItem[] = [];
        for (let i = 0; i < data.dashboardItems.length; i++) {
          const d = data.dashboardItems[i];
          const kind = (d.kind as number) === DashboardItemKind.Kpi ? DashboardItemKind.Kpi
            : ((d.kind as number) === DashboardItemKind.Text ? DashboardItemKind.Text
              : DashboardItemKind.Chart);
          restored.push(new DashboardItem(kind, d.chartId, d.label, d.column, d.agg, d.text));
        }
        this.dashboard.items = restored;
      }
      this.dashboard.bump();
      // Datasets + snapshots + QA conversations (web zip restore + hydrate).
      if (data.datasets !== undefined && this.dataState !== null) {
        const frames: DataFrame[] = [];
        let activeIdx = 0;
        for (let i = 0; i < data.datasets.length; i++) {
          const d = data.datasets[i];
          if (d.columns === undefined || d.rows === undefined) {
            continue;
          }
          const cols = columnsFromJson(d.columns);
          frames.push(new DataFrame(d.name !== undefined && d.name.length > 0 ? d.name : d.id, cols, d.rows));
          if (d.active === true) {
            activeIdx = i;
          }
        }
        const snaps: DataSnapshot[] = [];
        if (data.snapshots !== undefined) {
          for (let i = 0; i < data.snapshots.length; i++) {
            const s = data.snapshots[i];
            if (s.columns === undefined || s.rows === undefined) {
              continue;
            }
            snaps.push(new DataSnapshot(s.name, s.description, new DataFrame(s.name, columnsFromJson(s.columns), s.rows),
              s.id, s.createdAt));
          }
        }
        this.dataState.restoreAll(frames, snaps, activeIdx);
        // Per-dataset lineage (web transforms/{id}.json replay metadata).
        for (let i = 0; i < data.datasets.length && i < frames.length; i++) {
          const d = data.datasets[i];
          if (d.base === null || d.base === undefined || d.history === undefined || d.history.length === 0) {
            continue;
          }
          if (d.base.columns === undefined || d.base.rows === undefined) {
            continue;
          }
          const baseFrame = new DataFrame(frames[i].name, columnsFromJson(d.base.columns), d.base.rows);
          const steps: TransformStep[] = [];
          for (let k = 0; k < d.history.length; k++) {
            const sj = d.history[k];
            const op = new TransformOp(sj.type, sj.params);
            if (sj.timestamp !== undefined) {
              op.timestamp = sj.timestamp;
            }
            const step = new TransformStep(op);
            step.enabled = sj.enabled !== false;
            steps.push(step);
          }
          this.dataState.restoreLineage(i, baseFrame, steps);
        }
      }
      if (data.qaConversations !== undefined && this.qaState !== null) {
        this.qaState.importList(data.qaConversations);
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
  dashboardItems?: DashboardItemJson[];
  datasets?: ProjectDatasetJson[];
  snapshots?: ProjectSnapshotJson[];
  qaConversations?: QaConvJson[];
}

interface ProjectColumnJson {
  name: string;
  dtype: string;
  inferredType: string;
  nullable?: boolean;
}

interface ProjectDatasetJson {
  id: string;
  name?: string;
  columns?: ProjectColumnJson[];
  rows?: CellValue[][];
  active?: boolean;
  base?: ProjectFrameJson | null;
  history?: ProjectStepJson[];
}

interface ProjectFrameJson {
  columns?: ProjectColumnJson[];
  rows?: CellValue[][];
}

interface ProjectStepJson {
  type: string;
  params: string;
  timestamp?: string;
  enabled?: boolean;
}

interface ProjectSnapshotJson {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  columns?: ProjectColumnJson[];
  rows?: CellValue[][];
}

function columnsToJson(cols: ColumnMeta[]): ProjectColumnJson[] {
  const out: ProjectColumnJson[] = [];
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    out.push({ name: c.name, dtype: c.dtype, inferredType: c.inferredType, nullable: c.nullable });
  }
  return out;
}

function columnsFromJson(list: ProjectColumnJson[]): ColumnMeta[] {
  const cols: ColumnMeta[] = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    cols.push(new ColumnMeta(c.name, c.dtype as DType, c.inferredType as FieldType, c.nullable !== false));
  }
  return cols;
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
  layout?: ProjectLayoutJson | null;
  facet?: EncChannelJson | null;
  source?: EncChannelJson | null;
  target?: EncChannelJson | null;
  options?: EncOptionsJson | null;
  path?: string[] | null;
}
interface EncOptionsJson {
  orientation?: string;
  barmode?: string;
  histnorm?: string;
  cumulative?: boolean;
  boxPoints?: string;
  startField?: string;
  endField?: string;
  openField?: string;
  highField?: string;
  lowField?: string;
  closeField?: string;
}
interface ProjectLayoutJson {
  annotations: string[];
  shapes: ProjectShapeJson[];
}
interface ProjectShapeJson {
  kind: string;
  value: number;
  color: string;
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
interface DashboardItemJson {
  kind: number;
  chartId: string;
  label: string;
  column: string;
  agg: string;
  text: string;
}
