import { create } from 'zustand';
import type { DataFrameMeta, DataPreview, DescribeResponse, ColumnMeta } from '@/types/data';
import { api } from '@/api/client';
import { useUIStore } from './uiStore';

interface DataState {
  dataFrames: DataFrameMeta[];
  activeDataFrameId: string | null;
  preview: DataPreview | null;
  describe: DescribeResponse | null;
  columns: ColumnMeta[];
  loading: boolean;
  error: string | null;

  setActiveDataFrame: (id: string | null) => void;
  loadDataFrames: () => Promise<void>;
  importFile: (file: File) => Promise<DataFrameMeta>;
  refreshActiveDataFrame: () => Promise<void>;
  removeDataFrame: (id: string) => Promise<void>;
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

  setActiveDataFrame: (id) => {
    set({ activeDataFrameId: id });
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

  importFile: async (file) => {
    set({ loading: true, error: null });
    try {
      const results: DataFrameMeta[] = await api.importFile(file);
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

  refreshActiveDataFrame: async () => {
    const { activeDataFrameId } = get();
    if (!activeDataFrameId) return;
    set({ loading: true, error: null });
    try {
      const [preview, describe, columns] = await Promise.all([
        api.previewDataFrame(activeDataFrameId, 100),
        api.describeDataFrame(activeDataFrameId),
        api.getColumns(activeDataFrameId),
      ]);
      set({ preview, describe, columns, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to load preview', loading: false });
    }
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
        loading: false,
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to delete dataset', loading: false });
    }
  },

  clearError: () => set({ error: null }),
}));
