export type EngineType = 'pandas' | 'polars' | 'auto';

export interface ColumnMeta {
  name: string;
  dtype: string;
  inferredType: 'quantitative' | 'nominal' | 'temporal' | 'unknown';
  nullable: boolean;
  uniqueCount?: number;
}

export interface DataFrameMeta {
  id: string;
  name: string;
  engine: EngineType;
  rows: number;
  cols: number;
  columns: ColumnMeta[];
  createdAt: string;
}

export interface DataPreview {
  columns: string[];
  rows: (string | number | boolean | null)[][];
  totalRows: number;
  totalCols: number;
}

export interface DataDiffResult {
  left_rows: number;
  right_rows: number;
  left_cols: number;
  right_cols: number;
  only_left: string[];
  only_right: string[];
  numeric_diff: { column: string; left_mean: number | null; right_mean: number | null }[];
  left_step?: number;
  right_step?: number;
}

export interface DescribeResponse {
  columns: string[];
  stats: Record<string, Record<string, number | null>>;
}

export interface TransformHistoryItem {
  id: string;
  type: string;
  params: Record<string, unknown>;
  timestamp: string;
}

export interface FilterParams {
  column: string;
  operator: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'startswith' | 'endswith';
  value: string | number;
}

export interface SortParams {
  column: string;
  ascending: boolean;
}

export interface RenameParams {
  mappings: Record<string, string>;
}

export interface DTypeParams {
  mappings: Record<string, string>;
}

export interface LineageNode {
  id: string;
  dataset_id: string;
  dataset_name: string;
  /** -1 = import state; i = state after the i-th operation */
  step: number;
  op: string;
  rows: number | null;
  cols: number | null;
  params: Record<string, unknown>;
}

export interface LineageEdge {
  source: string;
  target: string;
  op: string;
  /** true when the edge crosses datasets (join) */
  cross: boolean;
}

export interface LineageResponse {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export interface CleaningRecipe {
  id: string;
  name: string;
  description: string;
  dynamic: boolean;
}

export interface QualityIssue {
  id: string;
  severity: 'info' | 'warning';
  title: string;
  detail: string;
  columns: string[];
  suggestions: string[];
}

export interface ReportTemplate {
  id: string;
  name: string;
  title: string;
  chartIds: string[];
  notes: string;
  includeInsights: boolean;
}

export interface UserRecipe {
  id: string;
  name: string;
  steps: { type: string; params: Record<string, unknown> }[];
  created_at: string;
}

export interface QualityReport {
  issues: QualityIssue[];
  summary: { missing_cells: number; duplicate_rows: number; columns: number; rows: number };
  recipes: CleaningRecipe[];
}
