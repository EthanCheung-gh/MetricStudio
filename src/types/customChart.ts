/**
 * Declarative custom chart manifests (`~/.metricstudio/charts/*.json`).
 *
 * The SPA only ever *reads* these documents: the Python backend owns
 * persistence, validation and rendering. Everything here is the camelCase JSON
 * that travels over the wire — treat it as read-only input, never as a document
 * the frontend normalizes or rewrites.
 */

import type { ChartEncoding } from '@/types/encoding';

/** Bilingual copy carried by a manifest label / option label. */
export interface LocalizedText {
  zh: string;
  en: string;
}

/** Field types a custom channel accepts (mirrors the encoding FieldType). */
export type CustomFieldType = 'quantitative' | 'nominal' | 'temporal';

/** Per-channel declaration (`channels.x` … `channels.target`). */
export interface CustomChannelRule {
  required?: boolean;
  types?: CustomFieldType[];
}

/** How many Y fields the chart consumes. */
export type CustomYFieldsMode = 'none' | 'one' | 'range' | 'multi';

export interface CustomChartChannels {
  x?: CustomChannelRule;
  color?: CustomChannelRule;
  size?: CustomChannelRule;
  facet?: CustomChannelRule;
  z?: CustomChannelRule;
  error?: CustomChannelRule;
  source?: CustomChannelRule;
  target?: CustomChannelRule;
  yFields?: { mode: CustomYFieldsMode };
}

/** One user-tunable knob, rendered in the panel's custom Options section. */
export interface CustomChartOption {
  key: string;
  type: 'number' | 'text' | 'boolean' | 'select';
  default: unknown;
  label: LocalizedText;
  choices?: string[];
}

export interface CustomChartManifest {
  schemaVersion: 1;
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  channels: CustomChartChannels;
  /**
   * Manifest-level faceting (`"$color"` only in schema v1); `null`/absent
   * means no faceting. Mutually exclusive with the `facet` channel.
   */
  facetBy?: '$color' | null;
  transforms?: { op: string; [key: string]: unknown }[];
  traces: { type: string; [key: string]: unknown }[];
  layout?: Record<string, unknown>;
  options?: CustomChartOption[];
  keywords?: string[];
}

/** A manifest as listed by the backend, plus the file it was loaded from. */
export type CustomChartItem = CustomChartManifest & { file: string };

/** A manifest file the backend rejected; kept visible so the user can fix it. */
export interface CustomChartInvalidEntry {
  id: string;
  file: string;
  errors: string[];
}

export interface CustomChartListResponse {
  items: CustomChartItem[];
  invalid: CustomChartInvalidEntry[];
}

/** POST /api/v1/chart/custom — an existing id is overwritten, hence `replaced`. */
export interface CustomChartSaveResponse {
  id: string;
  replaced: boolean;
}

/**
 * POST /api/v1/chart/custom/preview — render an *unsaved* manifest against a
 * dataset. The response is the same figure shape as `/chart/preview`; a
 * rejected manifest answers 400 with the joined validation/render errors in
 * `detail`.
 */
export interface CustomChartPreviewRequest {
  manifest: CustomChartManifest;
  dataset_id: string;
  encoding: ChartEncoding;
  filters?: { field: string; op: 'range' | 'in'; range?: [string, string]; values?: string[] }[];
}

/** POST /api/v1/chart/custom/draft — LLM-assisted manifest authoring. */
export interface CustomChartDraftResponse {
  manifest: CustomChartManifest;
  /** How many LLM repair passes the backend needed to reach a valid manifest. */
  attempts: number;
}

/**
 * 422 body of `/chart/custom/draft`: the model answered, but its manifest is
 * still invalid. `draft` carries the rejected manifest so the workbench can
 * load it for hand editing instead of discarding the suggestion.
 */
export interface CustomChartDraftRejection {
  message: string;
  errors: string[];
  draft?: CustomChartManifest;
}

export interface CustomChartDeleteResponse {
  deleted: boolean;
}
