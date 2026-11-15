import { SPLIT_BY_TRACE_TYPES, TRACE_TYPES, Y_MODE_SLOTS } from '@/utils/manifestForm'
import type { ManifestForm } from '@/utils/manifestForm'

/**
 * Form <-> manifest translation for the workbench's trace and layout editors.
 *
 * The manifest keeps `traces[i]` as `{ type, ...everythingElse }` and `layout`
 * as one object, and `manifestForm.ts` stores both as JSON text (`TraceForm.json`
 * / `ManifestForm.layout`). This module is the schema on top of that text: it
 * parses/serializes it, computes which `$` slots the manifest can actually
 * resolve, and decides which keys each trace type's form can represent.
 *
 * Three contracts matter:
 *
 * 1. Never drop a key. `traceToForm(trace)` keeps every key, and `formToTrace`
 *    re-emits them in manifest order. Keys the form has no control for stay in
 *    the object and are reported by `unrepresented*Keys` so the UI can list them.
 * 2. Drop only what cannot apply, and only on an explicit type switch.
 *    `switchTraceType` is the one place keys are removed; it returns exactly
 *    what it dropped so the editor can say so.
 * 3. Slots are filtered by the manifest, not by the dataset. `availableSlots`
 *    mirrors the backend's own slot resolution: declared channels, the
 *    `yFields.mode` arity and the transform pipeline's clearing rules.
 *
 * The allowlists below mirror `backend/core/custom_charts.py`; keep them in
 * sync with `STYLE_KEYS`, `_NESTED_STYLE_KEYS`, `_ARRAY_SLOT_PATHS`,
 * `INDICATOR_*`, `SANKEY_*` and `LAYOUT_KEYS`.
 */

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function isSlotString(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('$')
}

/** Text a literal is edited as: strings verbatim, everything else as JSON. */
export function literalText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/**
 * Parse text typed into a literal control.
 *
 * Style/data leaves accept any JSON scalar or list; a plain string such as
 * `#94a3b8` or `2024-01-01` is not JSON, so an unparsable text is kept as the
 * string the user typed instead of erroring. Numeric controls coerce to a
 * number when the text is one.
 */
export function parseLiteralText(text: string, numeric: boolean): unknown {
  const trimmed = text.trim()
  if (trimmed === '') return ''
  if (numeric) {
    const num = Number(trimmed)
    return Number.isFinite(num) ? num : trimmed
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return text
  }
}

/**
 * Copy `root` with `path` (`gauge.bar.color`) set to `value`; `undefined`
 * removes the key. Everything off the path is carried over untouched, which is
 * what keeps a structured edit from rewriting the rest of the object.
 */
export function setPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path.split('.')
  const next = { ...root }
  if (rest.length === 0) {
    if (value === undefined) delete next[head]
    else next[head] = value
    return next
  }
  const child = next[head]
  const patched = setPath(isRecord(child) ? child : {}, rest.join('.'), value)
  if (Object.keys(patched).length === 0) delete next[head]
  else next[head] = patched
  return next
}

export function getPath(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root
  for (const key of path.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[key]
  }
  return current
}

/**
 * Section-heading label with a plain-text fallback.
 *
 * The i18n keys for the new sections ship separately; until they land `t()`
 * echoes the key, which must not end up as a heading.
 */
export function optionalLabel(
  t: (key: string) => string,
  key: string,
  fallback: string,
): string {
  const value = t(key)
  return value === key || value === '' ? fallback : value
}

// ---------------------------------------------------------------------------
// slots
// ---------------------------------------------------------------------------

/** Channel keys that expose a `$<channel>` data slot (no `$facet` exists). */
const CHANNEL_SLOTS = ['x', 'color', 'size', 'z', 'error', 'source', 'target'] as const

/** Display order; `index`/`count` are always available (they need no channel). */
const BASE_SLOT_ORDER = [
  'x',
  'y0',
  'y1',
  'y2',
  'y3',
  'y4',
  'color',
  'size',
  'z',
  'error',
  'source',
  'target',
  'index',
  'count',
] as const

const LABEL_SLOT_RE = /^\$(?:x|y[0-4]|color)$/

export interface SlotSources {
  /** Data slots: `$x`, `$y0`…`$y4`, `$color`, …, `$index`, `$count`, `$as`. */
  data: string[]
  /** Label slots, allowed only in `name`/`text`: `$x.label`, … */
  labels: string[]
  /** Array style slots, allowed only at the 7 `_ARRAY_SLOT_PATHS`. */
  array: string[]
  /** `$opt.<key>` slots declared by the manifest's options. */
  options: string[]
}

function splitSlots(text: string): string[] {
  return text
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

/**
 * Slots the manifest can resolve, in a stable display order.
 *
 * Mirrors `_validate_channels` + `_validate_transforms`: a declared channel
 * contributes its slot, `yFields.mode` decides how many `$yN` exist, and the
 * transform pipeline clears everything a `group_agg`/`reduce` collapsed away
 * (`$index`/`$count` survive — the backend exempts them).
 */
export function availableSlots(form: ManifestForm): string[] {
  const available = new Set<string>(['index', 'count'])
  for (const key of CHANNEL_SLOTS) {
    if (form.channels[key]?.enabled) available.add(key)
  }
  const yCount = Y_MODE_SLOTS[form.yMode] ?? 0
  for (let index = 0; index < yCount; index += 1) available.add(`y${index}`)

  const outputs: string[] = []
  for (const transform of form.transforms) {
    const as = transform.as.trim()
    const produces = transform.op === 'group_agg' || transform.op === 'reduce' || transform.op === 'cumulate'
    if (transform.op === 'group_agg') {
      const grouped = splitSlots(transform.groupBy)
      available.clear()
      for (const slot of grouped) available.add(slot)
      if (as !== '') available.add(as)
    } else if (transform.op === 'reduce') {
      available.clear()
      if (as !== '') available.add(as)
    } else if (transform.op === 'cumulate' && as !== '') {
      available.add(as)
    }
    if (produces && as !== '' && !outputs.includes(as)) outputs.push(as)
  }
  // `$index` / `$count` survive every transform (the backend exempts them from
  // the group_agg/reduce clearing), so they are re-added after the pipeline.
  available.add('index')
  available.add('count')

  const ordered: string[] = BASE_SLOT_ORDER.filter((slot) => available.has(slot))
  for (const slot of outputs) {
    if (available.has(slot) && !ordered.includes(slot)) ordered.push(slot)
  }
  // A `groupBy` slot outside the base order (a transform output) is appended.
  for (const slot of available) {
    if (!ordered.includes(slot)) ordered.push(slot)
  }
  return ordered.map((slot) => `$${slot}`)
}

export function labelSlots(slots: readonly string[]): string[] {
  return slots.filter((slot) => LABEL_SLOT_RE.test(slot)).map((slot) => `${slot}.label`)
}

export function arrayValueSlots(slots: readonly string[]): string[] {
  return slots.map((slot) => `${slot}.values`)
}

export function optionSlots(options: ManifestForm['options'] | undefined): string[] {
  return (options ?? [])
    .map((option) => option.key.trim())
    .filter((key) => key !== '')
    .map((key) => `$opt.${key}`)
}

/** Every slot family one trace/layout editor can offer. */
export function slotSources(form: ManifestForm): SlotSources {
  const data = availableSlots(form)
  return {
    data,
    labels: labelSlots(data),
    array: arrayValueSlots(data),
    options: optionSlots(form.options),
  }
}

// ---------------------------------------------------------------------------
// trace state
// ---------------------------------------------------------------------------

export type TraceType = (typeof TRACE_TYPES)[number]

export interface TraceState {
  /** The trace's `type`; an unrecognised value is kept verbatim. */
  type: string
  /** Every other key, in manifest order. */
  fields: Record<string, unknown>
}

export interface ParsedFields {
  fields: Record<string, unknown>
  error?: string
}

function parseObjectFields(json: string): ParsedFields {
  const trimmed = json.trim()
  if (trimmed === '') return { fields: {} }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (!isRecord(parsed)) return { fields: {}, error: 'must be a JSON object' }
    return { fields: parsed }
  } catch (err) {
    return { fields: {}, error: err instanceof Error ? err.message : String(err) }
  }
}

function serializeObjectFields(fields: Record<string, unknown>): string {
  return Object.keys(fields).length === 0 ? '' : JSON.stringify(fields, null, 2)
}

export function parseTraceFields(json: string): ParsedFields {
  return parseObjectFields(json)
}

export function serializeTraceFields(fields: Record<string, unknown>): string {
  return serializeObjectFields(fields)
}

/** Read a manifest trace (`{type, ...}`) into the editor's shape. */
export function traceToForm(trace: unknown): TraceState {
  const source = isRecord(trace) ? trace : {}
  const fields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (key !== 'type') fields[key] = value
  }
  return { type: typeof source.type === 'string' ? source.type : 'scatter', fields }
}

/** Write the editor's shape back to a manifest trace (`type` first). */
export function formToTrace(state: TraceState): Record<string, unknown> {
  return { type: state.type, ...state.fields }
}

// ---------------------------------------------------------------------------
// per-type key applicability
// ---------------------------------------------------------------------------

/** Style objects only an `indicator` may carry (besides `value`, below). */
export const INDICATOR_ONLY_KEYS = ['title', 'number', 'gauge', 'delta'] as const
/** Keys only a `sankey` may carry (besides `source`/`target`, below). */
export const SANKEY_ONLY_KEYS = ['node', 'link', 'arrangement'] as const
const INDICATOR_EXCLUDED_DATA_KEYS = ['z', 'labels', 'values'] as const

/**
 * Data keys the editor offers for a type. `scatter`/`bar`/… keep the full
 * `DATA_KEYS` set (the validator accepts any of them and Plotly ignores what
 * does not apply); `indicator` uses `value`, `sankey` its three link columns.
 */
export function dataKeysFor(type: string): readonly string[] {
  if (type === 'indicator') return ['value']
  if (type === 'sankey') return ['source', 'target', 'values']
  return ['x', 'y', 'z', 'labels', 'values']
}

/**
 * Whether the backend accepts `key` on `type`.
 *
 * This is the drop rule for `switchTraceType`, so it mirrors the validator's
 * rejections exactly — a key the validator would accept is never dropped, even
 * when the form has no control for it.
 */
export function isApplicableKey(type: string, key: string): boolean {
  if (key === 'value') return type === 'indicator'
  if (key === 'source' || key === 'target') return type === 'sankey'
  if (key === 'segments') return type === 'scatter'
  if (key === 'splitBy') return (SPLIT_BY_TRACE_TYPES as readonly string[]).includes(type)
  if ((INDICATOR_ONLY_KEYS as readonly string[]).includes(key)) return type === 'indicator'
  if ((SANKEY_ONLY_KEYS as readonly string[]).includes(key)) return type === 'sankey'
  if ((INDICATOR_EXCLUDED_DATA_KEYS as readonly string[]).includes(key)) {
    return type !== 'indicator'
  }
  return true
}

export interface TraceTypeSwitch {
  state: TraceState
  /** Keys removed because the new type cannot carry them (empty when equal). */
  dropped: string[]
}

/**
 * Switch a trace's type, dropping only the keys the new type rejects.
 *
 * Order is preserved and nothing else is touched: a `bar`'s `x`/`y`/`marker`
 * survive a switch to `scatter`, while `indicator`'s `gauge` or a sankey's
 * `source` do not survive a switch away from their type.
 */
export function switchTraceType(state: TraceState, nextType: string): TraceTypeSwitch {
  if (state.type === nextType) return { state, dropped: [] }
  const fields: Record<string, unknown> = {}
  const dropped: string[] = []
  for (const [key, value] of Object.entries(state.fields)) {
    if (isApplicableKey(nextType, key)) fields[key] = value
    else dropped.push(key)
  }
  return { state: { type: nextType, fields }, dropped }
}

// ---------------------------------------------------------------------------
// segments
// ---------------------------------------------------------------------------

export interface SegmentState {
  x: string
  from: string
  to: string
  horizontal: boolean
}

/** `_SEGMENT_KEYS`: the only keys a `segments` object may carry. */
export const SEGMENT_KEYS: readonly string[] = ['x', 'from', 'to', 'horizontal']

/** `segments` as flat fields; `null` when the trace has none. */
export function readSegments(fields: Record<string, unknown>): SegmentState | null {
  const raw = fields.segments
  if (!isRecord(raw)) return null
  return {
    x: typeof raw.x === 'string' ? raw.x : '',
    from: typeof raw.from === 'string' ? raw.from : '',
    to: typeof raw.to === 'string' ? raw.to : '',
    horizontal: raw.horizontal === true,
  }
}

export function fieldsToSegments(segment: SegmentState): Record<string, unknown> {
  const next: Record<string, unknown> = { x: segment.x, from: segment.from, to: segment.to }
  if (segment.horizontal) next.horizontal = true
  return next
}

/**
 * Write `segments` back onto a trace.
 *
 * `segments` and top-level `x`/`y` are mutually exclusive, so replacing `x`/`y`
 * with segments removes them (and `null` only removes `segments`, leaving the
 * trace the user comes back to without one).
 */
export function writeSegments(
  fields: Record<string, unknown>,
  segment: SegmentState | null,
): Record<string, unknown> {
  const next = { ...fields }
  if (segment === null) {
    delete next.segments
    return next
  }
  delete next.x
  delete next.y
  next.segments = fieldsToSegments(segment)
  return next
}

// ---------------------------------------------------------------------------
// element schema (what the form can render)
// ---------------------------------------------------------------------------

export type LeafControl =
  /** Data slot or literal: `x`, `y`, `value`, `source`, … */
  | 'data'
  /** Data slot only (segments: the backend rejects literals there). */
  | 'dataOnly'
  /** Literal, `$opt.<key>` or a label slot (`name` / `text`). */
  | 'text'
  /** Literal or `$opt.<key>`. */
  | 'style'
  /** Numeric literal or `$opt.<key>`. */
  | 'styleNumber'
  | 'boolean'
  | 'select'
  /** `$<slot>.values`, `$opt.<key>` or a literal (7 array paths only). */
  | 'arrayStyle'
  /** Exactly-two value list (ranges). */
  | 'pair'
  /** Literal list of scalars. */
  | 'list'
  /** `gauge.steps`: a list of `{range, color}` objects. */
  | 'steps'

export interface LeafSpec {
  key: string
  control: LeafControl
  /** Offer the manifest's label slots too (only `name` / `text`). */
  slots?: 'label'
  choices?: readonly string[]
}

export interface ObjectSpec {
  key: string
  children: readonly NodeSpec[]
}

export type NodeSpec = LeafSpec | ObjectSpec

export function isObjectSpec(node: NodeSpec): node is ObjectSpec {
  return 'children' in node
}

const MODE_CHOICES = [
  'lines',
  'markers',
  'lines+markers',
  'lines+markers+text',
  'text',
  'none',
  'gauge+number',
  'gauge+number+delta',
  'gauge+delta',
  'number',
  'number+delta',
  'gauge',
  'delta',
] as const
const FILL_CHOICES = ['none', 'tozeroy', 'tonexty', 'tonextx', 'toself'] as const
const ORIENTATION_CHOICES = ['v', 'h'] as const
const TEXT_POSITION_CHOICES = [
  'inside',
  'outside',
  'auto',
  'none',
  'top left',
  'top center',
  'top right',
  'middle left',
  'middle center',
  'middle right',
  'bottom left',
  'bottom center',
  'bottom right',
] as const
const BOXPOINTS_CHOICES = ['all', 'outliers', 'suspectedoutliers', 'false'] as const
const HISTNORM_CHOICES = ['count', 'percent', 'probability', 'density', 'probability density'] as const
const ARRANGEMENT_CHOICES = ['snap', 'perpendicular', 'freeform', 'fixed'] as const
const DASH_CHOICES = ['solid', 'dot', 'dash', 'longdash', 'dashdot', 'longdashdot'] as const
const LINE_SHAPE_CHOICES = ['linear', 'spline', 'hv', 'vh', 'hvh', 'vhv'] as const
const SIZEMODE_CHOICES = ['diameter', 'area'] as const
const ERROR_TYPE_CHOICES = ['percent', 'constant', 'sqrt', 'data'] as const
const POSITION_CHOICES = ['top', 'bottom', 'left', 'right'] as const
const GAUGE_SHAPE_CHOICES = ['angular', 'bullet'] as const

/** Every allowlisted scalar style key (`STYLE_KEYS` minus the object keys). */
const ALL_SCALAR_KEYS = [
  'mode',
  'name',
  'text',
  'textposition',
  'orientation',
  'opacity',
  'fill',
  'width',
  'offsetgroup',
  'showlegend',
  'hovertemplate',
  'hole',
  'boxpoints',
  'histnorm',
  'arrangement',
] as const

const SCALAR_SPECS: Record<string, LeafSpec> = {
  mode: { key: 'mode', control: 'select', choices: MODE_CHOICES },
  name: { key: 'name', control: 'text', slots: 'label' },
  text: { key: 'text', control: 'text', slots: 'label' },
  textposition: { key: 'textposition', control: 'select', choices: TEXT_POSITION_CHOICES },
  orientation: { key: 'orientation', control: 'select', choices: ORIENTATION_CHOICES },
  opacity: { key: 'opacity', control: 'styleNumber' },
  fill: { key: 'fill', control: 'select', choices: FILL_CHOICES },
  width: { key: 'width', control: 'styleNumber' },
  offsetgroup: { key: 'offsetgroup', control: 'style' },
  showlegend: { key: 'showlegend', control: 'boolean' },
  hovertemplate: { key: 'hovertemplate', control: 'style' },
  hole: { key: 'hole', control: 'styleNumber' },
  boxpoints: { key: 'boxpoints', control: 'select', choices: BOXPOINTS_CHOICES },
  histnorm: { key: 'histnorm', control: 'select', choices: HISTNORM_CHOICES },
  arrangement: { key: 'arrangement', control: 'select', choices: ARRANGEMENT_CHOICES },
}

/** Scalars shown for every trace type. */
const SHARED_SCALAR_KEYS = ['name', 'text', 'opacity', 'showlegend', 'hovertemplate'] as const

/** Scalars the selected type's Plotly trace actually reads. */
const TYPE_SCALAR_KEYS: Record<string, readonly string[]> = {
  scatter: ['mode', 'fill', 'textposition', 'width'],
  bar: ['orientation', 'width', 'offsetgroup', 'textposition'],
  box: ['orientation', 'width', 'offsetgroup', 'boxpoints'],
  violin: ['orientation', 'width', 'offsetgroup', 'boxpoints', 'fill'],
  waterfall: ['orientation', 'width', 'textposition'],
  funnel: ['orientation', 'width', 'textposition'],
  histogram: ['histnorm', 'offsetgroup', 'width'],
  indicator: ['mode'],
  sankey: ['arrangement', 'orientation'],
}

const LINE_CHILDREN: readonly NodeSpec[] = [
  { key: 'color', control: 'style' },
  { key: 'width', control: 'styleNumber' },
  { key: 'dash', control: 'select', choices: DASH_CHOICES },
  { key: 'shape', control: 'select', choices: LINE_SHAPE_CHOICES },
  { key: 'smoothing', control: 'styleNumber' },
  { key: 'simplify', control: 'styleNumber' },
]

const FONT_CHILDREN: readonly NodeSpec[] = [
  { key: 'family', control: 'style' },
  { key: 'size', control: 'styleNumber' },
  { key: 'color', control: 'style' },
]

const ERROR_CHILDREN: readonly NodeSpec[] = [
  { key: 'type', control: 'select', choices: ERROR_TYPE_CHOICES },
  { key: 'array', control: 'arrayStyle' },
  { key: 'arrayminus', control: 'arrayStyle' },
  { key: 'visible', control: 'boolean' },
  { key: 'color', control: 'style' },
  { key: 'thickness', control: 'styleNumber' },
  { key: 'width', control: 'styleNumber' },
]

const DELTA_MARKER_CHILDREN: readonly NodeSpec[] = [
  { key: 'color', control: 'style' },
  { key: 'symbol', control: 'style' },
]

const OBJECT_SPECS: Record<string, ObjectSpec> = {
  line: { key: 'line', children: LINE_CHILDREN },
  marker: {
    key: 'marker',
    children: [
      { key: 'color', control: 'arrayStyle' },
      { key: 'size', control: 'arrayStyle' },
      { key: 'symbol', control: 'style' },
      { key: 'opacity', control: 'arrayStyle' },
      { key: 'angle', control: 'styleNumber' },
      { key: 'line', children: LINE_CHILDREN },
      { key: 'colorscale', control: 'style' },
      { key: 'showscale', control: 'boolean' },
      { key: 'cmin', control: 'styleNumber' },
      { key: 'cmax', control: 'styleNumber' },
      { key: 'sizemode', control: 'select', choices: SIZEMODE_CHOICES },
      { key: 'sizeref', control: 'styleNumber' },
      { key: 'standoff', control: 'styleNumber' },
    ],
  },
  error_x: { key: 'error_x', children: ERROR_CHILDREN },
  error_y: { key: 'error_y', children: ERROR_CHILDREN },
  node: {
    key: 'node',
    children: [
      { key: 'pad', control: 'styleNumber' },
      { key: 'thickness', control: 'styleNumber' },
      { key: 'line', children: LINE_CHILDREN },
      { key: 'color', control: 'style' },
    ],
  },
  link: {
    key: 'link',
    children: [
      { key: 'color', control: 'style' },
      { key: 'line', children: LINE_CHILDREN },
    ],
  },
  title: {
    key: 'title',
    children: [
      { key: 'text', control: 'style' },
      { key: 'font', children: FONT_CHILDREN },
    ],
  },
  number: {
    key: 'number',
    children: [
      { key: 'valueformat', control: 'style' },
      { key: 'suffix', control: 'style' },
      { key: 'prefix', control: 'style' },
      { key: 'font', children: FONT_CHILDREN },
    ],
  },
  delta: {
    key: 'delta',
    children: [
      { key: 'reference', control: 'styleNumber' },
      { key: 'relative', control: 'style' },
      { key: 'valueformat', control: 'style' },
      { key: 'position', control: 'select', choices: POSITION_CHOICES },
      { key: 'increasing', children: DELTA_MARKER_CHILDREN },
      { key: 'decreasing', children: DELTA_MARKER_CHILDREN },
    ],
  },
  gauge: {
    key: 'gauge',
    children: [
      {
        key: 'axis',
        children: [
          { key: 'range', control: 'pair' },
          { key: 'tickvals', control: 'list' },
          { key: 'ticktext', control: 'list' },
          { key: 'tickformat', control: 'style' },
          { key: 'visible', control: 'boolean' },
        ],
      },
      {
        key: 'bar',
        children: [
          { key: 'color', control: 'style' },
          { key: 'thickness', control: 'styleNumber' },
        ],
      },
      { key: 'bgcolor', control: 'style' },
      { key: 'steps', control: 'steps' },
      { key: 'shape', control: 'select', choices: GAUGE_SHAPE_CHOICES },
      { key: 'thickness', control: 'styleNumber' },
    ],
  },
}

/** Objects offered for a type by default. */
const TYPE_OBJECT_KEYS: Record<string, readonly string[]> = {
  scatter: ['line', 'marker', 'error_x', 'error_y'],
  bar: ['line', 'marker', 'error_x', 'error_y'],
  box: ['line', 'marker'],
  violin: ['line', 'marker'],
  waterfall: ['line', 'marker'],
  funnel: ['line', 'marker'],
  histogram: ['line', 'marker'],
  indicator: ['title', 'number', 'gauge', 'delta'],
  sankey: ['node', 'link'],
}

const ALL_OBJECT_KEYS = [
  'line',
  'marker',
  'error_x',
  'error_y',
  'node',
  'link',
  'title',
  'number',
  'gauge',
  'delta',
] as const

/**
 * Scalar controls for one trace: the type's own keys, then the shared ones,
 * then any allowlisted scalar already present (a hand-written `hole` must stay
 * editable instead of silently becoming "unsupported").
 */
export function traceScalars(type: string, fields: Record<string, unknown>): LeafSpec[] {
  const specs: LeafSpec[] = []
  const push = (key: string) => {
    const spec = SCALAR_SPECS[key]
    if (spec !== undefined && !specs.some((item) => item.key === spec.key)) specs.push(spec)
  }
  for (const key of TYPE_SCALAR_KEYS[type] ?? []) push(key)
  for (const key of SHARED_SCALAR_KEYS) push(key)
  for (const key of ALL_SCALAR_KEYS) {
    if (key in fields && isApplicableKey(type, key)) push(key)
  }
  return specs
}

/**
 * Nested style objects for one trace. `node`/`link` on a sankey and `title`/
 * `number`/`gauge`/`delta` on an indicator come from their own allowlists; any
 * other allowlisted object that is already present stays editable too.
 */
export function traceObjects(type: string, fields: Record<string, unknown>): ObjectSpec[] {
  const specs: ObjectSpec[] = []
  const push = (key: string) => {
    const spec = OBJECT_SPECS[key]
    if (spec !== undefined && !specs.some((item) => item.key === key)) specs.push(spec)
  }
  for (const key of TYPE_OBJECT_KEYS[type] ?? []) push(key)
  for (const key of ALL_OBJECT_KEYS) {
    if (key in fields && isApplicableKey(type, key)) push(key)
  }
  return specs
}

function collectObjectKeys(
  value: unknown,
  spec: ObjectSpec,
  prefix: string,
  out: string[],
): void {
  if (!isRecord(value)) {
    out.push(prefix)
    return
  }
  for (const [key, item] of Object.entries(value)) {
    const child = spec.children.find((node) => node.key === key)
    const path = `${prefix}.${key}`
    if (child === undefined) {
      out.push(path)
    } else if (isObjectSpec(child)) {
      collectObjectKeys(item, child, path, out)
    } else if (child.control === 'steps') {
      collectStepKeys(item, path, out)
    }
  }
}

function collectStepKeys(value: unknown, prefix: string, out: string[]): void {
  if (!Array.isArray(value)) {
    out.push(prefix)
    return
  }
  value.forEach((step, index) => {
    if (!isRecord(step)) {
      out.push(`${prefix}[${index}]`)
      return
    }
    for (const key of Object.keys(step)) {
      if (key !== 'range' && key !== 'color') out.push(`${prefix}[${index}].${key}`)
    }
  })
}

/**
 * Keys of `fields` no form control can represent, as manifest paths
 * (`marker.standoff`, `gauge.steps[0].label`). They are **not** removed; the
 * editor lists them next to the JSON escape hatch.
 */
export function unrepresentedTraceKeys(
  type: string,
  fields: Record<string, unknown>,
): string[] {
  const out: string[] = []
  const dataKeys = dataKeysFor(type)
  for (const [key, value] of Object.entries(fields)) {
    if (dataKeys.includes(key)) continue
    if (key === 'splitBy') {
      if (!isApplicableKey(type, key)) out.push(key)
      continue
    }
    if (key === 'segments') {
      if (type !== 'scatter') {
        out.push(key)
      } else if (isRecord(fields.segments)) {
        for (const child of Object.keys(fields.segments)) {
          if (!SEGMENT_KEYS.includes(child)) out.push(`${key}.${child}`)
        }
      } else {
        out.push(key)
      }
      continue
    }
    const objectSpec = OBJECT_SPECS[key]
    if (objectSpec !== undefined && isApplicableKey(type, key)) {
      collectObjectKeys(value, objectSpec, key, out)
      continue
    }
    if ((ALL_SCALAR_KEYS as readonly string[]).includes(key) && isApplicableKey(type, key)) {
      continue
    }
    out.push(key)
  }
  return out
}

// ---------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------

export interface LayoutState {
  fields: Record<string, unknown>
}

/** Top-level keys `layout` may override (`LAYOUT_KEYS` in the backend). */
export const LAYOUT_KEYS = [
  'showlegend',
  'barmode',
  'margin',
  'xaxis',
  'yaxis',
  'legend',
  'hovermode',
  'polar',
  'title',
] as const

const AXIS_KEYS = [
  'title',
  'type',
  'showgrid',
  'gridcolor',
  'tickangle',
  'range',
  'tickformat',
  'tickfont',
] as const
const MARGIN_KEYS = ['l', 'r', 't', 'b', 'pad'] as const
const FONT_KEYS = ['family', 'size', 'color'] as const

/** Nested font objects the layout form edits, three leaves each. */
export const LAYOUT_FONT_PATHS = [
  'title.font',
  'legend.font',
  'xaxis.title.font',
  'yaxis.title.font',
  'xaxis.tickfont',
  'yaxis.tickfont',
] as const

export function layoutToForm(layout: unknown): LayoutState {
  return { fields: isRecord(layout) ? cloneJson(layout) : {} }
}

export function formToLayout(state: LayoutState): Record<string, unknown> {
  return cloneJson(state.fields)
}

export function parseLayoutFields(json: string): ParsedFields {
  return parseObjectFields(json)
}

export function serializeLayoutFields(fields: Record<string, unknown>): string {
  return serializeObjectFields(fields)
}

/**
 * Layout paths the form cannot represent. Nested keys are unconstrained in the
 * schema (any Plotly axis/legend key is valid), so `xaxis.automargin` and
 * friends are preserved and listed rather than dropped. The font objects the
 * form does edit (`title.font`, `xaxis.tickfont`, …) are reduced to their three
 * leaves; any other key inside one is still named.
 */
export function unrepresentedLayoutKeys(fields: Record<string, unknown>): string[] {
  const out: string[] = []
  const reportFont = (path: string, value: unknown) => {
    if (value === undefined) return
    if (!isRecord(value)) {
      out.push(path)
      return
    }
    for (const child of Object.keys(value)) {
      if (!(FONT_KEYS as readonly string[]).includes(child)) out.push(`${path}.${child}`)
    }
  }
  for (const [key, value] of Object.entries(fields)) {
    if (!(LAYOUT_KEYS as readonly string[]).includes(key)) {
      out.push(key)
      continue
    }
    if (!isRecord(value)) continue
    if (key === 'margin') {
      for (const child of Object.keys(value)) {
        if (!(MARGIN_KEYS as readonly string[]).includes(child)) out.push(`margin.${child}`)
      }
    } else if (key === 'xaxis' || key === 'yaxis') {
      for (const child of Object.keys(value)) {
        if (!(AXIS_KEYS as readonly string[]).includes(child)) out.push(`${key}.${child}`)
      }
      if (isRecord(value.title)) {
        for (const child of Object.keys(value.title)) {
          if (child !== 'text' && child !== 'font') out.push(`${key}.title.${child}`)
        }
        reportFont(`${key}.title.font`, value.title.font)
      }
      reportFont(`${key}.tickfont`, value.tickfont)
    } else if (key === 'legend') {
      for (const child of Object.keys(value)) {
        if (
          child !== 'orientation' &&
          child !== 'x' &&
          child !== 'y' &&
          child !== 'font'
        ) {
          out.push(`legend.${child}`)
        }
      }
      reportFont('legend.font', value.font)
    } else if (key === 'polar') {
      for (const child of Object.keys(value)) {
        if (child !== 'bgcolor' && child !== 'hole') out.push(`polar.${child}`)
      }
    } else if (key === 'title') {
      for (const child of Object.keys(value)) {
        if (child !== 'text' && child !== 'font') out.push(`title.${child}`)
      }
      reportFont('title.font', value.font)
    }
  }
  return out
}

/** `title` as text: Plotly accepts a bare string or `{text}`. */
export function titleText(value: unknown): string {
  if (isRecord(value)) return typeof value.text === 'string' ? value.text : ''
  if (typeof value === 'string') return value
  return ''
}

/**
 * `setPath` for the layout object.
 *
 * Plotly accepts a bare string for `title` / `xaxis.title` / `yaxis.title`, so
 * editing a child of one (a font leaf) must not drop the text: the string is
 * normalised to `{text}` first. Empty parents are pruned by `setPath`, which is
 * what makes clearing the last font field remove `font` and then the empty
 * `title: {}` around it.
 */
export function setLayoutPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  let next = root
  for (const parent of ['title', 'xaxis.title', 'yaxis.title']) {
    if (!path.startsWith(`${parent}.`)) continue
    const current = getPath(next, parent)
    if (typeof current === 'string') next = setPath(next, parent, { text: current })
  }
  return setPath(next, path, value)
}

/** Deep equality of two JSON values, ignoring object key order. */
export function sameJsonValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    return left.length === right.length && left.every((item, i) => sameJsonValue(item, right[i]))
  }
  if (isRecord(left) || isRecord(right)) {
    if (!isRecord(left) || !isRecord(right)) return false
    const keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) return false
    return keys.every((key) => key in right && sameJsonValue(left[key], right[key]))
  }
  return left === right
}

// ---------------------------------------------------------------------------
// control metadata (colours, numbers, placeholders)
// ---------------------------------------------------------------------------

/** Fold a list index away: `gauge.steps[2].color` -> `gauge.steps[].color`. */
export function canonicalStylePath(path: string): string {
  return path.replace(/\[\d+\]/g, '[]')
}

/**
 * Style leaves whose value is a colour (the backend reads them as such).
 *
 * `marker.color` acts as an array slot too; the swatch additionally hides for
 * slots/lists (see `swatchColor`), so a `$x.values` colour list stays editable.
 */
export const COLOR_PATHS: readonly string[] = [
  'line.color',
  'marker.color',
  'marker.line.color',
  'error_x.color',
  'error_y.color',
  'node.color',
  'link.color',
  'gauge.bar.color',
  'gauge.bgcolor',
  'gauge.steps[].color',
  'delta.increasing.color',
  'delta.decreasing.color',
  'title.font.color',
  'number.font.color',
]

/** Layout keys that take a Plotly colour (same swatch, no style allowlist). */
export const LAYOUT_COLOR_PATHS: readonly string[] = [
  'polar.bgcolor',
  'xaxis.gridcolor',
  'yaxis.gridcolor',
  'title.font.color',
  'legend.font.color',
  'xaxis.title.font.color',
  'yaxis.title.font.color',
  'xaxis.tickfont.color',
  'yaxis.tickfont.color',
]

export function isColorPath(path: string): boolean {
  const canonical = canonicalStylePath(path)
  return COLOR_PATHS.includes(canonical) || LAYOUT_COLOR_PATHS.includes(canonical)
}

export const DEFAULT_SWATCH_COLOR = '#3b82f6'

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Hex the colour swatch shows for `value`; `null` when it must not render.
 *
 * A slot (`$opt.brand`) or a list (`$x.values`) is not something a picker can
 * represent, and writing a hex there would replace it, so the text control
 * stays the only editor for those. Any other value seeds the picker: a hex as
 * written, a named colour/`rgba()` with the default, so the swatch keeps
 * working as "pick a literal hex".
 */
export function swatchColor(value: unknown): string | null {
  if (isSlotString(value) || Array.isArray(value) || isRecord(value)) return null
  if (typeof value === 'string' && HEX_COLOR_RE.test(value)) {
    if (value.length === 4) {
      return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase()
    }
    return value.toLowerCase()
  }
  return DEFAULT_SWATCH_COLOR
}

export interface NumberConstraints {
  min?: number
  max?: number
  /** `any` lets the browser accept every decimal (Plotly does too). */
  step: number | 'any'
}

/**
 * Opacities are 0–1 in 0.05 steps; sizes/widths are whole numbers from 0.
 * Anything else (a free value such as `delta.reference`) stays unrestricted so
 * a legitimate negative or fractional literal is not blocked.
 */
const OPACITY_PATHS = ['opacity', 'marker.opacity', 'link.opacity', 'node.opacity']
const WHOLE_NUMBER_PATHS = [
  'width',
  'line.width',
  'marker.line.width',
  'marker.size',
  'container.pad',
  'node.pad',
  'node.thickness',
  'gauge.thickness',
  'gauge.bar.thickness',
  'gauge.steps[].thickness',
  'error_x.thickness',
  'error_y.thickness',
  'error_x.width',
  'error_y.width',
  'margin.pad',
]
const STEP_NUMBER_PATHS = ['margin.l', 'margin.r', 'margin.t', 'margin.b']
const ANGLE_PATHS = ['xaxis.tickangle', 'yaxis.tickangle']
/** Plotly font sizes start at 1; the layout fonts are the only sizes the form edits. */
const FONT_SIZE_PATHS: readonly string[] = LAYOUT_FONT_PATHS.map((path) => `${path}.size`)
const HOLE_PATHS = ['polar.hole']

export function numberConstraints(path: string): NumberConstraints {
  const canonical = canonicalStylePath(path)
  if (OPACITY_PATHS.includes(canonical)) return { min: 0, max: 1, step: 0.05 }
  if (HOLE_PATHS.includes(canonical)) return { min: 0, max: 1, step: 0.01 }
  if (FONT_SIZE_PATHS.includes(canonical)) return { min: 1, step: 1 }
  if (WHOLE_NUMBER_PATHS.includes(canonical)) return { min: 0, step: 1 }
  if (STEP_NUMBER_PATHS.includes(canonical)) return { step: 1 }
  if (canonical === 'legend.x' || canonical === 'legend.y') return { step: 0.01 }
  if (ANGLE_PATHS.includes(canonical)) return { min: -180, max: 180, step: 1 }
  return { step: 'any' }
}

/** `arrayStyle` leaves that are a single number when literal, not a list. */
export const NUMERIC_ARRAY_PATHS: readonly string[] = ['marker.size', 'marker.opacity']

export function isNumericArrayPath(path: string): boolean {
  return NUMERIC_ARRAY_PATHS.includes(canonicalStylePath(path))
}

/** i18n suffix (`chart.workbench.placeholder.<kind>`) for a control's hint. */
export type PlaceholderKind = 'opacity' | 'color' | 'hovertemplate' | 'number'

export function placeholderKind(path: string, control: LeafControl): PlaceholderKind | null {
  const canonical = canonicalStylePath(path)
  if (canonical === 'opacity' || canonical === 'marker.opacity') return 'opacity'
  if (isColorPath(path)) return 'color'
  if (canonical === 'hovertemplate') return 'hovertemplate'
  if (canonical === 'marker.size') return 'number'
  if (control === 'styleNumber' || control === 'pair' || control === 'list') return 'number'
  return null
}

// ---------------------------------------------------------------------------
// per-field validation
// ---------------------------------------------------------------------------

export interface ErrorLike {
  path: string
  message: string
}

/**
 * Message for the control bound to `path`, tolerating the backend's own leaf
 * granularity:
 *
 * - `xaxis.title` is reported at the object, the control writes `.text`;
 * - `xaxis.range[0]` is reported per item, the control is the pair;
 * - `gauge.steps[2].color` is reported per step row.
 */
export function errorAtPath(
  errors: Readonly<Record<string, string>>,
  path: string,
): string | undefined {
  const direct = errors[path]
  if (direct !== undefined) return direct
  if (path.endsWith('.text')) {
    const parent = errors[path.slice(0, -'.text'.length)]
    if (parent !== undefined) return parent
  }
  for (let index = 0; index < 10; index += 1) {
    const item = errors[`${path}[${index}]`]
    if (item !== undefined) return item
  }
  // A list control owns every item below it: `gauge.steps` is the only control
  // for `gauge.steps[2].color`, so that message belongs on the steps field.
  const childPrefix = `${path}[`
  for (const [key, message] of Object.entries(errors)) {
    if (key.startsWith(childPrefix)) return message
  }
  const withoutIndex = path.replace(/\[\d+\]$/, '')
  if (withoutIndex !== path) {
    const parent = errors[withoutIndex]
    if (parent !== undefined) return parent
  }
  return undefined
}

export interface TraceErrorSet {
  /** `traces[n]` itself (mutually exclusive keys, trace count, …). */
  trace?: string
  /** `traces[n].json`: the escape hatch's own parse/validation problem. */
  json?: string
  /** `traces[n].type`: highlights the type select. */
  type?: string
  /** Trace-local leaf path (`marker.color`, `gauge.steps[2].range[0]`). */
  fields: Record<string, string>
}

const TRACE_PROBLEM_RE = /^traces\[(\d+)\](?:\.(.+))?$/

/** Split the manifest-level problems down to one trace card. */
export function traceErrors(problems: readonly ErrorLike[], index: number): TraceErrorSet {
  const result: TraceErrorSet = { fields: {} }
  for (const problem of problems) {
    const match = TRACE_PROBLEM_RE.exec(problem.path)
    if (match === null || Number(match[1]) !== index) continue
    const leaf = match[2]
    if (leaf === undefined) result.trace ??= problem.message
    else if (leaf === 'json') result.json ??= problem.message
    else if (leaf === 'type') result.type ??= problem.message
    else result.fields[leaf] ??= problem.message
  }
  return result
}

/** Split the manifest-level problems down to `layout` paths (prefix stripped). */
export function layoutFieldErrors(problems: readonly ErrorLike[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const problem of problems) {
    if (problem.path !== 'layout' && !problem.path.startsWith('layout.')) continue
    const leaf = problem.path === 'layout' ? '' : problem.path.slice('layout.'.length)
    result[leaf] ??= problem.message
  }
  return result
}

// ---------------------------------------------------------------------------
// object / list editing
// ---------------------------------------------------------------------------

/** `gauge.steps` is capped by the backend at 10 entries. */
export const MAX_GAUGE_STEPS = 10
/** Default row an added step starts from (`{range: [lo, hi], color}`). */
export const NEW_GAUGE_STEP = { range: [0, 0], color: DEFAULT_SWATCH_COLOR }

/**
 * Add the empty object a "+ line" action turns into a form block. Idempotent:
 * an object that is already there is never overwritten (that would drop the
 * keys the user filled in).
 */
export function addNestedObject(
  fields: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  const current = getPath(fields, path)
  return isRecord(current) ? fields : setPath(fields, path, {})
}

/** Remove a whole object (`line`, `marker.line`, `gauge.axis`, …). */
export function removeNestedObject(
  fields: Record<string, unknown>,
  path: string,
): Record<string, unknown> {
  return setPath(fields, path, undefined)
}

/**
 * Append a `{range, color}` row to `gauge.steps`, capped at
 * `MAX_GAUGE_STEPS`; a full list is returned unchanged (the add action is
 * disabled at that point anyway).
 */
export function appendGaugeStep(steps: unknown): unknown[] {
  const list = Array.isArray(steps) ? steps.filter(isRecord) : []
  if (list.length >= MAX_GAUGE_STEPS) return list
  return [...list, { range: [...NEW_GAUGE_STEP.range], color: NEW_GAUGE_STEP.color }]
}

// ---------------------------------------------------------------------------
// trace card summary
// ---------------------------------------------------------------------------

/** One-line header summary: `scatter · $x × $y0`, `sankey · $a → $b`. */
export function traceSummary(type: string, fields: Record<string, unknown>): string {
  const slot = (key: string) => (typeof fields[key] === 'string' ? (fields[key] as string) : '')
  if (type === 'indicator') {
    const detail = slot('value') || slot('mode')
    return detail === '' ? type : `${type} · ${detail}`
  }
  if (type === 'sankey') {
    return `${type} · ${slot('source') || '—'} → ${slot('target') || '—'}`
  }
  if (isRecord(fields.segments)) {
    const segment = fields.segments
    const part = (key: string) => {
      const value = segment[key]
      return typeof value === 'string' ? value : '—'
    }
    return `${type} · ${part('x')} ${part('from')} → ${part('to')}`
  }
  const x = slot('x') || '—'
  const y = slot('y')
  return y === '' ? `${type} · ${x}` : `${type} · ${x} × ${y}`
}

// ---------------------------------------------------------------------------
// layout: the full core set
// ---------------------------------------------------------------------------

/**
 * Every layout control the form always renders, as a path into `layout`.
 *
 * The controls read these paths but never write one until it changes, so a
 * fresh manifest keeps `layout: ''` (see `layoutLeafValue`, which turns a
 * cleared control into a delete instead of `""`/`0`). `xaxis.title.text` is
 * the leaf because Plotly accepts both a bare string and `{text}`.
 */
export const LAYOUT_FIELD_PATHS = [
  'showlegend',
  'barmode',
  'hovermode',
  'title.text',
  'title.font.family',
  'title.font.size',
  'title.font.color',
  'margin.l',
  'margin.r',
  'margin.t',
  'margin.b',
  'margin.pad',
  'legend.orientation',
  'legend.x',
  'legend.y',
  'legend.font.family',
  'legend.font.size',
  'legend.font.color',
  'polar.bgcolor',
  'polar.hole',
  'xaxis.title.text',
  'xaxis.type',
  'xaxis.showgrid',
  'xaxis.gridcolor',
  'xaxis.tickangle',
  'xaxis.tickformat',
  'xaxis.title.font.family',
  'xaxis.title.font.size',
  'xaxis.title.font.color',
  'xaxis.tickfont.family',
  'xaxis.tickfont.size',
  'xaxis.tickfont.color',
  'xaxis.range',
  'yaxis.title.text',
  'yaxis.type',
  'yaxis.showgrid',
  'yaxis.gridcolor',
  'yaxis.tickangle',
  'yaxis.tickformat',
  'yaxis.title.font.family',
  'yaxis.title.font.size',
  'yaxis.title.font.color',
  'yaxis.tickfont.family',
  'yaxis.tickfont.size',
  'yaxis.tickfont.color',
  'yaxis.range',
] as const

/** Blank input -> delete the key; anything else commits as typed. */
export function layoutLeafValue(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  return value
}

/**
 * A range (`xaxis.range`) with both ends blank is no range at all: delete it
 * rather than write `["", ""]`, which Plotly would read as two empty bounds.
 */
export function layoutRangeValue(lo: unknown, hi: unknown): unknown[] | undefined {
  const blank = (value: unknown) => value === undefined || value === null || value === ''
  if (blank(lo) && blank(hi)) return undefined
  return [lo ?? '', hi ?? '']
}
