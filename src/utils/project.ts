import { api } from '@/api/client';
import { useDataStore } from '@/stores/dataStore';
import { useChartStore } from '@/stores/chartStore';
import { useDashboardStore } from '@/stores/dashboardStore';
import { useUIStore } from '@/stores/uiStore';

export interface LoadProjectResult {
  restored: number;
  name: string;
}

/**
 * Load a project bundle from a server-side path, restore datasets + charts
 * into the stores, and record it as a recent project.
 * Shared by the TitleBar modal and the command palette.
 */
export async function loadProjectByPath(path: string): Promise<LoadProjectResult> {
  const result = await api.loadProject(path);
  const data = useDataStore.getState();
  await data.loadDataFrames();
  if (result.datasets.length > 0) {
    data.setActiveDataFrame(result.datasets[0].id);
  }
  if (result.charts.length > 0) {
    useChartStore.getState().loadCharts(result.charts);
  }
  if (result.dashboards && result.dashboards.length > 0) {
    useDashboardStore.getState().loadDashboards(result.dashboards);
  }
  const name = result.project.name || path;
  useUIStore.getState().addRecentProject({ path, name });
  return { restored: result.restored.length, name };
}
