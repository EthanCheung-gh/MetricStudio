/**
 * Declarative custom chart manifests (`~/.metricstudio/charts/*.json`).
 *
 * The SPA only ever *reads* these documents: the Python backend owns
 * persistence, validation and rendering. Everything here is the camelCase JSON
 * that travels over the wire — treat it as read-only input, never as a document
 * the frontend normalizes or rewrites.
 */

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

export interface CustomChartDeleteResponse {
  deleted: boolean;
}
