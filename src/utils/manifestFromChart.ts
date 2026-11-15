import type { ChartConfig, ChartEncoding, EncodingChannel, YFieldConfig } from '@/types/encoding'
import type {
  CustomChannelRule,
  CustomChartChannels,
  CustomChartManifest,
  CustomYFieldsMode,
} from '@/types/customChart'

/**
 * Reverse entry for declarative charts: turn a built-in `ChartConfig` into the
 * `CustomChartManifest` the backend accepts (`backend/core/custom_charts.py`),
 * so "I like this chart, let me tweak it as a manifest" is one click.
 *
 * The conversion is deliberately conservative. A manifest that the backend
 * would reject (or would render something structurally different) is never
 * produced: either the chart is expressible — then the result validates — or it
 * is not, and the caller gets a `reason` to show inline. Fidelity losses that
 * the schema *cannot* express (multi-Y, facet grids, style options) are
 * reported through `warnings` instead of being silently dropped.
 *
 * A refusal is *data*, never prose: the caller renders
 * `chart.custom.reason.<code>` with `params`, so no untranslated English
 * sentence can reach a Chinese UI.
 *
 * Everything here is pure and synchronous; no store, no network.
 */

/** Why a chart cannot become a manifest; one `chart.custom.reason.<code>` key each. */
export type ChartRefusalCode =
  | 'unsupportedType'
  | 'noYField'
  | 'noValueField'
  | 'missingLinks'

export interface ChartRefusal {
  code: ChartRefusalCode
  /** Values interpolated into the localized message (`{{type}}` today). */
  params?: Record<string, string>
}

export type ManifestFromChartResult =
  | { manifest: CustomChartManifest; warnings: string[] }
  | { reason: ChartRefusal }

/** One allowlisted transform step (`TRANSFORM_KEYS` in the backend). */
type TransformStep = { op: string; [key: string]: unknown }

/** One trace template (`TRACE_TYPES` / `STYLE_KEYS` / `DATA_KEYS`). */
type TraceSpec = { type: string; [key: string]: unknown }

/**
 * Manifest layout keys the backend allows (`LAYOUT_KEYS`). Everything else in
 * the built-in layout (`autosize`, `paper_bgcolor`, `font`, …) is renderer
 * chrome a manifest cannot own, so it is dropped with a warning.
 */
const LAYOUT_KEYS: readonly string[] = [
  'showlegend',
  'barmode',
  'margin',
  'xaxis',
  'yaxis',
  'legend',
  'hovermode',
  'polar',
  'title',
]

/**
 * Encodable channels, in the panel's canonical order (`CHANNEL_KEYS`).
 *
 * `facet` is missing on purpose. Binding it is no longer the problem — the
 * workbench seeds a picker for it (`PREVIEW_CHANNELS` in manifestForm.ts) — but
 * the conversion cannot reproduce a built-in chart's grid: the builder draws it
 * from `encoding.facet` plus a layout whose cells, linked axes and per-cell
 * styling a manifest cannot set (the renderer owns `layout["grid"]`), while
 * `channelRule` can only carry the column, as a new `required: true` channel.
 * Half-carrying it would hand back a manifest that claims to be this chart and
 * renders something else, so the grid is reported as a fidelity loss
 * (`FACET_DROPPED`) instead.
 */
const CHANNEL_KEYS = ['x', 'color', 'size', 'z', 'error', 'source', 'target'] as const
type ChannelKey = (typeof CHANNEL_KEYS)[number]

/** Types converted to a single scatter/bar trace. */
const SCATTER_FAMILY = new Set(['line', 'area', 'step', 'dot', 'scatter', 'bar', 'barh'])

/** Types the built-in builder decorates with `error_y`. */
const ERROR_TYPES = new Set(['line', 'area', 'step', 'scatter', 'bar'])

/** Types whose built-in form emits one series per colour value. */
const SPLIT_TYPES = new Set(['line', 'area', 'step', 'dot', 'scatter', 'bar', 'barh', 'box', 'violin'])

/**
 * Types whose built-in form never aggregates its Y field (a histogram bins raw
 * values, a box/violin plots the raw distribution), so an `aggregate` left in
 * the encoding is ignored there exactly like the built-in path ignores it.
 */
const RAW_ONLY_TYPES = new Set(['histogram', 'box', 'violin'])

/** Every built-in type with a declarative equivalent (the reverse of `SCATTER_FAMILY` etc.). */
const CONVERTIBLE_TYPES = new Set([
  ...SCATTER_FAMILY,
  'histogram',
  'box',
  'violin',
  'waterfall',
  'funnel',
  'timeline',
  'gauge',
  'sankey',
])

const ID_PREFIX = 'custom-'
const MAX_ID_LENGTH = 40
/** `custom-chart`: the id of last resort when a name has no latin characters. */
const FALLBACK_ID = 'custom-chart'
/** `label`/`description` caps in `custom_charts.py` (`_localized`). */
const MAX_LABEL_LENGTH = 60

const FACET_DROPPED =
  'The facet grid is not carried over: a custom chart can only facet by colour (`facetBy`).'
const MULTI_AGG_DROPPED =
  'Aggregating more than one Y field is not expressible in a manifest; raw values are used instead.'
const AGG_NO_X_DROPPED =
  'An aggregate needs an x channel to group by; raw values are used instead.'
const SIZE_DROPPED =
  'Aggregation drops the size column, so marker sizes are not carried over.'
const ERROR_DROPPED =
  'Aggregation drops the error column, so error bars are not carried over.'

// ---------------------------------------------------------------------------
// ids and labels
// ---------------------------------------------------------------------------

/**
 * `custom-` + a slug of the chart name: lowercased, accent-folded, `[a-z0-9-]`
 * only, at most 40 characters. The prefix is what guarantees the id can never
 * collide with a built-in chart type (they are all shorter, unprefixed ids).
 */
export function manifestIdFor(name: string): string {
  const slug = name
    .normalize('NFD')
    // Strip combining accents so "Ünïcode" still yields something readable.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const head = slug
    .slice(0, MAX_ID_LENGTH - ID_PREFIX.length)
    // A cut can land on a separator; an id may not end with one.
    .replace(/-+$/g, '')
  return head === '' ? FALLBACK_ID : `${ID_PREFIX}${head}`
}

function clampLabel(name: string, warnings: string[]): string {
  if (name.length <= MAX_LABEL_LENGTH) return name
  warnings.push(
    `The chart name is longer than ${MAX_LABEL_LENGTH} characters; the manifest label is truncated.`,
  )
  return name.slice(0, MAX_LABEL_LENGTH)
}

// ---------------------------------------------------------------------------
// channels
// ---------------------------------------------------------------------------

function channelRule(channel: EncodingChannel): CustomChannelRule {
  return { required: true, types: [channel.type] }
}

/** `yFields.mode` from the number of bound Y fields. */
export function yFieldsModeFor(count: number): CustomYFieldsMode {
  if (count <= 0) return 'none'
  if (count === 1) return 'one'
  if (count === 2) return 'range'
  return 'multi'
}

// ---------------------------------------------------------------------------
// traces
// ---------------------------------------------------------------------------

interface PlannedTraces {
  transforms: TransformStep[]
  traces: TraceSpec[]
}

function unsupportedReason(chartType: string): ChartRefusal {
  return { code: 'unsupportedType', params: { type: chartType } }
}

/**
 * Trace templates (plus the transforms they need) for one encoding.
 *
 * The slot a trace plots on Y is `$y0` for raw rows and `$v0` once a
 * `group_agg` has rebuilt the frame around one group key, so the two are
 * computed together.
 */
function planTraces(
  encoding: ChartEncoding,
  primaryY: YFieldConfig | undefined,
  warnings: string[],
): PlannedTraces | { reason: ChartRefusal } {
  const chartType = encoding.chartType
  const hasSource = Boolean(encoding.source?.field)
  const hasTarget = Boolean(encoding.target?.field)

  // Gauge: collapse the frame to one value, then read it from the alias.
  if (chartType === 'gauge') {
    if (!primaryY) return { reason: { code: 'noValueField' } }
    return {
      transforms: [
        { op: 'reduce', field: 'y0', agg: primaryY.aggregate ?? 'sum', as: 'total' },
      ],
      traces: [{ type: 'indicator', mode: 'gauge+number', value: '$total' }],
    }
  }

  // Sankey: the links are the totals per (source, target) pair, exactly like
  // the built-in builder, so the multi-key aggregate is unconditional.
  if (chartType === 'sankey') {
    if (!primaryY) return { reason: { code: 'noValueField' } }
    if (!hasSource || !hasTarget) return { reason: { code: 'missingLinks' } }
    return {
      transforms: [
        {
          op: 'group_agg',
          groupBy: ['source', 'target'],
          field: 'y0',
          agg: primaryY.aggregate ?? 'sum',
          as: 'total',
        },
      ],
      traces: [{ type: 'sankey', source: '$source', target: '$target', values: '$total' }],
    }
  }

  // Every remaining type plots `$y0`; only a histogram may bin `x` instead.
  if (chartType !== 'histogram' && !primaryY) {
    return { reason: { code: 'noYField' } }
  }

  // ---- group_agg for a single aggregated Y field -------------------------
  // One aggregated field is expressible (the op rebuilds the frame around one
  // group key); several are not. Colour survives only when it is part of the
  // group key, which is also what makes `splitBy` legal afterwards.
  const aggregate = primaryY?.aggregate ?? null
  const aggregatedCount = encoding.yFields.filter((field) => field.aggregate).length
  let groupBy: string | string[] | null = null
  if (aggregate && !RAW_ONLY_TYPES.has(chartType)) {
    if (aggregatedCount > 1) warnings.push(MULTI_AGG_DROPPED)
    else if (!encoding.x?.field) warnings.push(AGG_NO_X_DROPPED)
    else groupBy = encoding.color?.field ? ['x', 'color'] : 'x'
  }
  const ySlot = groupBy ? '$v0' : '$y0'
  // Without an x channel the built-in builder plots row order, so the ordinal
  // slot stands in for it.
  const xSlot = encoding.x?.field ? '$x' : '$index'

  let trace: TraceSpec
  switch (chartType) {
    case 'line':
      trace = { type: 'scatter', mode: 'lines', x: xSlot, y: ySlot }
      break
    case 'area':
      trace = { type: 'scatter', mode: 'lines', x: xSlot, y: ySlot, fill: 'tozeroy' }
      break
    case 'step':
      trace = { type: 'scatter', mode: 'lines', x: xSlot, y: ySlot, line: { shape: 'hv' } }
      break
    case 'dot':
    case 'scatter':
      trace = { type: 'scatter', mode: 'markers', x: xSlot, y: ySlot }
      break
    case 'bar':
      trace = { type: 'bar', x: xSlot, y: ySlot }
      break
    case 'barh':
      // Plotly's `orientation: "h"` reads values from x and categories from y,
      // and the built-in builder swaps them for exactly that reason.
      trace = { type: 'bar', orientation: 'h', x: ySlot, y: xSlot }
      break
    case 'histogram':
      // The value column wins; a histogram with only an x binds that instead.
      if (primaryY) trace = { type: 'histogram', x: '$y0' }
      else if (encoding.x?.field) trace = { type: 'histogram', x: '$x' }
      else return { reason: { code: 'noValueField' } }
      break
    case 'box':
    case 'violin':
      trace = { type: chartType, y: '$y0' }
      break
    case 'waterfall':
      trace = { type: 'waterfall', x: xSlot, y: ySlot }
      break
    case 'funnel':
      // A vertical funnel puts stages on y and lengths on x (see the built-in
      // funnel builder), so the slots are swapped relative to a waterfall.
      trace = { type: 'funnel', x: ySlot, y: xSlot }
      break
    case 'timeline':
      trace = { type: 'scatter', mode: 'markers', x: xSlot, y: ySlot }
      break
    default:
      return { reason: unsupportedReason(chartType) }
  }

  const colorSet = Boolean(encoding.color?.field)
  if (colorSet && SPLIT_TYPES.has(chartType)) trace.splitBy = '$color'

  // Array style slots are only legal on the seven documented paths, and only
  // while the column they read survived the transform pipeline.
  if (chartType === 'scatter' && encoding.size?.field) {
    if (groupBy) warnings.push(SIZE_DROPPED)
    else trace.marker = { size: '$size.values' }
  }
  if (encoding.error?.field && ERROR_TYPES.has(chartType)) {
    if (groupBy) warnings.push(ERROR_DROPPED)
    else trace.error_y = { type: 'data', array: '$error.values', visible: true }
  }

  return {
    transforms: groupBy
      ? [{ op: 'group_agg', groupBy, field: 'y0', agg: aggregate, as: 'v0' }]
      : [],
    traces: [trace],
  }
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

/** Layout values come from the persisted chart, so a JSON copy is enough. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function convertLayout(
  layout: Record<string, unknown> | undefined,
  warnings: string[],
): Record<string, unknown> {
  const converted: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(layout ?? {})) {
    if (LAYOUT_KEYS.includes(key)) {
      converted[key] = cloneJson(value)
      continue
    }
    warnings.push(`Layout key "${key}" has no declarative equivalent and was dropped.`)
  }
  return converted
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

/**
 * Convert the active built-in chart into a manifest, or explain why it cannot
 * be converted. The manifest is always one the backend would accept: channels
 * only declare bindings the chart actually has, every trace slot it names is
 * declared (or produced by a transform), and only allowlisted layout keys
 * survive.
 */
export function manifestFromChart(chart: ChartConfig): ManifestFromChartResult {
  const encoding = chart.encoding
  const chartType = encoding.chartType
  const warnings: string[] = []

  if (!CONVERTIBLE_TYPES.has(chartType)) return { reason: unsupportedReason(chartType) }

  const yFields = encoding.yFields ?? []
  const primaryY = yFields[0]

  const channels: CustomChartChannels = {}
  for (const key of CHANNEL_KEYS) {
    const channel = encoding[key as ChannelKey]
    if (channel?.field) channels[key] = channelRule(channel)
  }
  channels.yFields = { mode: yFieldsModeFor(yFields.length) }
  if (encoding.facet?.field) warnings.push(FACET_DROPPED)

  const plan = planTraces(encoding, primaryY, warnings)
  if ('reason' in plan) return { reason: plan.reason }

  const name = chart.name?.trim() || chartType
  const label = clampLabel(name, warnings)

  const manifest: CustomChartManifest = {
    schemaVersion: 1,
    id: manifestIdFor(name),
    label: { zh: label, en: label },
    description: {
      zh: `由内置图表「${label}」转换`,
      en: `Converted from built-in chart "${label}"`,
    },
    channels,
    // Emitted only when something has to be reshaped, so a plain chart keeps
    // the smallest possible manifest.
    ...(plan.transforms.length > 0 ? { transforms: plan.transforms } : {}),
    traces: plan.traces,
    layout: convertLayout(chart.layout, warnings),
    // A converted chart is a starting point, not a detector entry: it carries
    // no keywords and exposes no options of its own.
    keywords: [],
    options: [],
  }
  return { manifest, warnings }
}
