import type {
  CustomChannelRule,
  CustomChartChannels,
  CustomChartManifest,
  CustomChartOption,
  CustomFieldType,
  CustomYFieldsMode,
} from '@/types/customChart'
import type { ChartEncoding, FieldType } from '@/types/encoding'

/**
 * Form <-> manifest translation for the custom-chart workbench.
 *
 * Everything here is pure and synchronous: the workbench keeps a `ManifestForm`
 * (strings and booleans, all directly editable) and only ever posts the
 * `CustomChartManifest` produced by `formToManifest`. The backend stays the
 * authority on validity, so this module never throws on bad input — JSON
 * textareas report a field-level error instead, and unparsable sections are
 * simply left out of the manifest it returns.
 *
 * Round-trip contract: `formToManifest(manifestToForm(m))` is semantically
 * equal to `m` for every manifest the backend accepted. Fields the manifest
 * omits because they equal the schema default (`required: true`,
 * `descending: false`, `from: "top"`) are re-emitted or dropped
 * accordingly — see the individual converters.
 */

/** Manifest keys of `channels` that describe an encodable channel. */
export const CHANNEL_KEYS = [
  'x',
  'color',
  'size',
  'facet',
  'z',
  'error',
  'source',
  'target',
] as const
export type ChannelKey = (typeof CHANNEL_KEYS)[number]

/**
 * Channels the preview endpoint can bind to a column. `facet` is excluded: it
 * has no `$facet` data slot, so a preview binding for it would never reach the
 * renderer.
 */
export const PREVIEW_CHANNELS = ['x', 'color', 'size', 'z', 'error', 'source', 'target'] as const
export type PreviewChannelKey = (typeof PREVIEW_CHANNELS)[number]

export const CHANNEL_TYPES: readonly CustomFieldType[] = [
  'quantitative',
  'nominal',
  'temporal',
]

export const Y_MODES: readonly CustomYFieldsMode[] = ['none', 'one', 'range', 'multi']

/** How many Y bindings each mode consumes (`multi` tops out at `$y4`). */
export const Y_MODE_SLOTS: Record<CustomYFieldsMode, number> = {
  none: 0,
  one: 1,
  range: 2,
  multi: 5,
}

export const TRANSFORM_OPS = [
  'dropna',
  'sort',
  'limit',
  'group_agg',
  'cumulate',
  'reduce',
] as const
export type TransformOp = (typeof TRANSFORM_OPS)[number]

/** Mirrors `TRACE_TYPES` in `backend/core/custom_charts.py`. */
export const TRACE_TYPES = [
  'scatter',
  'bar',
  'box',
  'violin',
  'waterfall',
  'funnel',
  'indicator',
  'histogram',
  'sankey',
] as const

/** Trace types that accept `splitBy` (the workbench shows this as a hint). */
export const SPLIT_BY_TRACE_TYPES: readonly string[] = [
  'scatter',
  'bar',
  'box',
  'violin',
  'histogram',
  'funnel',
]

export const AGGREGATES = ['sum', 'mean', 'count', 'min', 'max'] as const

export const OPTION_TYPES = ['number', 'text', 'boolean', 'select'] as const

/** Matches the backend's own id rule (`_ID_RE` in custom_charts.py). */
export const CUSTOM_CHART_ID_RE = /^[a-z][a-z0-9_-]{1,39}$/

/**
 * Manifest id sent with preview requests when the form has none yet. The
 * preview endpoint validates the id but never persists it, so a new/duplicated
 * chart can be previewed before the user names it. Saving always uses the real
 * id (see `previewManifestFor`).
 */
export const PREVIEW_PLACEHOLDER_ID = 'custom-preview'

/**
 * Field error for a comma-separated editor whose source list contains an item
 * with a comma: splitting it would silently rewrite the manifest.
 */
export const COMMA_LIST_ERROR =
  'contains an item with a comma; split it into separate entries or remove the comma'

/** Suffix the "另存为副本" action suggests for the copied manifest id. */
const COPY_SUFFIX = '-copy'
const MAX_ID_LENGTH = 40

export interface LocaleForm {
  zh: string
  en: string
}

export interface ChannelForm {
  /** Declared channel in the manifest; `false` drops the key entirely. */
  enabled: boolean
  required: boolean
  /** Empty = any type is accepted (the manifest omits `types`). */
  types: CustomFieldType[]
}

export interface TransformForm {
  op: TransformOp
  /** `dropna`: comma separated bare slot names. */
  slots: string
  /** `sort`: bare slot name. */
  by: string
  descending: boolean
  /** `limit`: kept as text so an in-progress edit does not blank the field. */
  count: string
  from: 'top' | 'bottom'
  /** `group_agg`: one or two comma separated bare slot names. */
  groupBy: string
  /** `group_agg` / `cumulate` / `reduce`: bare source slot. */
  field: string
  agg: string
  /** Output alias — becomes the `$<as>` slot. */
  as: string
}

export interface TraceForm {
  type: string
  /** Everything except `type`, edited as JSON text; `''` means "no extra keys". */
  json: string
}

export interface OptionForm {
  key: string
  type: CustomChartOption['type']
  /** Edited as text and parsed by `type`; round-trips numbers and booleans. */
  default: string
  labelZh: string
  labelEn: string
  /** Comma separated; only emitted for `select` options. */
  choices: string
}

/**
 * A list loaded from the manifest whose item itself contains a comma. The
 * joined text in the form is ambiguous, so `formToManifest` reports the field
 * as long as the text still equals `joined`; editing the field resolves it.
 */
export interface CommaAmbiguity {
  joined: string
}

export interface ManifestForm {
  id: string
  label: LocaleForm
  description: LocaleForm
  keywords: string
  channels: Record<ChannelKey, ChannelForm>
  yMode: CustomYFieldsMode
  /**
   * Manifest-level `facetBy`; schema v1 only accepts `"$color"` (or nothing).
   * Not part of the channel list but kept so editing an example that uses it
   * cannot silently drop it.
   */
  facetBy: '' | '$color'
  transforms: TransformForm[]
  traces: TraceForm[]
  layout: string
  options: OptionForm[]
  /** Path (`keywords`, `options[0].choices`) -> unresolvable comma list. */
  commaAmbiguities?: Record<string, CommaAmbiguity>
}

/** Paths are manifest paths (`traces[0].json`, `layout`, `options[2].default`). */
export type ManifestFormErrors = Record<string, string>

export interface ManifestFormResult {
  manifest: CustomChartManifest
  errors: ManifestFormErrors
}

export type ValidationSection =
  | 'channels'
  | 'transforms'
  | 'traces'
  | 'layout'
  | 'options'
  | 'manifest'

export interface ParsedValidationError {
  /** Manifest path the backend blamed; `''` for a whole-manifest problem. */
  path: string
  message: string
  section: ValidationSection
}

export interface PreviewBindings {
  /** Channel key -> bound column name; unbound/blank channels are skipped. */
  fields: Partial<Record<PreviewChannelKey, string>>
  /** Bound Y columns in order; the mode decides how many reach the encoding. */
  yFields: string[]
}

// ---------------------------------------------------------------------------
// id helpers
// ---------------------------------------------------------------------------

/** Client-side mirror of the backend rule, so a typo fails before a round trip. */
export function isValidCustomChartId(id: string): boolean {
  return CUSTOM_CHART_ID_RE.test(id.trim())
}

/** Suggested id for "另存为副本": `<id>-copy`, kept inside the 40-char cap. */
export function duplicateChartId(id: string): string {
  const base = id.trim()
  if (base === '') return ''
  if (base.length + COPY_SUFFIX.length <= MAX_ID_LENGTH) return `${base}${COPY_SUFFIX}`
  const head = base.slice(0, MAX_ID_LENGTH - COPY_SUFFIX.length).replace(/[-_]+$/, '')
  return `${head}${COPY_SUFFIX}`
}

// ---------------------------------------------------------------------------
// skeleton
// ---------------------------------------------------------------------------

function emptyChannel(): ChannelForm {
  return { enabled: false, required: true, types: [] }
}

/**
 * Blank authoring session: the smallest shape the backend accepts once the
 * user fills in id + labels — an `x` channel, `yFields.mode: "one"` and one
 * scatter trace wired to `$x` / `$y0`.
 */
export function emptyManifest(): ManifestForm {
  const channels = {} as Record<ChannelKey, ChannelForm>
  for (const key of CHANNEL_KEYS) channels[key] = emptyChannel()
  channels.x = { enabled: true, required: true, types: ['nominal'] }
  return {
    id: '',
    label: { zh: '', en: '' },
    description: { zh: '', en: '' },
    keywords: '',
    channels,
    yMode: 'one',
    facetBy: '',
    transforms: [],
    traces: [{ type: 'scatter', json: JSON.stringify({ x: '$x', y: '$y0' }, null, 2) }],
    layout: '',
    options: [],
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function splitList(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

function stringItems(values: unknown): string[] {
  return Array.isArray(values) ? values.filter((v): v is string => typeof v === 'string') : []
}

function joinList(values: unknown): string {
  return stringItems(values).join(', ')
}

/**
 * Remember lists the comma-separated editor cannot represent losslessly, so
 * `formToManifest` can flag them instead of silently splitting an item in two.
 */
function noteCommaAmbiguity(
  values: unknown,
  path: string,
  joined: string,
  out: Record<string, CommaAmbiguity>,
): void {
  if (stringItems(values).some((item) => item.includes(','))) out[path] = { joined }
}

/** Current text of a comma-separated field, by manifest path. */
function commaFieldText(form: ManifestForm, path: string): string | undefined {
  if (path === 'keywords') return form.keywords
  const match = /^options\[(\d+)\]\.choices$/.exec(path)
  if (!match) return undefined
  return form.options[Number(match[1])]?.choices
}

function isTransformOp(value: unknown): value is TransformOp {
  return typeof value === 'string' && (TRANSFORM_OPS as readonly string[]).includes(value)
}

function isChannelType(value: unknown): value is CustomFieldType {
  return typeof value === 'string' && (CHANNEL_TYPES as readonly string[]).includes(value)
}

function isYMode(value: unknown): value is CustomYFieldsMode {
  return typeof value === 'string' && (Y_MODES as readonly string[]).includes(value)
}

function isOptionType(value: unknown): value is CustomChartOption['type'] {
  return typeof value === 'string' && (OPTION_TYPES as readonly string[]).includes(value)
}

/**
 * Parse one JSON textarea. A syntax error (or a non-object document) becomes a
 * field-level error keyed by `path`; the caller keeps a `{}` so the rest of the
 * form still renders and saves.
 */
function parseJsonObject(
  text: string,
  path: string,
  errors: ManifestFormErrors,
): Record<string, unknown> {
  const trimmed = text.trim()
  if (trimmed === '') return {}
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed)) {
      errors[path] = 'must be a JSON object'
      return {}
    }
    return parsed
  } catch (err) {
    errors[path] = err instanceof Error ? err.message : String(err)
    return {}
  }
}

function defaultToText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

// ---------------------------------------------------------------------------
// manifest -> form
// ---------------------------------------------------------------------------

function transformToForm(raw: Record<string, unknown>): TransformForm {
  return {
    // Manifests came through backend validation, so the op is always known;
    // an unknown one still opens as `dropna` instead of breaking the form.
    op: isTransformOp(raw.op) ? raw.op : 'dropna',
    slots: joinList(raw.slots),
    by: typeof raw.by === 'string' ? raw.by : '',
    descending: raw.descending === true,
    count: typeof raw.count === 'number' || typeof raw.count === 'string' ? String(raw.count) : '',
    from: raw.from === 'bottom' ? 'bottom' : 'top',
    groupBy: Array.isArray(raw.groupBy)
      ? joinList(raw.groupBy)
      : typeof raw.groupBy === 'string'
        ? raw.groupBy
        : '',
    field: typeof raw.field === 'string' ? raw.field : '',
    agg: typeof raw.agg === 'string' ? raw.agg : 'sum',
    as: typeof raw.as === 'string' ? raw.as : '',
  }
}

function traceToForm(raw: Record<string, unknown>): TraceForm {
  const { type: rawType, ...rest } = raw
  return {
    type: typeof rawType === 'string' ? rawType : 'scatter',
    json: Object.keys(rest).length > 0 ? JSON.stringify(rest, null, 2) : '',
  }
}

function optionToForm(raw: Record<string, unknown>): OptionForm {
  const label = isRecord(raw.label) ? raw.label : {}
  return {
    key: typeof raw.key === 'string' ? raw.key : '',
    type: isOptionType(raw.type) ? raw.type : 'text',
    default: defaultToText(raw.default),
    labelZh: typeof label.zh === 'string' ? label.zh : '',
    labelEn: typeof label.en === 'string' ? label.en : '',
    choices: joinList(raw.choices),
  }
}

/** Read a manifest into the editable form, tolerating a partial draft. */
export function manifestToForm(manifest: CustomChartManifest | null | undefined): ManifestForm {
  const source: Record<string, unknown> = isRecord(manifest) ? manifest : {}
  const channelsRaw: Record<string, unknown> = isRecord(source.channels) ? source.channels : {}
  const channels = {} as Record<ChannelKey, ChannelForm>
  for (const key of CHANNEL_KEYS) {
    const rule = channelsRaw[key]
    if (isRecord(rule)) {
      channels[key] = {
        enabled: true,
        // `required` defaults to true in the schema, so an absent key means true.
        required: rule.required !== false,
        types: Array.isArray(rule.types) ? rule.types.filter(isChannelType) : [],
      }
    } else {
      channels[key] = emptyChannel()
    }
  }

  const label = isRecord(source.label) ? source.label : {}
  const description = isRecord(source.description) ? source.description : {}
  const yFields = isRecord(channelsRaw.yFields) ? channelsRaw.yFields : {}
  const layout = isRecord(source.layout) ? source.layout : {}
  const transforms = Array.isArray(source.transforms) ? source.transforms : []
  const traces = Array.isArray(source.traces) ? source.traces : []
  const options = Array.isArray(source.options) ? source.options : []

  const commaAmbiguities: Record<string, CommaAmbiguity> = {}
  const keywords = joinList(source.keywords)
  noteCommaAmbiguity(source.keywords, 'keywords', keywords, commaAmbiguities)
  const formOptions = options.filter(isRecord).map((option, index) => {
    const formOption = optionToForm(option)
    noteCommaAmbiguity(
      option.choices,
      `options[${index}].choices`,
      formOption.choices,
      commaAmbiguities,
    )
    return formOption
  })

  return {
    id: typeof source.id === 'string' ? source.id : '',
    label: {
      zh: typeof label.zh === 'string' ? label.zh : '',
      en: typeof label.en === 'string' ? label.en : '',
    },
    description: {
      zh: typeof description.zh === 'string' ? description.zh : '',
      en: typeof description.en === 'string' ? description.en : '',
    },
    keywords,
    channels,
    yMode: isYMode(yFields.mode) ? yFields.mode : 'none',
    facetBy: source.facetBy === '$color' ? '$color' : '',
    transforms: transforms.filter(isRecord).map(transformToForm),
    traces: traces.filter(isRecord).map(traceToForm),
    layout: Object.keys(layout).length > 0 ? JSON.stringify(layout, null, 2) : '',
    options: formOptions,
    commaAmbiguities:
      Object.keys(commaAmbiguities).length > 0 ? commaAmbiguities : undefined,
  }
}

// ---------------------------------------------------------------------------
// form -> manifest
// ---------------------------------------------------------------------------

function transformFromForm(
  form: TransformForm,
  index: number,
  errors: ManifestFormErrors,
): { op: string; [key: string]: unknown } {
  const path = `transforms[${index}]`
  switch (form.op) {
    case 'dropna':
      return { op: 'dropna', slots: splitList(form.slots) }
    case 'sort': {
      const step: { op: string; [key: string]: unknown } = { op: 'sort', by: form.by.trim() }
      // `descending: false` is the schema default — leaving it out keeps the
      // manifest identical to one the backend normalized.
      if (form.descending) step.descending = true
      return step
    }
    case 'limit': {
      const raw = form.count.trim()
      const count = raw === '' ? Number.NaN : Number(raw)
      if (!Number.isFinite(count)) errors[`${path}.count`] = 'must be a number'
      const step: { op: string; [key: string]: unknown } = {
        op: 'limit',
        count: Number.isFinite(count) ? count : raw,
      }
      if (form.from === 'bottom') step.from = 'bottom'
      return step
    }
    case 'group_agg': {
      const groupBy = splitList(form.groupBy)
      return {
        op: 'group_agg',
        // The schema takes a single slot or a 1–2 slot array; one slot is the
        // scalar form so the manifest stays as compact as the examples.
        groupBy: groupBy.length === 1 ? groupBy[0] : groupBy,
        field: form.field.trim(),
        agg: form.agg,
        as: form.as.trim(),
      }
    }
    case 'cumulate':
      return { op: 'cumulate', field: form.field.trim(), as: form.as.trim() }
    case 'reduce':
      return {
        op: 'reduce',
        field: form.field.trim(),
        agg: form.agg,
        as: form.as.trim(),
      }
    default:
      // Unreachable for a well-typed form; keeps the switch exhaustive if a new
      // op ever ships in the schema.
      return { op: form.op }
  }
}

function optionFromForm(
  form: OptionForm,
  index: number,
  errors: ManifestFormErrors,
): CustomChartOption {
  const path = `options[${index}]`
  const raw = form.default
  let value: unknown = raw
  if (form.type === 'number') {
    const num = raw.trim() === '' ? Number.NaN : Number(raw)
    if (!Number.isFinite(num)) errors[`${path}.default`] = 'must be a finite number'
    value = Number.isFinite(num) ? num : raw
  } else if (form.type === 'boolean') {
    value = raw === 'true'
  }
  const option: Record<string, unknown> = {
    key: form.key.trim(),
    type: form.type,
    default: value,
    label: { zh: form.labelZh, en: form.labelEn },
  }
  const choices = splitList(form.choices)
  // The schema rejects `choices` on non-select options, so it is only emitted
  // where it belongs.
  if (form.type === 'select' && choices.length > 0) option.choices = choices
  return option as unknown as CustomChartOption
}

/**
 * Build the manifest the workbench previews and saves.
 *
 * Disabled channels are dropped (a disabled channel must be absent, not
 * `false`), and optional arrays/objects left empty are omitted so the saved
 * JSON stays as small as the hand-written examples. `errors` reports the JSON
 * textareas that did not parse and the numeric fields that are not numbers;
 * everything else is the backend's call.
 */
export function formToManifest(form: ManifestForm): ManifestFormResult {
  const errors: ManifestFormErrors = {}

  const channels: CustomChartChannels = {}
  for (const key of CHANNEL_KEYS) {
    const channel = form.channels[key]
    if (!channel.enabled) continue
    const rule: CustomChannelRule = { required: channel.required }
    if (channel.types.length > 0) rule.types = [...channel.types]
    channels[key] = rule
  }
  channels.yFields = { mode: form.yMode }

  const traces = form.traces.map((trace, index) => ({
    type: trace.type,
    ...parseJsonObject(trace.json, `traces[${index}].json`, errors),
  }))

  const manifest: CustomChartManifest = {
    schemaVersion: 1,
    id: form.id.trim(),
    label: { zh: form.label.zh, en: form.label.en },
    channels,
    traces,
  }

  const description = { zh: form.description.zh, en: form.description.en }
  if (description.zh.trim() !== '' || description.en.trim() !== '') {
    manifest.description = description
  }

  const keywords = splitList(form.keywords)
  if (keywords.length > 0) manifest.keywords = keywords

  if (form.facetBy === '$color') manifest.facetBy = '$color'

  if (form.transforms.length > 0) {
    manifest.transforms = form.transforms.map((transform, index) =>
      transformFromForm(transform, index, errors),
    )
  }

  const layout = parseJsonObject(form.layout, 'layout', errors)
  if (Object.keys(layout).length > 0) manifest.layout = layout

  if (form.options.length > 0) {
    manifest.options = form.options.map((option, index) =>
      optionFromForm(option, index, errors),
    )
  }

  // Lists the comma editor cannot represent: flagged (and therefore blocking
  // save/export) until the user rewrites that field unambiguously.
  for (const [path, entry] of Object.entries(form.commaAmbiguities ?? {})) {
    if (commaFieldText(form, path) === entry.joined) errors[path] = COMMA_LIST_ERROR
  }

  return { manifest, errors }
}

// ---------------------------------------------------------------------------
// backend error text
// ---------------------------------------------------------------------------

/**
 * Which form section a manifest path belongs to (drives the error dot).
 *
 * `message` matters for the backend's path-less facet complaints: they arrive
 * as `manifest: 'facetBy' …` but `facetBy` is edited in the channels section.
 */
export function sectionForPath(path: string, message = ''): ValidationSection {
  if (path === 'channels' || path.startsWith('channels.')) return 'channels'
  if (path === 'facetBy') return 'channels'
  if (path === 'manifest' && /facetBy|facet channel/i.test(message)) return 'channels'
  if (path === 'transforms' || path.startsWith('transforms[')) return 'transforms'
  if (path === 'traces' || path.startsWith('traces[')) return 'traces'
  if (path === 'layout' || path.startsWith('layout.')) return 'layout'
  if (path === 'options' || path.startsWith('options[')) return 'options'
  return 'manifest'
}

/**
 * A fragment that starts a new backend error rather than continuing the
 * previous message. Several backend messages embed `"; "` themselves (e.g.
 * `… after transforms (got 3); add a 'reduce' transform` or the style-key
 * whitelist), so splitting the joined detail blindly would invent phantom
 * path-less errors.
 */
const ERROR_PATH_START =
  /^(?:channels[.:]|transforms(?:\[|:)|traces(?:\[|:)|layout[.:]|options(?:\[|:)|manifest:|label[.:]|description[.:]|schemaVersion[.:]|facetBy[.:]|id[ .:]|keywords?(?:\[|:))/i

/** Split the `"; "`-joined detail, re-joining continuations of one message. */
function splitJoinedDetail(detail: string): string[] {
  const lines: string[] = []
  for (const fragment of detail.split('; ')) {
    if (lines.length === 0 || ERROR_PATH_START.test(fragment.trimStart())) lines.push(fragment)
    else lines[lines.length - 1] += `; ${fragment}`
  }
  return lines
}

/**
 * Split the backend's `"; "`-joined validation detail into one entry per
 * problem, each tagged with the form section its path points at.
 *
 * Every backend message has the shape `"<path>: <message>"`, except the few
 * whole-manifest failures (`"manifest must be a JSON object"`), which become
 * `{ path: '', section: 'manifest' }`. A `"; "` inside a message is kept as
 * part of that message (see `ERROR_PATH_START`).
 */
export function parseValidationErrors(detail: string): ParsedValidationError[] {
  if (typeof detail !== 'string') return []
  const lines: ParsedValidationError[] = []
  for (const chunk of splitJoinedDetail(detail)) {
    const line = chunk.trim()
    if (line === '') continue
    const separator = line.indexOf(': ')
    const path = separator >= 0 ? line.slice(0, separator).trim() : ''
    const message = separator >= 0 ? line.slice(separator + 2).trim() : line
    lines.push({ path, message, section: sectionForPath(path, message) })
  }
  return lines
}

// ---------------------------------------------------------------------------
// preview encoding
// ---------------------------------------------------------------------------

/**
 * The `ChartEncoding` a preview request binds to the dataset.
 *
 * Only channels that are both declared and bound make it into the encoding
 * (the manifest drops disabled channels, so binding one would render nothing);
 * the Y field count follows `yFields.mode` — 0 / 1 / 2 / up to 5.
 */
export function previewEncodingFor(
  form: ManifestForm,
  bindings: PreviewBindings,
  columnTypes: Record<string, CustomFieldType> = {},
): ChartEncoding {
  const chartType = form.id.trim() === '' ? 'custom' : form.id.trim()
  const encoding: ChartEncoding = { chartType, yFields: [] }

  for (const key of PREVIEW_CHANNELS) {
    const field = bindings.fields[key]
    if (!form.channels[key].enabled || !field) continue
    encoding[key] = { field, type: (columnTypes[field] ?? 'nominal') as FieldType }
  }

  const limit = Y_MODE_SLOTS[form.yMode]
  encoding.yFields = bindings.yFields
    .slice(0, limit)
    .filter((field) => field !== '')
    .map((field) => ({
      field,
      type: (columnTypes[field] ?? 'nominal') as FieldType,
      axis: 'left' as const,
      normalize: 'none' as const,
    }))

  return encoding
}

/**
 * Manifest as sent to the preview endpoint.
 *
 * The endpoint validates the manifest — including the id — but never persists
 * it, so a brand-new or duplicated session (blank id) previews under
 * `PREVIEW_PLACEHOLDER_ID` instead of failing with `id: must match …`. Saving
 * keeps using the real id: `previewManifestFor` is only ever called on the way
 * to `/custom/preview`, never on the way to `/custom`.
 */
export function previewManifestFor(manifest: CustomChartManifest): CustomChartManifest {
  if (manifest.id.trim() !== '') return manifest
  return { ...manifest, id: PREVIEW_PLACEHOLDER_ID }
}

// ---------------------------------------------------------------------------
// preview binding seeding
// ---------------------------------------------------------------------------

/**
 * Column type a channel prefers when the manifest does not restrict `types`.
 * `x` is handled separately (it is a dimension by default) and `facet` has no
 * preview slot yet; it is listed so the map stays total over the channels.
 */
const DEFAULT_CHANNEL_TYPE: Partial<Record<ChannelKey, CustomFieldType>> = {
  color: 'nominal',
  facet: 'nominal',
  source: 'nominal',
  target: 'nominal',
  size: 'quantitative',
  z: 'quantitative',
  error: 'quantitative',
}

/** Types that read as a dimension — what an unconstrained `x` looks for first. */
const DIMENSION_TYPES: readonly CustomFieldType[] = ['nominal', 'temporal']

type ColumnLike = { name: string; inferredType: string }

/** First unused column the predicate accepts, in dataset order. */
function firstFreeColumn(
  columns: ColumnLike[],
  used: Set<string>,
  accepts: (type: CustomFieldType) => boolean,
): string | undefined {
  for (const column of columns) {
    if (used.has(column.name)) continue
    if (!accepts(column.inferredType as CustomFieldType)) continue
    used.add(column.name)
    return column.name
  }
  return undefined
}

/**
 * Column for one single-value channel. A declared `types` list is binding: a
 * column outside it would fail the chart's own validation, so the channel stays
 * blank instead. Without one, the channel's usual type wins — a `color` bound
 * to a date or a `y` slot bound to a category renders a meaningless figure.
 */
function pickChannelColumn(
  key: PreviewChannelKey,
  declared: readonly CustomFieldType[],
  columns: ColumnLike[],
  used: Set<string>,
): string | undefined {
  if (declared.length > 0) {
    return firstFreeColumn(columns, used, (type) => declared.includes(type))
  }
  if (key === 'x') {
    // Usually a dimension; a free measure still beats leaving `x` empty.
    return (
      firstFreeColumn(columns, used, (type) => DIMENSION_TYPES.includes(type)) ??
      firstFreeColumn(columns, used, () => true)
    )
  }
  const wanted = DEFAULT_CHANNEL_TYPE[key]
  return firstFreeColumn(columns, used, (type) => wanted === undefined || type === wanted)
}

/** Aggregate columns are the only ones that make a plottable `y` slot. */
function pickYColumn(columns: ColumnLike[], used: Set<string>): string | undefined {
  return firstFreeColumn(columns, used, (type) => type === 'quantitative')
}

/**
 * Fill blank channel bindings and Y slots from the dataset columns.
 *
 * A channel key that is already present — even with an empty string, which is
 * how the clear button writes it — is an explicit choice and is left alone.
 * Channels are seeded before the Y slots, so a declared `color`/`size` claims
 * its column first; anything left unfilled stays blank rather than being
 * padded with a column of the wrong type.
 */
function fillPreviewBindings(
  form: ManifestForm,
  bindings: PreviewBindings,
  columns: ColumnLike[],
  fillEmptyYSlots: boolean,
): PreviewBindings {
  const limit = Y_MODE_SLOTS[form.yMode]
  const fields: Partial<Record<PreviewChannelKey, string>> = { ...bindings.fields }
  const yFields = bindings.yFields.slice(0, limit)
  if (fillEmptyYSlots) {
    while (yFields.length < limit) yFields.push('')
  }

  const used = new Set<string>([
    ...Object.values(fields).filter(
      (field): field is string => typeof field === 'string' && field !== '',
    ),
    ...yFields.filter((field) => field !== ''),
  ])

  for (const key of PREVIEW_CHANNELS) {
    if (!form.channels[key].enabled) continue
    // Present = chosen (possibly deliberately cleared), absent = never touched.
    if (key in fields) continue
    const seeded = pickChannelColumn(key, form.channels[key].types, columns, used)
    if (seeded !== undefined) fields[key] = seeded
  }

  if (fillEmptyYSlots) {
    for (let index = 0; index < yFields.length; index += 1) {
      if (yFields[index] !== '') continue
      const seeded = pickYColumn(columns, used)
      if (seeded !== undefined) yFields[index] = seeded
    }
  } else {
    while (yFields.length < limit) {
      const seeded = pickYColumn(columns, used)
      if (seeded === undefined) break
      yFields.push(seeded)
    }
  }

  return { fields, yFields }
}

/**
 * Seed the preview bindings on first load: fill the declared channels and the
 * Y slots the mode asks for, leaving explicit clears alone. Channels only take
 * a column of a type they accept (declared `types`, else their usual type) and
 * Y slots only take a quantitative column — an unseeded slot stays blank and
 * the preview says so instead of drawing a stray series.
 */
export function seedPreviewBindings(
  form: ManifestForm,
  bindings: PreviewBindings,
  columns: { name: string; inferredType: string }[],
): PreviewBindings {
  return fillPreviewBindings(form, bindings, columns, false)
}

/**
 * Re-seed after a structural change (declared channels or `yFields.mode`).
 *
 * A binding survives only if its channel is still declared and its column still
 * exists in the dataset; a name the new manifest/dataset cannot use is stale
 * and would otherwise render an empty scaffold. Y slots past the mode's arity
 * are dropped, and every hole is re-filled from the free columns of a type that
 * channel accepts — an existing (if oddly typed) choice is never overwritten.
 */
export function reseedPreviewBindings(
  form: ManifestForm,
  bindings: PreviewBindings,
  columns: { name: string; inferredType: string }[],
): PreviewBindings {
  const known = new Set(columns.map((column) => column.name))
  // Unknown while the column list is still loading (keep) vs. a name this
  // dataset no longer has (stale: drop and re-seed).
  const isStaleName = (field: string) =>
    field !== '' && known.size > 0 && !known.has(field)

  const fields: Partial<Record<PreviewChannelKey, string>> = {}
  for (const key of PREVIEW_CHANNELS) {
    if (!form.channels[key].enabled) continue
    const field = bindings.fields[key]
    if (field === undefined) continue
    if (isStaleName(field)) continue
    fields[key] = field
  }

  const limit = Y_MODE_SLOTS[form.yMode]
  const yFields = bindings.yFields
    .slice(0, limit)
    .map((field) => (isStaleName(field) ? '' : field))

  return fillPreviewBindings(form, { fields, yFields }, columns, true)
}
