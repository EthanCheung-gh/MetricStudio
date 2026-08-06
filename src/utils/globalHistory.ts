import { api } from '@/api/client';
import { useDataStore } from '@/stores/dataStore';
import { useChartStore } from '@/stores/chartStore';

/**
 * Refresh the UI after a global undo/redo touched a dataset:
 * - update the preview (+ describe/columns) of the affected dataset
 * - re-preview any chart built on it
 */
function refreshAfterGlobalChange(datasetId: string) {
  const data = useDataStore.getState();
  if (data.activeDataFrameId === datasetId) {
    data.refreshActiveDataFrame();
  } else {
    data.setActiveDataFrame(datasetId);
  }
  const chart = useChartStore.getState();
  chart.charts.forEach((c) => {
    if (c.datasetId === datasetId) {
      chart.previewChart(c.datasetId, c.encoding, c.id);
    }
  });
}

export async function globalUndo(): Promise<boolean> {
  try {
    const res = await api.globalUndo();
    refreshAfterGlobalChange(res.dataset_id);
    return true;
  } catch {
    return false;
  }
}

export async function globalRedo(): Promise<boolean> {
  try {
    const res = await api.globalRedo();
    refreshAfterGlobalChange(res.dataset_id);
    return true;
  } catch {
    return false;
  }
}
