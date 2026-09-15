import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { ChartConfig, ChartEncoding, SelectionFilter } from '@/types/encoding';
import type { PlotlyFigure } from '@/types/plotly';
import { api } from '@/api/client';
import { generateId } from '@/utils/id';

export interface ChartSelection extends SelectionFilter {
  /** Source chart that produced the brush */
  chartId: string;
  sourceName: string;
}

interface ChartState {
  charts: ChartConfig[];
  activeChartId: string | null;
  previewFigure: PlotlyFigure | null;
  selection: ChartSelection | null;
  loading: boolean;
  error: string | null;

  createChart: (datasetId: string, name?: string) => ChartConfig;
  duplicateChart: (id: string) => ChartConfig | null;
  setActiveChart: (id: string | null) => void;
  updateEncoding: (id: string, encoding: Partial<ChartEncoding>) => void;
  updateLayout: (id: string, layout: Record<string, unknown>) => void;
  updateName: (id: string, name: string) => void;
  removeChart: (id: string) => void;
  previewChart: (datasetId: string, encoding: ChartEncoding, chartId?: string) => Promise<void>;
  setSelection: (sel: ChartSelection) => void;
  clearSelection: () => void;
  loadCharts: (charts: ChartConfig[]) => void;
  clearError: () => void;
}

const defaultLayout: Record<string, unknown> = {
  autosize: true,
  margin: { t: 40, r: 20, b: 40, l: 60 },
  paper_bgcolor: 'rgba(0,0,0,0)',
  plot_bgcolor: 'rgba(0,0,0,0)',
  font: {},
  xaxis: {},
  yaxis: {},
  legend: { orientation: 'h', y: -0.2 },
};

const defaultEncoding: ChartEncoding = {
  chartType: 'scatter',
  yFields: [],
};

let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// v1.7.1: monotonic token — only the most recently issued preview may write
// `previewFigure`, so slow stale responses can never overwrite fresh ones.
let previewSeq = 0;

/**
 * v1.7.1: debounced persist storage — zustand's default storage stringifies
 * the whole charts array synchronously on EVERY set (per keystroke on rename,
 * every preview response), which made chart switching janky. Writes are
 * merged in a trailing 250ms window and flushed on page unload.
 */
const pendingWrites = new Map<string, string>();
let persistFlushTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingPersist(): void {
  if (persistFlushTimer) clearTimeout(persistFlushTimer);
  persistFlushTimer = null;
  for (const [name, value] of pendingWrites) {
    try { localStorage.setItem(name, value); } catch { /* quota / private mode */ }
  }
  pendingWrites.clear();
}

const debouncedLocalStorage = {
  getItem: (name: string): string | null => localStorage.getItem(name),
  setItem: (name: string, value: string): void => {
    pendingWrites.set(name, value);
    if (persistFlushTimer) clearTimeout(persistFlushTimer);
    persistFlushTimer = setTimeout(flushPendingPersist, 250);
  },
  removeItem: (name: string): void => {
    pendingWrites.delete(name);
    localStorage.removeItem(name);
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingPersist);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushPendingPersist();
  });
}

export const useChartStore = create<ChartState>()(
  persist(
    (set, get) => ({
      charts: [],
      activeChartId: null,
      previewFigure: null,
      selection: null,
      loading: false,
      error: null,

      createChart: (datasetId, name) => {
        const chart: ChartConfig = {
          id: generateId(),
          name: name || `Chart ${get().charts.length + 1}`,
          datasetId,
          encoding: { ...defaultEncoding },
          layout: { ...defaultLayout, title: name || `Chart ${get().charts.length + 1}` },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({
          charts: [...state.charts, chart],
          activeChartId: chart.id,
        }));
        return chart;
      },

      duplicateChart: (id) => {
        const source = get().charts.find((c) => c.id === id);
        if (!source) return null;
        const copy: ChartConfig = {
          ...source,
          id: generateId(),
          name: `${source.name} copy`,
          encoding: JSON.parse(JSON.stringify(source.encoding)),
          layout: JSON.parse(JSON.stringify(source.layout)),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        set((state) => ({ charts: [...state.charts, copy], activeChartId: copy.id }));
        return copy;
      },

      setActiveChart: (id) => set({ activeChartId: id }),

      updateEncoding: (id, encoding) => {
        set((state) => ({
          charts: state.charts.map((chart) =>
            chart.id === id
              ? { ...chart, encoding: { ...chart.encoding, ...encoding }, updatedAt: new Date().toISOString() }
              : chart
          ),
        }));
        if (previewDebounceTimer) clearTimeout(previewDebounceTimer);
        previewDebounceTimer = setTimeout(() => {
          const chart = get().charts.find((c) => c.id === id);
          if (chart) {
            get().previewChart(chart.datasetId, chart.encoding, chart.id);
          }
        }, 150);
      },

      updateLayout: (id, layout) => {
        set((state) => ({
          charts: state.charts.map((chart) =>
            chart.id === id
              ? { ...chart, layout: { ...chart.layout, ...layout }, updatedAt: new Date().toISOString() }
              : chart
          ),
        }));
      },

      updateName: (id, name) => {
        set((state) => ({
          charts: state.charts.map((chart) =>
            chart.id === id ? { ...chart, name, updatedAt: new Date().toISOString() } : chart
          ),
        }));
      },

      removeChart: (id) => {
        set((state) => ({
          charts: state.charts.filter((chart) => chart.id !== id),
          activeChartId: state.activeChartId === id ? null : state.activeChartId,
        }));
      },

      previewChart: async (datasetId, encoding, chartId) => {
        // v1.7.1: skip requests for charts that are not the active one —
        // they share the single `previewFigure` and would clobber the
        // currently displayed chart (brush-link / undo replays).
        const activeChartId = get().activeChartId;
        if (chartId && activeChartId && chartId !== activeChartId) return;
        const seq = ++previewSeq;
        set({ loading: true, error: null });
        try {
          // Crossfilter: apply the active selection to every chart EXCEPT its source.
          const sel = get().selection;
          const applySel =
            sel && sel.chartId !== chartId && (sel.xRange || sel.yRange)
              ? {
                  xField: sel.xField,
                  yField: sel.yField,
                  xRange: sel.xRange,
                  yRange: sel.yRange,
                }
              : undefined;
          const figure = await api.previewChart(datasetId, encoding, applySel);
          if (seq !== previewSeq) return; // a newer preview was issued meanwhile
          set({ previewFigure: figure, loading: false });
        } catch (err) {
          if (seq !== previewSeq) return;
          set({ error: err instanceof Error ? err.message : 'Chart preview failed', loading: false });
        }
      },

      setSelection: (sel) => {
        set({ selection: sel });
        // Re-preview every OTHER chart against the new brush. previewChart
        // itself skips non-active charts (single previewFigure), so only the
        // source chart's own re-render matters here.
        const state = get();
        state.charts.forEach((c) => {
          if (c.id !== sel.chartId) state.previewChart(c.datasetId, c.encoding, c.id);
        });
      },

      clearSelection: () => {
        set({ selection: null });
        const state = get();
        state.charts.forEach((c) => {
          state.previewChart(c.datasetId, c.encoding, c.id);
        });
      },

      loadCharts: (charts) => set({ charts }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'metricstudio-charts',
      storage: createJSONStorage(() => debouncedLocalStorage),
      partialize: (state) => ({ charts: state.charts }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Record<string, unknown>) } as ChartState;
        // Migrate charts from old format (single y) to new format (yFields array)
        if (merged.charts) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          merged.charts = (merged.charts as any[]).map((chart: any) => {
            const enc = chart.encoding || {};
            const layout = chart.layout || {};
            const font = layout.font || {};
            const xaxis = layout.xaxis || {};
            const yaxis = layout.yaxis || {};
            if (font.color === '#f5f5f5') delete font.color;
            if (xaxis.gridcolor === '#333333') delete xaxis.gridcolor;
            if (xaxis.zerolinecolor === '#444444') delete xaxis.zerolinecolor;
            if (yaxis.gridcolor === '#333333') delete yaxis.gridcolor;
            if (yaxis.zerolinecolor === '#444444') delete yaxis.zerolinecolor;
            if ('y' in enc && !('yFields' in enc)) {
              const oldY = enc.y;
              delete enc.y;
              enc.yFields = oldY
                ? [
                    {
                      field: oldY.field,
                      type: oldY.type || 'quantitative',
                      aggregate: oldY.aggregate || null,
                      axis: 'left',
                      normalize: 'none',
                    },
                  ]
                : [];
            }
            return chart;
          }) as ChartConfig[];
        }
        return merged as ChartState;
      },
    }
  )
);
