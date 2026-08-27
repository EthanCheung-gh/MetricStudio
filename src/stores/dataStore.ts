import { create } from 'zustand';
import type { DataFrameMeta, DataPreview, DescribeResponse, ColumnMeta, PreviewQuery, SourceStatus } from '@/types/data';
import { api } from '@/api/client';
import { useUIStore } from './uiStore';

let previewRequestId = 0;

export interface TsResult {
  periods?: string[];
  values?: number[];
  pct_change?: (number | null)[];
  ok?: boolean;
}

interface DataState {
  dataFrames: DataFrameMeta[];
  activeDataFrameId: string | null;
  preview: DataPreview | null;
  describe: DescribeResponse | null;
  columns: ColumnMeta[];
  loading: boolean;
  error: string | null;
  sourceStatuses: Record<string, SourceStatus>;
  dataVersions: Record<string, number>;
  /** Per-dataset AI narrative, keyed by DataFrame id (survives dataset switches). */
  narratives: Record<string, string>;
  /** Per-dataset MoM/timeseries result, keyed by DataFrame id. */
  tsResults: Record<string, TsResult>;

  setActiveDataFrame: (id: string | null) => void;
  loadDataFrames: () => Promise<void>;
  importFile: (file: File, mergeSheets?: boolean) => Promise<DataFrameMeta>;
  importText: (name: string, text: string) => Promise<DataFrameMeta>;
  importSample: () => Promise<DataFrameMeta>;
  refreshActiveDataFrame: () => Promise<void>;
  loadPreviewPage: (query: PreviewQuery) => Promise<void>;
  loadSourceStatuses: () => Promise<void>;
  refreshSource: (id: string) => Promise<void>;
  /** Auto-refresh every changed source; returns refreshed dataset names. */
  autoRefreshChangedSources: () => Promise<string[]>;
  removeDataFrame: (id: string) => Promise<void>;
  setNarrative: (id: string, text: string) => void;
  setTsResult: (id: string, result: TsResult) => void;
  clearError: () => void;
}

export const useDataStore = create<DataState>((set, get) => ({
  dataFrames: [],
  activeDataFrameId: null,
  preview: null,
  describe: null,
  columns: [],
  loading: false,
  error: null,
  sourceStatuses: {},
  dataVersions: {},
  narratives: {},
  tsResults: {},

  setActiveDataFrame: (id) => {
    set({ activeDataFrameId: id, preview: null, describe: null, columns: [], error: null });
    if (id) {
      get().refreshActiveDataFrame();
    }
  },

  loadDataFrames: async () => {
    set({ loading: true, error: null });
    try {
      const dataFrames = await api.listDataFrames();
      set({ dataFrames, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load datasets', loading: false });
    }
  },

  importFile: async (file, mergeSheets = false) => {
    set({ loading: true, error: null });
    try {
      const results: DataFrameMeta[] = await api.importFile(file, mergeSheets);
      set((state) => ({
        dataFrames: [...state.dataFrames, ...results],
        activeDataFrameId: results[0]?.id || state.activeDataFrameId,
        loading: false,
      }));
      if (results[0]) {
        setTimeout(() => {
          get().setActiveDataFrame(results[0].id);
        }, 0);
      }
      if (results.length > 1) {
        useUIStore.getState().addNotification('success', `Imported ${results.length} sheets from ${file.name}`);
      }
      return results[0];
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Import failed', loading: false });
      throw err;
    }
  },

  importText: async (name, text) => {
    set({ loading: true, error: null });
    try {
      const results: DataFrameMeta[] = await api.importText(name, text);
      set((state) => ({
        dataFrames: [...state.dataFrames, ...results],
        activeDataFrameId: results[0]?.id || state.activeDataFrameId,
        loading: false,
      }));
      if (results[0]) {
        setTimeout(() => {
          get().setActiveDataFrame(results[0].id);
        }, 0);
      }
      return results[0];
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Import failed', loading: false });
      throw err;
    }
  },

  importSample: async () => {
    set({ loading: true, error: null });
    try {
      const sample = await api.importSample();
      set((state) => ({
        dataFrames: state.dataFrames.some((dataset) => dataset.id === sample.id)
          ? state.dataFrames
          : [...state.dataFrames, sample],
        activeDataFrameId: sample.id,
        preview: null,
        describe: null,
        columns: [],
        loading: false,
      }));
      await get().refreshActiveDataFrame();
      return sample;
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Sample import failed', loading: false });
      throw err;
    }
  },

  refreshActiveDataFrame: async () => {
    const { activeDataFrameId } = get();
    if (!activeDataFrameId) return;
    const requestId = ++previewRequestId;
    set({ loading: true, error: null });
    try {
      const [preview, describe, columns] = await Promise.all([
        api.previewDataFrame(activeDataFrameId, { limit: 200, offset: 0 }),
        api.describeDataFrame(activeDataFrameId),
        api.getColumns(activeDataFrameId),
      ]);
      if (requestId === previewRequestId && get().activeDataFrameId === activeDataFrameId) {
        set({ preview, describe, columns, loading: false });
      }
    } catch (err) {
      if (requestId === previewRequestId && get().activeDataFrameId === activeDataFrameId) {
        set({ error: err instanceof Error ? err.message : 'Failed to load preview', loading: false });
      }
    }
  },

  loadPreviewPage: async (query) => {
    const { activeDataFrameId } = get();
    if (!activeDataFrameId) return;
    const requestId = ++previewRequestId;
    set({ loading: true, error: null });
    try {
      const preview = await api.previewDataFrame(activeDataFrameId, query);
      if (requestId === previewRequestId && get().activeDataFrameId === activeDataFrameId) {
        set({ preview, loading: false });
      }
    } catch (err) {
      if (requestId === previewRequestId && get().activeDataFrameId === activeDataFrameId) {
        set({ error: err instanceof Error ? err.message : 'Failed to load preview', loading: false });
      }
    }
  },

  loadSourceStatuses: async () => {
    try {
      const statuses = await api.sourceStatus();
      set({ sourceStatuses: Object.fromEntries(statuses.map((status) => [status.dataset_id, status])) });
    } catch {
      set({ sourceStatuses: {} });
    }
  },

  refreshSource: async (id) => {
    await api.refreshDataset(id);
    set((state) => ({ dataVersions: { ...state.dataVersions, [id]: (state.dataVersions[id] || 0) + 1 } }));
    await Promise.all([get().loadDataFrames(), get().loadSourceStatuses()]);
    if (get().activeDataFrameId === id) await get().refreshActiveDataFrame();
  },

  autoRefreshChangedSources: async () => {
    const refreshable = Object.values(get().sourceStatuses).filter(
      (status) => status.changed && status.refreshable && status.original_exists !== false,
    );
    const refreshed: string[] = [];
    for (const status of refreshable) {
      try {
        await get().refreshSource(status.dataset_id);
        const name = get().dataFrames.find((df) => df.id === status.dataset_id)?.name;
        if (name) refreshed.push(name);
      } catch {
        // Keep other sources refreshing; surface the failure per dataset below.
        useUIStore.getState().addNotification(
          'error',
          `Auto-refresh failed: ${status.dataset_name}. Data kept at last good version.`,
        );
      }
    }
    return refreshed;
  },

  removeDataFrame: async (id) => {
    set({ loading: true, error: null });
    try {
      await api.deleteDataFrame(id);
      set((state) => ({
        dataFrames: state.dataFrames.filter((df) => df.id !== id),
        activeDataFrameId: state.activeDataFrameId === id ? null : state.activeDataFrameId,
        preview: state.activeDataFrameId === id ? null : state.preview,
        describe: state.activeDataFrameId === id ? null : state.describe,
        columns: state.activeDataFrameId === id ? [] : state.columns,
        narratives: Object.fromEntries(Object.entries(state.narratives).filter(([k]) => k !== id)),
        tsResults: Object.fromEntries(Object.entries(state.tsResults).filter(([k]) => k !== id)),
        loading: false,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete dataset', loading: false });
    }
  },

  setNarrative: (id, text) =>
    set((state) => ({ narratives: { ...state.narratives, [id]: text } })),

  setTsResult: (id, result) =>
    set((state) => ({ tsResults: { ...state.tsResults, [id]: result } })),

  clearError: () => set({ error: null }),
}));
