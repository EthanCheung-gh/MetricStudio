import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  font: { color: '#f5f5f5' },
  xaxis: { gridcolor: '#333333', zerolinecolor: '#444444' },
  yaxis: { gridcolor: '#333333', zerolinecolor: '#444444' },
  legend: { orientation: 'h', y: -0.2 },
};

const defaultEncoding: ChartEncoding = {
  chartType: 'scatter',
  yFields: [],
};

let previewDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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
          set({ previewFigure: figure, loading: false });
        } catch (err) {
          set({ error: err instanceof Error ? err.message : 'Chart preview failed', loading: false });
        }
      },

      setSelection: (sel) => {
        set({ selection: sel });
        // Re-preview every OTHER chart against the new brush.
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
      partialize: (state) => ({ charts: state.charts }),
      merge: (persisted, current) => {
        const merged = { ...current, ...(persisted as Record<string, unknown>) } as ChartState;
        // Migrate charts from old format (single y) to new format (yFields array)
        if (merged.charts) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          merged.charts = (merged.charts as any[]).map((chart: any) => {
            const enc = chart.encoding || {};
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
