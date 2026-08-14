import type {
  DataFrameMeta,
  DataPreview,
  DescribeResponse,
  FilterParams,
  SortParams,
  RenameParams,
  DTypeParams,
  TransformHistoryItem,
  LineageResponse,
  QualityReport,
} from '@/types/data';
import type { PlotlyFigure } from '@/types/plotly';
import type { ChartEncoding, ChartTemplate, ChartConfig, ChartRecommendation, SelectionFilter } from '@/types/encoding';
import type { DashboardConfig } from '@/types/dashboard';

export interface DepsReport {
  python: string;
  pythonOk: boolean;
  packages: Record<string, { available: boolean; version: string | null }>;
  missingRequired: string[];
  missingOptional: string[];
  ok: boolean;
}

export interface GlobalUndoResponse {
  dataset_id: string;
  preview: DataPreview;
}

export interface LoadProjectResponse {
  project: {
    name?: string;
    version?: string;
    data_sources: { id: string; name: string; rows: number; cols: number }[];
    charts: ChartConfig[];
    dashboards?: DashboardConfig[];
  };
  restored: string[];
  datasets: DataFrameMeta[];
  charts: ChartConfig[];
  dashboards: DashboardConfig[];
}

const DEFAULT_BACKEND_PORT = 8123;

function getBaseUrl(): string {
  // In Tauri production, the backend port is injected at runtime.
  if (import.meta.env.VITE_BACKEND_PORT) {
    return `http://${window.location.hostname}:${import.meta.env.VITE_BACKEND_PORT}`;
  }
  // Use current hostname for remote access, fallback to localhost for local dev
  const host = window.location.hostname === 'localhost' ? '127.0.0.1' : window.location.hostname;
  return `http://${host}:${DEFAULT_BACKEND_PORT}`;
}

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body.detail || JSON.stringify(body)
    } catch {
      detail = await response.text().catch(() => 'Unknown error')
    }
    throw new Error(`${response.status} ${response.statusText}: ${path} — ${detail}`)
  }
  return response.json() as Promise<T>
}

async function postForm<T>(path: string, formData: FormData): Promise<T> {
  const url = `${getBaseUrl()}${path}`
  const response = await fetch(url, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.json()
      detail = body.detail || JSON.stringify(body)
    } catch {
      detail = await response.text().catch(() => 'Unknown error')
    }
    throw new Error(`${response.status} ${response.statusText}: ${path} — ${detail}`)
  }
  return response.json() as Promise<T>
}

export const api = {
  health: () => fetchJson<{ status: string }>('/health'),

  // Data
  importFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return postForm<DataFrameMeta[]>('/api/v1/data/import', formData);
  },
  listDataFrames: () => fetchJson<DataFrameMeta[]>('/api/v1/data/list'),
  lineage: () => fetchJson<LineageResponse>('/api/v1/data/lineage'),
  quality: (id: string) => fetchJson<QualityReport>(`/api/v1/data/${id}/quality`),
  insights: (id: string) =>
    fetchJson<{ insights: { type: string; text: string; evidence: Record<string, unknown> }[] }>(
      `/api/v1/data/${id}/insights`
    ),
  getDataFrame: (id: string) => fetchJson<DataFrameMeta>(`/api/v1/data/${id}`),
  previewDataFrame: (id: string, limit = 100, at?: number) =>
    fetchJson<DataPreview>(`/api/v1/data/${id}/preview?limit=${limit}${at !== undefined ? `&at=${at}` : ''}`),
  getColumns: (id: string) => fetchJson<import('@/types/data').ColumnMeta[]>(`/api/v1/data/${id}/columns`),
  describeDataFrame: (id: string) => fetchJson<DescribeResponse>(`/api/v1/data/${id}/describe`),
  deleteDataFrame: (id: string) => fetchJson<void>(`/api/v1/data/${id}`, { method: 'DELETE' }),

  // Transform
  filter: (id: string, params: FilterParams) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/filter`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  sort: (id: string, params: SortParams) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/sort`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  dropNa: (id: string, columns?: string[]) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/dropna`, {
      method: 'POST',
      body: JSON.stringify({ columns }),
    }),
  fillNa: (id: string, column: string, value: string | number) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/fillna`, {
      method: 'POST',
      body: JSON.stringify({ column, value }),
    }),
  rename: (id: string, params: RenameParams) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/rename`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  castDtype: (id: string, params: DTypeParams) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/dtype`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  compute: (id: string, name: string, expression: string) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/compute`, {
      method: 'POST',
      body: JSON.stringify({ name, expression }),
    }),
  pivot: (id: string, params: { index: string; columns: string; values: string; aggfunc: string }) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/pivot`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  melt: (id: string, params: { id_vars: string[]; value_vars?: string[]; var_name?: string; value_name?: string }) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/melt`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  join: (id: string, params: { right_dataset_id: string; on?: string; left_on?: string; right_on?: string; how: string }) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/join`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),
  history: (id: string) =>
    fetchJson<TransformHistoryItem[]>(`/api/v1/transform/${id}/history`),
  undo: (id: string, toIndex?: number) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/undo`, {
      method: 'POST',
      body: JSON.stringify({ to_index: toIndex }),
    }),
  applyRecipe: (id: string, recipeId: string) =>
    fetchJson<DataPreview>(`/api/v1/transform/${id}/recipe/${recipeId}`, { method: 'POST' }),

  // Global undo/redo
  globalUndo: () =>
    fetchJson<GlobalUndoResponse>('/api/v1/transform/global/undo', { method: 'POST' }),
  globalRedo: () =>
    fetchJson<GlobalUndoResponse>('/api/v1/transform/global/redo', { method: 'POST' }),

  // Chart
  previewChart: (
    datasetId: string,
    encoding: ChartEncoding,
    selection?: SelectionFilter,
    filters?: { field: string; op: 'range' | 'in'; range?: [string, string]; values?: string[] }[],
  ) =>
    fetchJson<PlotlyFigure>('/api/v1/chart/preview', {
      method: 'POST',
      body: JSON.stringify({
        dataset_id: datasetId,
        encoding,
        selection: selection ?? undefined,
        filters: filters ?? undefined,
      }),
    }),
  aggregate: (datasetId: string, encoding: ChartEncoding) =>
    fetchJson<PlotlyFigure>('/api/v1/chart/aggregate', {
      method: 'POST',
      body: JSON.stringify({ dataset_id: datasetId, encoding }),
    }),
  listTemplates: () => fetchJson<ChartTemplate[]>('/api/v1/chart/templates'),
  chartRecommendations: (id: string) =>
    fetchJson<{ recommendations: ChartRecommendation[] }>(`/api/v1/data/${id}/chart-recommendations`),

  // System
  checkDeps: () => fetchJson<DepsReport>('/api/v1/system/deps'),
  saveTemplate: (name: string, encoding: ChartEncoding, layout: Record<string, unknown>) =>
    fetchJson<ChartTemplate>('/api/v1/chart/templates', {
      method: 'POST',
      body: JSON.stringify({ name, encoding, layout }),
    }),
  deleteTemplate: (templateId: string) =>
    fetchJson<{ deleted: boolean }>(`/api/v1/chart/templates/${templateId}`, { method: 'DELETE' }),

  // Project
  saveProject: (payload: { path: string; name: string; charts?: ChartConfig[]; dashboards?: DashboardConfig[] }) =>
    fetchJson<{ path: string; datasets: number }>('/api/v1/project/save', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  loadProject: (path: string) =>
    fetchJson<LoadProjectResponse>('/api/v1/project/load', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  uploadProject: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return postForm<{ path: string; name: string }>('/api/v1/project/upload', formData);
  },
  exportHtml: (figure: PlotlyFigure) =>
    fetchJson<{ html: string }>('/api/v1/project/export/html', {
      method: 'POST',
      body: JSON.stringify({ figure }),
    }),
  exportPng: (figure: PlotlyFigure) =>
    fetchJson<{ png: string }>('/api/v1/project/export/png', {
      method: 'POST',
      body: JSON.stringify({ figure }),
    }),

  // Report
  generateReport: (payload: {
    title: string;
    dataset_id?: string;
    charts: { name: string; figure: PlotlyFigure }[];
    notes: string;
    include_insights: boolean;
  }) =>
    fetchJson<{ html: string }>('/api/v1/report/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// Re-export types used by client consumers
export type { ColumnMeta } from '@/types/data';
