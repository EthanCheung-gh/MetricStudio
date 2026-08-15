import type { ReactNode } from 'react';
import {
  BarChart3,
  Database,
  FolderOpen,
  FileText,
  FileUp,
  Languages,
  Lightbulb,
  Monitor,
  Sparkles,
  Moon,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Sun,
  Table2,
  Undo2,
} from 'lucide-react';
import { loadProjectByPath } from '@/utils/project';
import { globalUndo, globalRedo } from '@/utils/globalHistory';
import i18n from '@/i18n';
import { useDataStore } from '@/stores/dataStore';
import { useChartStore } from '@/stores/chartStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useUIStore } from '@/stores/uiStore';

export type CommandCategory = 'Navigation' | 'Actions' | 'Settings' | 'Datasets' | 'Charts';

export interface Command {
  id: string;
  title: string;
  keywords?: string;
  category: CommandCategory;
  icon?: ReactNode;
  run: () => void;
}

/**
 * Build the full command list from current store state.
 * Called while the palette is open so dataset/chart entries stay fresh.
 */
export function getCommands(): Command[] {
  const data = useDataStore.getState();
  const chart = useChartStore.getState();
  const ws = useWorkspaceStore.getState();
  const ui = useUIStore.getState();

  const staticCommands: Command[] = [
    {
      id: 'import',
      title: '导入数据…',
      category: 'Actions',
      icon: <FileUp size={14} />,
      run: () => ui.setImportModalOpen(true),
    },
    {
      id: 'new-chart',
      title: '新建图表',
      category: 'Actions',
      icon: <BarChart3 size={14} />,
      run: () => {
        const activeId = data.activeDataFrameId || data.dataFrames[0]?.id;
        if (!activeId) {
          ui.setImportModalOpen(true);
          return;
        }
        const created = chart.createChart(activeId);
        ws.setActiveTab('chart');
        ws.openChartTab(created.id);
      },
    },
    {
      id: 'save-project',
      title: '保存项目…',
      category: 'Actions',
      icon: <Save size={14} />,
      run: () => ui.setSaveProjectModalOpen(true),
    },
    {
      id: 'open-project',
      title: '打开项目…',
      category: 'Actions',
      icon: <FolderOpen size={14} />,
      run: () => ui.setLoadProjectModalOpen(true),
    },
    {
      id: 'generate-report',
      title: '生成报告…',
      category: 'Actions',
      icon: <FileText size={14} />,
      run: () => ui.setReportDialogOpen(true),
    },
    {
      id: 'insights',
      title: '查看洞察',
      category: 'Actions',
      icon: <Lightbulb size={14} />,
      run: () => {
        const id = data.activeDataFrameId || data.dataFrames[0]?.id;
        if (!id) {
          ui.setImportModalOpen(true);
          return;
        }
        data.setActiveDataFrame(id);
        ws.setActiveTab('data');
      },
    },
    {
      id: 'cleaning-scan',
      title: '数据清洗扫描…',
      category: 'Actions',
      icon: <Sparkles size={14} />,
      run: () => {
        const id = data.activeDataFrameId || data.dataFrames[0]?.id;
        if (!id) {
          ui.setImportModalOpen(true);
          return;
        }
        data.setActiveDataFrame(id);
        ws.setActiveTab('data');
        ui.bumpCleaningScan();
      },
    },
    {
      id: 'undo',
      title: '撤销',
      category: 'Actions',
      icon: <Undo2 size={14} />,
      run: () => {
        globalUndo();
      },
    },
    {
      id: 'redo',
      title: '重做',
      category: 'Actions',
      icon: <Redo2 size={14} />,
      run: () => {
        globalRedo();
      },
    },
    {
      id: 'go-data',
      title: '切换到数据标签',
      category: 'Navigation',
      icon: <Table2 size={14} />,
      run: () => ws.setActiveTab('data'),
    },
    {
      id: 'go-chart',
      title: '切换到图表标签',
      category: 'Navigation',
      icon: <BarChart3 size={14} />,
      run: () => ws.setActiveTab('chart'),
    },
    {
      id: 'panel-left',
      title: '切换左面板',
      category: 'Settings',
      icon: <PanelLeft size={14} />,
      run: () => ws.togglePanel('left'),
    },
    {
      id: 'panel-right',
      title: '切换右面板',
      category: 'Settings',
      icon: <PanelRight size={14} />,
      run: () => ws.togglePanel('right'),
    },
    {
      id: 'theme-dark',
      title: '主题: 深色',
      category: 'Settings',
      icon: <Moon size={14} />,
      run: () => ws.setTheme('dark'),
    },
    {
      id: 'theme-light',
      title: '主题: 浅色',
      category: 'Settings',
      icon: <Sun size={14} />,
      run: () => ws.setTheme('light'),
    },
    {
      id: 'theme-system',
      title: '主题: 跟随系统',
      category: 'Settings',
      icon: <Monitor size={14} />,
      run: () => ws.setTheme('system'),
    },
    {
      id: 'language',
      title: i18n.t('cmd.language'),
      category: 'Settings',
      icon: <Languages size={14} />,
      run: () => {
        const cur = useUIStore.getState().language;
        useUIStore.getState().setLanguage(cur === 'zh' ? 'en' : 'zh');
      },
    },
  ];

  const recentCommands: Command[] = ui.recentProjects.map((p) => ({
    id: `recent-${p.path}`,
    title: `打开最近: ${p.name}`,
    keywords: `recent project open ${p.name}`,
    category: 'Actions' as const,
    icon: <FolderOpen size={14} />,
    run: () => {
      loadProjectByPath(p.path).catch(() => {});
    },
  }));

  const datasetCommands: Command[] = data.dataFrames.map((df) => ({
    id: `dataset-${df.id}`,
    title: df.name,
    keywords: `dataset dataframe ${df.name}`,
    category: 'Datasets' as const,
    icon: <Database size={14} />,
    run: () => data.setActiveDataFrame(df.id),
  }));

  const chartCommands: Command[] = chart.charts.map((c) => ({
    id: `chart-${c.id}`,
    title: c.name,
    keywords: `chart graph ${c.name}`,
    category: 'Charts' as const,
    icon: <BarChart3 size={14} />,
    run: () => {
      chart.setActiveChart(c.id);
      ws.setActiveTab('chart');
      if (!ws.openChartTabs.includes(c.id)) ws.openChartTab(c.id);
    },
  }));

  return [...staticCommands, ...recentCommands, ...datasetCommands, ...chartCommands];
}
