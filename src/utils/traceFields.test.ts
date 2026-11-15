import { describe, expect, it } from 'vitest'
import bubbleRaw from '../../examples/charts/bubble.json?raw'
import bulletRaw from '../../examples/charts/bullet.json?raw'
import colorsGridRaw from '../../examples/charts/colors-grid.json?raw'
import dumbbellRaw from '../../examples/charts/dumbbell.json?raw'
import facetGridRaw from '../../examples/charts/facet-grid.json?raw'
import flowSankeyRaw from '../../examples/charts/flow-sankey.json?raw'
import kpiGaugeRaw from '../../examples/charts/kpi-gauge.json?raw'
import lollipopRaw from '../../examples/charts/lollipop.json?raw'
import seriesLineRaw from '../../examples/charts/series-line.json?raw'
import { emptyManifest, type ManifestForm } from '@/utils/manifestForm'
import {
  addNestedObject,
  appendGaugeStep,
  arrayValueSlots,
  availableSlots,
  dataKeysFor,
  DEFAULT_SWATCH_COLOR,
  errorAtPath,
  fieldsToSegments,
  formToLayout,
  formToTrace,
  getPath,
  isApplicableKey,
  isColorPath,
  isNumericArrayPath,
  labelSlots,
  LAYOUT_FIELD_PATHS,
  LAYOUT_FONT_PATHS,
  layoutFieldErrors,
  layoutLeafValue,
  layoutRangeValue,
  layoutToForm,
  MAX_GAUGE_STEPS,
  numberConstraints,
  optionSlots,
  optionalLabel,
  parseLayoutFields,
  parseLiteralText,
  parseTraceFields,
  placeholderKind,
  readSegments,
  removeNestedObject,
  sameJsonValue,
  serializeLayoutFields,
  serializeTraceFields,
  setLayoutPath,
  setPath,
  swatchColor,
  switchTraceType,
  titleText,
  traceErrors,
  traceSummary,
  traceToForm,
  unrepresentedLayoutKeys,
  unrepresentedTraceKeys,
  writeSegments,
} from '@/utils/traceFields'

/**
 * Contract tests for the workbench's trace/layout form schema.
 *
 * The manifest stays the source of truth: these tests pin lossless round-trips
 * of the shipped examples, the "drop only inapplicable keys on a type switch"
 * rule, slot availability, and the unknown-key reporting the UI renders.
 */

type Manifest = { traces: Record<string, unknown>[]; layout?: Record<string, unknown> }
const parse = (raw: string) => JSON.parse(raw) as Manifest

const dumbbell = parse(dumbbellRaw)
const kpiGauge = parse(kpiGaugeRaw)
const facetGrid = parse(facetGridRaw)
const bullet = parse(bulletRaw)
const flowSankey = parse(flowSankeyRaw)

const EXAMPLES: [string, Manifest][] = [
  ['bubble', parse(bubbleRaw)],
  ['bullet', parse(bulletRaw)],
  ['colors-grid', parse(colorsGridRaw)],
  ['dumbbell', parse(dumbbellRaw)],
  ['facet-grid', parse(facetGridRaw)],
  ['flow-sankey', parse(flowSankeyRaw)],
  ['kpi-gauge', parse(kpiGaugeRaw)],
  ['lollipop', parse(lollipopRaw)],
  ['series-line', parse(seriesLineRaw)],
]

function formWith(mutate: (form: ManifestForm) => void): ManifestForm {
  const form = emptyManifest()
  mutate(form)
  return form
}

describe('trace round-trip', () => {
  it('reproduces every trace of examples/charts/dumbbell.json exactly', () => {
    for (const trace of dumbbell.traces) {
      const state = traceToForm(trace)
      // Key order is carried over: `type` first, everything else as written.
      expect(JSON.stringify(formToTrace(state))).toBe(JSON.stringify(trace))
    }
  })

  it('round-trips every shipped example trace', () => {
    for (const [name, manifest] of EXAMPLES) {
      for (const trace of manifest.traces) {
        expect(JSON.stringify(formToTrace(traceToForm(trace))), name).toBe(
          JSON.stringify(trace),
        )
      }
    }
  })

  it('is fully representable: no example trace reports an unsupported key', () => {
    for (const [name, manifest] of EXAMPLES) {
      for (const trace of manifest.traces) {
        const state = traceToForm(trace)
        expect(unrepresentedTraceKeys(state.type, state.fields), name).toEqual([])
      }
    }
  })

  it('tolerates junk and keeps an unknown type verbatim', () => {
    expect(traceToForm(null)).toEqual({ type: 'scatter', fields: {} })
    expect(traceToForm({ type: 'pie', x: '$x' })).toEqual({
      type: 'pie',
      fields: { x: '$x' },
    })
  })

  it('parses and serializes the JSON body like manifestForm does', () => {
    expect(parseTraceFields('')).toEqual({ fields: {} })
    expect(parseTraceFields('{"x": "$x"}')).toEqual({ fields: { x: '$x' } })
    expect(parseTraceFields('[1, 2]').error).toBe('must be a JSON object')
    expect(parseTraceFields('{"x": ').error).toBeTruthy()
    expect(serializeTraceFields({})).toBe('')
    expect(JSON.parse(serializeTraceFields({ x: '$x' }))).toEqual({ x: '$x' })
  })
})

describe('indicator gauge steps', () => {
  it('survives an edit of one field', () => {
    const trace = kpiGauge.traces[0]
    const state = traceToForm(trace)
    const gauge = state.fields.gauge as Record<string, unknown>

    const edited = formToTrace({ ...state, fields: setPath(state.fields, 'gauge.bar.color', '#111827') })

    expect(Object.keys(edited)).toEqual(Object.keys(trace))
    expect(edited.mode).toBe(trace.mode)
    expect(edited.value).toBe('$total')
    expect((edited.gauge as Record<string, unknown>).steps).toEqual(gauge.steps)
    expect((edited.gauge as Record<string, unknown>).axis).toEqual(gauge.axis)
    expect((edited.gauge as Record<string, unknown>).bar).toEqual({ color: '#111827' })
  })

  it('keeps the steps list when a sibling is removed', () => {
    const state = traceToForm(kpiGauge.traces[0])
    const edited = setPath(state.fields, 'gauge.bar', undefined)
    const gauge = edited.gauge as Record<string, unknown>
    expect(gauge.bar).toBeUndefined()
    expect(Array.isArray(gauge.steps)).toBe(true)
    expect((gauge.steps as unknown[]).length).toBe(3)
    expect(gauge.axis).toBeDefined()
  })

  it('setPath creates missing intermediates and deletes at the leaf', () => {
    expect(setPath({}, 'gauge.bar.color', 'red')).toEqual({ gauge: { bar: { color: 'red' } } })
    expect(setPath({ marker: { color: '#fff' } }, 'marker.color', undefined)).toEqual({})
    expect(setPath({ a: { b: 1 } }, 'a.b', undefined)).toEqual({})
    expect(setPath({ a: 1 }, 'b', 2)).toEqual({ a: 1, b: 2 })
  })
})

describe('type switching', () => {
  it('drops only keys the new type rejects', () => {
    const scatter = traceToForm(dumbbell.traces[0])
    const result = switchTraceType(scatter, 'bar')
    expect(result.dropped).toEqual(['segments'])
    expect(result.state.type).toBe('bar')
    expect(Object.keys(result.state.fields)).toEqual(['mode', 'showlegend', 'line'])

    const indicator = switchTraceType(traceToForm(kpiGauge.traces[0]), 'bar')
    expect(indicator.dropped.sort()).toEqual(['gauge', 'value'])
    expect(indicator.state.fields).toEqual({ mode: 'gauge+number' })

    const sankey = switchTraceType(traceToForm(flowSankey.traces[0]), 'bar')
    expect(sankey.dropped.sort()).toEqual([
      'arrangement',
      'link',
      'node',
      'source',
      'target',
    ])
    // `values` is a generic data key; only the sankey-only keys go.
    expect(sankey.state.fields).toEqual({ values: '$total' })
  })

  it('keeps everything when the type does not change', () => {
    const state = traceToForm(dumbbell.traces[1])
    const result = switchTraceType(state, 'scatter')
    expect(result.dropped).toEqual([])
    expect(result.state).toBe(state)
  })

  it('mirrors the validator’s per-type rejections', () => {
    expect(isApplicableKey('indicator', 'value')).toBe(true)
    expect(isApplicableKey('bar', 'value')).toBe(false)
    expect(isApplicableKey('sankey', 'source')).toBe(true)
    expect(isApplicableKey('bar', 'source')).toBe(false)
    expect(isApplicableKey('scatter', 'segments')).toBe(true)
    expect(isApplicableKey('bar', 'segments')).toBe(false)
    expect(isApplicableKey('histogram', 'splitBy')).toBe(true)
    expect(isApplicableKey('waterfall', 'splitBy')).toBe(false)
    expect(isApplicableKey('indicator', 'title')).toBe(true)
    expect(isApplicableKey('bar', 'title')).toBe(false)
    expect(isApplicableKey('indicator', 'values')).toBe(false)
    expect(isApplicableKey('bar', 'values')).toBe(true)
  })

  it('offers the data keys each type consumes', () => {
    expect(dataKeysFor('scatter')).toEqual(['x', 'y', 'z', 'labels', 'values'])
    expect(dataKeysFor('indicator')).toEqual(['value'])
    expect(dataKeysFor('sankey')).toEqual(['source', 'target', 'values'])
  })
})

describe('unknown keys', () => {
  it('are preserved and reported', () => {
    const trace = {
      type: 'bar',
      x: '$x',
      y: '$y0',
      wobble: 3,
      marker: { color: '#94a3b8', autocolorscale: true },
      title: { text: 'nope' },
    }
    const state = traceToForm(trace)
    expect(unrepresentedTraceKeys(state.type, state.fields)).toEqual([
      'wobble',
      'marker.autocolorscale',
      'title',
    ])
    // Preservation is the point: the round-trip is byte-identical.
    expect(JSON.stringify(formToTrace(state))).toBe(JSON.stringify(trace))
  })

  it('reports hand-written keys a type rejects instead of hiding them', () => {
    const state = traceToForm({ type: 'waterfall', splitBy: '$color', segments: { x: '$x' } })
    expect(unrepresentedTraceKeys(state.type, state.fields).sort()).toEqual([
      'segments',
      'splitBy',
    ])
  })

  it('reports step-level keys inside gauge.steps', () => {
    const state = traceToForm({
      type: 'indicator',
      gauge: { steps: [{ range: [0, 1], color: 'red', label: 'x' }] },
    })
    expect(unrepresentedTraceKeys(state.type, state.fields)).toEqual(['gauge.steps[0].label'])
  })
})

describe('segments', () => {
  it('reads the shipped segments object', () => {
    const state = traceToForm(dumbbell.traces[0])
    expect(readSegments(state.fields)).toEqual({
      x: '$x',
      from: '$y0',
      to: '$y1',
      horizontal: false,
    })
  })

  it('omits the default horizontal flag when writing', () => {
    expect(fieldsToSegments({ x: '$x', from: '$y0', to: '$y1', horizontal: false })).toEqual({
      x: '$x',
      from: '$y0',
      to: '$y1',
    })
    expect(fieldsToSegments({ x: '$x', from: '$y0', to: '$y1', horizontal: true })).toEqual({
      x: '$x',
      from: '$y0',
      to: '$y1',
      horizontal: true,
    })
  })

  it('replaces x/y on the way in and leaves them alone on the way out', () => {
    const withSegments = writeSegments(
      { x: '$x', y: '$y0', showlegend: false },
      { x: '$x', from: '$y0', to: '$y1', horizontal: false },
    )
    expect(withSegments).toEqual({
      showlegend: false,
      segments: { x: '$x', from: '$y0', to: '$y1' },
    })
    expect(writeSegments(withSegments, null)).toEqual({ showlegend: false })
  })
})

describe('slots', () => {
  it('follows the declared channels and yFields.mode', () => {
    expect(availableSlots(emptyManifest())).toEqual(['$x', '$y0', '$index', '$count'])

    const ranged = formWith((form) => {
      form.yMode = 'range'
      form.channels.color.enabled = true
    })
    expect(availableSlots(ranged)).toEqual([
      '$x',
      '$y0',
      '$y1',
      '$color',
      '$index',
      '$count',
    ])

    const multi = formWith((form) => {
      form.yMode = 'multi'
    })
    expect(availableSlots(multi)).toEqual([
      '$x',
      '$y0',
      '$y1',
      '$y2',
      '$y3',
      '$y4',
      '$index',
      '$count',
    ])

    const none = formWith((form) => {
      form.yMode = 'none'
    })
    expect(availableSlots(none)).toEqual(['$x', '$index', '$count'])
  })

  it('follows the transform pipeline', () => {
    const grouped = formWith((form) => {
      form.channels.color.enabled = true
      form.transforms = [
        {
          op: 'group_agg',
          slots: '',
          by: '',
          descending: false,
          count: '',
          from: 'top',
          groupBy: 'x, color',
          field: 'y0',
          agg: 'sum',
          as: 'total',
        },
      ]
    })
    expect(availableSlots(grouped)).toEqual(['$x', '$color', '$index', '$count', '$total'])

    grouped.transforms.push({
      op: 'cumulate',
      slots: '',
      by: '',
      descending: false,
      count: '',
      from: 'top',
      groupBy: '',
      field: 'total',
      agg: 'sum',
      as: 'running',
    })
    expect(availableSlots(grouped)).toContain('$running')

    grouped.transforms.push({
      op: 'reduce',
      slots: '',
      by: '',
      descending: false,
      count: '',
      from: 'top',
      groupBy: '',
      field: 'running',
      agg: 'sum',
      as: 'final',
    })
    expect(availableSlots(grouped)).toEqual(['$index', '$count', '$final'])
  })

  it('derives label / array / option slot families', () => {
    expect(labelSlots(['$x', '$y0', '$color', '$size', '$index', '$count'])).toEqual([
      '$x.label',
      '$y0.label',
      '$color.label',
    ])
    expect(arrayValueSlots(['$x', '$y0'])).toEqual(['$x.values', '$y0.values'])
    expect(
      optionSlots([
        { key: 'width', type: 'number', default: '2', labelZh: '', labelEn: '', choices: '' },
        { key: ' ', type: 'text', default: '', labelZh: '', labelEn: '', choices: '' },
      ]),
    ).toEqual(['$opt.width'])
  })
})

describe('layout', () => {
  it('round-trips the layout of examples/charts/facet-grid.json', () => {
    expect(formToLayout(layoutToForm(facetGrid.layout))).toEqual(facetGrid.layout)
    expect(JSON.stringify(formToLayout(layoutToForm(facetGrid.layout)))).toBe(
      JSON.stringify(facetGrid.layout),
    )
  })

  it('round-trips every shipped example layout', () => {
    for (const [name, manifest] of EXAMPLES) {
      const layout = manifest.layout ?? {}
      expect(formToLayout(layoutToForm(layout)), name).toEqual(layout)
      // Byte-identical: a form pass must not reorder or re-serialize a key.
      expect(JSON.stringify(formToLayout(layoutToForm(layout))), name).toBe(
        JSON.stringify(layout),
      )
    }
  })

  it('keeps a nested key the form cannot represent and reports it', () => {
    const layout = bullet.layout ?? {}
    expect(unrepresentedLayoutKeys(layout)).toEqual(['yaxis.automargin'])
    expect(formToLayout(layoutToForm(layout))).toEqual(layout)
  })

  it('reports unknown top-level and nested keys', () => {
    expect(
      unrepresentedLayoutKeys({
        template: 'plotly_white',
        xaxis: { gridcolor: '#eee', automargin: true, title: { text: 'x', font: { size: 9 } } },
        margin: { l: 1, pad: 4 },
        legend: { orientation: 'h', font: { size: 9 } },
        title: { text: 't', font: { size: 9 } },
        polar: { bgcolor: '#fff', hole: 0.2 },
      }),
    ).toEqual(['template', 'xaxis.automargin'])
  })

  it('parses/serializes layout text through the same field codec', () => {
    expect(parseLayoutFields('').fields).toEqual({})
    expect(parseLayoutFields('[]').error).toBe('must be a JSON object')
    expect(serializeLayoutFields({})).toBe('')
    expect(JSON.parse(serializeLayoutFields({ showlegend: false }))).toEqual({
      showlegend: false,
    })
  })

  it('reads a title written as a bare string or an object', () => {
    expect(titleText('hello')).toBe('hello')
    expect(titleText({ text: 'hello', font: { size: 9 } })).toBe('hello')
    expect(titleText(undefined)).toBe('')
  })
})

describe('helpers', () => {
  it('keeps a literal readable and a slot-looking string a slot', () => {
    expect(parseLiteralText('12', true)).toBe(12)
    expect(parseLiteralText('not-a-number', true)).toBe('not-a-number')
    expect(parseLiteralText('#94a3b8', false)).toBe('#94a3b8')
    expect(parseLiteralText('[1, 2]', false)).toEqual([1, 2])
    expect(parseLiteralText('true', false)).toBe(true)
    expect(parseLiteralText('', false)).toBe('')
  })

  it('compares JSON values without caring about key order', () => {
    expect(sameJsonValue({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true)
    expect(sameJsonValue({ a: 1 }, { a: 2 })).toBe(false)
    expect(sameJsonValue([1, 2], [1])).toBe(false)
    expect(sameJsonValue(null, null)).toBe(true)
  })

  it('falls back to plain text for a section heading the locale lacks', () => {
    expect(optionalLabel((key) => key, 'chart.workbench.trace.data', 'Data')).toBe('Data')
    expect(optionalLabel(() => '数据', 'chart.workbench.trace.data', 'Data')).toBe('数据')
  })
})

describe('control metadata', () => {
  it('recognises every colour-valued style path, indexes and all', () => {
    for (const path of [
      'line.color',
      'marker.color',
      'marker.line.color',
      'error_x.color',
      'error_y.color',
      'node.color',
      'link.color',
      'gauge.bar.color',
      'gauge.bgcolor',
      'delta.increasing.color',
      'delta.decreasing.color',
      'title.font.color',
      'number.font.color',
    ]) {
      expect(isColorPath(path), path).toBe(true)
    }
    // A step is indexed in the manifest but one row per control.
    expect(isColorPath('gauge.steps[0].color')).toBe(true)
    expect(isColorPath('gauge.steps[2].color')).toBe(true)
    // Layout colours take the same swatch.
    expect(isColorPath('polar.bgcolor')).toBe(true)
    expect(isColorPath('xaxis.gridcolor')).toBe(true)
    expect(isColorPath('line.width')).toBe(false)
    expect(isColorPath('marker.colorway')).toBe(false)
  })

  it('only offers a swatch for a literal colour', () => {
    // A slot or a list is not something a picker can write back.
    expect(swatchColor('$opt.brand')).toBeNull()
    expect(swatchColor('$x.values')).toBeNull()
    expect(swatchColor(['#fff', '#000'])).toBeNull()
    expect(swatchColor({ color: '#fff' })).toBeNull()
    expect(swatchColor('#FFF')).toBe('#ffffff')
    expect(swatchColor('#abc')).toBe('#aabbcc')
    expect(swatchColor(undefined)).toBe(DEFAULT_SWATCH_COLOR)
    expect(swatchColor('red')).toBe(DEFAULT_SWATCH_COLOR)
  })

  it('gives numeric leaves sane bounds', () => {
    expect(numberConstraints('opacity')).toEqual({ min: 0, max: 1, step: 0.05 })
    expect(numberConstraints('marker.opacity')).toEqual({ min: 0, max: 1, step: 0.05 })
    for (const path of [
      'width',
      'line.width',
      'marker.size',
      'node.pad',
      'node.thickness',
      'gauge.thickness',
      'gauge.bar.thickness',
      'error_x.thickness',
      'error_y.width',
    ]) {
      expect(numberConstraints(path), path).toEqual({ min: 0, step: 1 })
    }
    expect(numberConstraints('margin.t')).toEqual({ step: 1 })
    expect(numberConstraints('xaxis.tickangle')).toEqual({ min: -180, max: 180, step: 1 })
    // Free values keep every literal (a negative delta.reference is valid).
    expect(numberConstraints('delta.reference')).toEqual({ step: 'any' })
    expect(numberConstraints('line.smoothing')).toEqual({ step: 'any' })
  })

  it('suggests a placeholder for the common inputs', () => {
    expect(placeholderKind('opacity', 'styleNumber')).toBe('opacity')
    expect(placeholderKind('marker.opacity', 'arrayStyle')).toBe('opacity')
    expect(placeholderKind('line.color', 'style')).toBe('color')
    expect(placeholderKind('gauge.steps[0].color', 'style')).toBe('color')
    expect(placeholderKind('hovertemplate', 'style')).toBe('hovertemplate')
    expect(placeholderKind('width', 'styleNumber')).toBe('number')
    expect(placeholderKind('marker.size', 'arrayStyle')).toBe('number')
    expect(placeholderKind('name', 'text')).toBeNull()
  })

  it('treats an array slot with a numeric literal as a number input', () => {
    expect(isNumericArrayPath('marker.size')).toBe(true)
    expect(isNumericArrayPath('marker.opacity')).toBe(true)
    expect(isNumericArrayPath('marker.color')).toBe(false)
  })
})

describe('nested object editing', () => {
  it('adds an empty object once and removes the whole object again', () => {
    expect(addNestedObject({}, 'marker.line')).toEqual({ marker: { line: {} } })
    // Existing fields are never overwritten by a second "add".
    const filled = { marker: { line: { color: '#fff' } } }
    expect(addNestedObject(filled, 'marker.line')).toBe(filled)
    expect(removeNestedObject(addNestedObject({}, 'marker.line'), 'marker.line')).toEqual({})
    // Removing the last child prunes the empty parents too.
    expect(removeNestedObject({ marker: { line: {} } }, 'marker.line')).toEqual({})
  })

  it('appends a gauge step row and caps the list at ten', () => {
    expect(appendGaugeStep(undefined)).toEqual([
      { range: [0, 0], color: DEFAULT_SWATCH_COLOR },
    ])
    const two = appendGaugeStep([{ range: [0, 1], color: '#fff' }])
    expect(two).toHaveLength(2)
    expect(two[1]).toEqual({ range: [0, 0], color: DEFAULT_SWATCH_COLOR })
    // Appending must not alias the seed row into the manifest.
    expect((two[1] as { range: number[] }).range).not.toBe(
      (appendGaugeStep(undefined)[0] as { range: number[] }).range,
    )
    const full = Array.from({ length: MAX_GAUGE_STEPS }, () => ({ range: [0, 1] }))
    expect(appendGaugeStep(full)).toHaveLength(MAX_GAUGE_STEPS)
    expect(appendGaugeStep(full)).toEqual(full)
  })

  it('keeps hand-written step fields when a sibling is edited', () => {
    const steps = [{ range: [0, 1], color: 'red', label: 'x' }]
    const edited = setPath({ gauge: { steps } }, 'gauge.steps', [
      { ...steps[0], color: '#111827' },
    ])
    expect(edited).toEqual({
      gauge: { steps: [{ range: [0, 1], color: '#111827', label: 'x' }] },
    })
  })
})

describe('trace card summary', () => {
  it('names what the trace draws', () => {
    expect(traceSummary('scatter', { x: '$x', y: '$y0' })).toBe('scatter · $x × $y0')
    expect(traceSummary('bar', { x: '$x', y: '$y1' })).toBe('bar · $x × $y1')
    expect(traceSummary('scatter', { segments: { x: '$x', from: '$y0', to: '$y1' } })).toBe(
      'scatter · $x $y0 → $y1',
    )
    expect(traceSummary('indicator', { value: '$total' })).toBe('indicator · $total')
    expect(traceSummary('sankey', { source: '$source', target: '$target' })).toBe(
      'sankey · $source → $target',
    )
    expect(traceSummary('scatter', {})).toBe('scatter · —')
  })

  it('summarises the shipped examples', () => {
    expect(traceSummary('scatter', traceToForm(dumbbell.traces[0]).fields)).toBe(
      'scatter · $x $y0 → $y1',
    )
    expect(traceSummary('scatter', traceToForm(dumbbell.traces[1]).fields)).toBe(
      'scatter · $x × $y0',
    )
    expect(traceSummary('indicator', traceToForm(kpiGauge.traces[0]).fields)).toBe(
      'indicator · $total',
    )
    expect(traceSummary('sankey', traceToForm(flowSankey.traces[0]).fields)).toBe(
      'sankey · $source → $target',
    )
  })
})

describe('per-field validation', () => {
  const problems = [
    { path: 'traces[0]', message: 'mutually exclusive' },
    { path: 'traces[0].json', message: 'bad json' },
    { path: 'traces[0].type', message: 'bad type' },
    { path: 'traces[1].marker.color', message: 'bad colour' },
    { path: 'traces[1].gauge.steps[0].color', message: 'bad step' },
    { path: 'layout.xaxis.title', message: 'bad title' },
    { path: 'layout.margin.l', message: 'bad margin' },
    { path: 'channels.x.types', message: 'bad types' },
  ]

  it('splits problems down to one trace', () => {
    expect(traceErrors(problems, 0)).toEqual({
      trace: 'mutually exclusive',
      json: 'bad json',
      type: 'bad type',
      fields: {},
    })
    expect(traceErrors(problems, 1)).toEqual({
      fields: {
        'marker.color': 'bad colour',
        'gauge.steps[0].color': 'bad step',
      },
    })
    // Nothing for a trace the backend did not blame.
    expect(traceErrors(problems, 2)).toEqual({ fields: {} })
  })

  it('strips the layout prefix and keeps a layout-level problem apart', () => {
    expect(layoutFieldErrors(problems)).toEqual({
      'xaxis.title': 'bad title',
      'margin.l': 'bad margin',
    })
    expect(layoutFieldErrors([{ path: 'layout', message: 'must be an object' }])).toEqual({
      '': 'must be an object',
    })
    // A channel problem stays a section-level dot.
    expect(layoutFieldErrors(problems)['channels.x.types']).toBeUndefined()
  })

  it('finds the problem a control writes at a finer leaf', () => {
    const errors = {
      'xaxis.title': 'bad title',
      'xaxis.range[1]': 'bad range',
      'marker.color': 'bad colour',
    }
    // The title control writes `title.text`; the backend blames `title`.
    expect(errorAtPath(errors, 'xaxis.title.text')).toBe('bad title')
    // The pair control is the whole range; the backend blames one item.
    expect(errorAtPath(errors, 'xaxis.range')).toBe('bad range')
    expect(errorAtPath(errors, 'marker.color')).toBe('bad colour')
    expect(errorAtPath(errors, 'marker.size')).toBeUndefined()
    // The steps list is the only control for an indexed step problem.
    expect(errorAtPath({ 'gauge.steps[2].color': 'bad step' }, 'gauge.steps')).toBe('bad step')
  })
})

describe('layout core set', () => {
  it('renders every core control without writing a key', () => {
    const fresh = layoutToForm({})
    expect(fresh.fields).toEqual({})
    expect(serializeLayoutFields(fresh.fields)).toBe('')
    for (const path of LAYOUT_FIELD_PATHS) {
      expect(getPath(fresh.fields, path), path).toBeUndefined()
    }
    // Opening a fresh manifest must not mark it dirty.
    expect(JSON.stringify(formToLayout(fresh))).toBe('{}')
  })

  it('surfaces the full set for a converted chart with empty axes', () => {
    const converted = layoutToForm({ xaxis: {}, yaxis: {} })
    expect(formToLayout(converted)).toEqual({ xaxis: {}, yaxis: {} })
    // Explicitly-empty axes are not "unsupported keys" the notice should list.
    expect(unrepresentedLayoutKeys(converted.fields)).toEqual([])
    // …and the untouched defaults still read as absent.
    expect(getPath(converted.fields, 'xaxis.title.text')).toBeUndefined()
    expect(getPath(converted.fields, 'margin.l')).toBeUndefined()
  })

  it('deletes a key instead of writing an empty value', () => {
    expect(layoutLeafValue('')).toBeUndefined()
    expect(layoutLeafValue(undefined)).toBeUndefined()
    // Falsy but meaningful values survive.
    expect(layoutLeafValue(0)).toBe(0)
    expect(layoutLeafValue(false)).toBe(false)
    expect(layoutLeafValue('bottom')).toBe('bottom')

    expect(
      setPath({ xaxis: { title: { text: 'x' } } }, 'xaxis.title.text', layoutLeafValue('')),
    ).toEqual({})
    expect(setPath({ showlegend: false }, 'showlegend', layoutLeafValue(0))).toEqual({
      showlegend: 0,
    })

    expect(layoutRangeValue('', '')).toBeUndefined()
    expect(layoutRangeValue(undefined, undefined)).toBeUndefined()
    expect(layoutRangeValue('', 5)).toEqual(['', 5])
    expect(layoutRangeValue(0, 0)).toEqual([0, 0])
  })
})

describe('layout nested fonts and scalars', () => {
  it('keeps every new control in the always-rendered core set', () => {
    const paths: readonly string[] = LAYOUT_FIELD_PATHS
    for (const parent of LAYOUT_FONT_PATHS) {
      for (const leaf of ['family', 'size', 'color']) {
        expect(paths).toContain(`${parent}.${leaf}`)
      }
    }
    for (const path of [
      'xaxis.tickformat',
      'yaxis.tickformat',
      'margin.pad',
      'polar.hole',
    ]) {
      expect(paths).toContain(path)
    }
    // A fresh manifest still reads every new control as absent.
    const fresh = layoutToForm({})
    for (const path of paths) {
      expect(getPath(fresh.fields, path), path).toBeUndefined()
    }
  })

  it('sets a nested leaf and prunes every empty parent when it is cleared', () => {
    expect(setLayoutPath({}, 'title.font.family', 'Inter')).toEqual({
      title: { font: { family: 'Inter' } },
    })
    expect(
      setLayoutPath({ title: { font: { family: 'Inter' } } }, 'title.font.family', undefined),
    ).toEqual({})
    // Siblings survive; only the emptied branch goes.
    expect(
      setLayoutPath(
        { title: { text: 'Sales', font: { family: 'Inter', size: 14 } } },
        'title.font.size',
        undefined,
      ),
    ).toEqual({ title: { text: 'Sales', font: { family: 'Inter' } } })
    // An explicitly empty parent is pruned as well.
    expect(setLayoutPath({ title: {} }, 'title.font.size', undefined)).toEqual({})
    // Removing the third and last leaf removes `font` and then the axis.
    expect(
      setLayoutPath(
        { showlegend: false, yaxis: { tickfont: { color: '#111827' } } },
        'yaxis.tickfont.color',
        undefined,
      ),
    ).toEqual({ showlegend: false })
  })

  it('keeps a bare-string title when editing a child of it', () => {
    expect(setLayoutPath({ title: 'Sales' }, 'title.font.size', 14)).toEqual({
      title: { text: 'Sales', font: { size: 14 } },
    })
    expect(
      setLayoutPath({ yaxis: { title: 'Revenue' } }, 'yaxis.title.font.color', '#111827'),
    ).toEqual({ yaxis: { title: { text: 'Revenue', font: { color: '#111827' } } } })
  })

  it('keeps tickformat a string, never a number', () => {
    for (const [axis, format] of [
      ['xaxis', '.2f'],
      ['yaxis', '%Y-%m'],
    ] as const) {
      const next = setLayoutPath({}, `${axis}.tickformat`, format)
      expect(next).toEqual({ [axis]: { tickformat: format } })
      expect(typeof getPath(next, `${axis}.tickformat`)).toBe('string')
    }
    // A numeric-looking format is still text: Plotly reads it as a pattern.
    const numeric = setLayoutPath({}, 'xaxis.tickformat', '0.5')
    expect(getPath(numeric, 'xaxis.tickformat')).toBe('0.5')
    expect(typeof getPath(numeric, 'xaxis.tickformat')).toBe('string')
  })

  it('bounds font sizes, margin pad and polar hole', () => {
    for (const parent of LAYOUT_FONT_PATHS) {
      expect(numberConstraints(`${parent}.size`), parent).toEqual({ min: 1, step: 1 })
    }
    expect(numberConstraints('margin.pad')).toEqual({ min: 0, step: 1 })
    expect(numberConstraints('polar.hole')).toEqual({ min: 0, max: 1, step: 0.01 })

    const sized = setLayoutPath({}, 'xaxis.title.font.size', 12)
    expect(getPath(sized, 'xaxis.title.font.size')).toBe(12)
    expect(typeof getPath(sized, 'xaxis.title.font.size')).toBe('number')
  })

  it('no longer reports the structured nested paths as unrepresented', () => {
    const layout = {
      title: { text: 't', font: { family: 'Inter', size: 14, color: '#111827' } },
      legend: { font: { family: 'Inter', size: 12, color: '#334155' } },
      xaxis: {
        tickformat: '%Y-%m',
        title: { text: 'month', font: { family: 'Inter', size: 12, color: '#334155' } },
        tickfont: { family: 'Inter', size: 11, color: '#64748b' },
      },
      yaxis: {
        tickformat: '.2f',
        title: { font: { family: 'Inter', size: 12, color: '#334155' } },
        tickfont: { family: 'Inter', size: 11, color: '#64748b' },
      },
      margin: { l: 40, pad: 4 },
      polar: { bgcolor: '#fff', hole: 0.25 },
    }
    expect(unrepresentedLayoutKeys(layout)).toEqual([])
    expect(formToLayout(layoutToForm(layout))).toEqual(layout)
    // A key inside a font object the form does not show is still named.
    expect(unrepresentedLayoutKeys({ title: { font: { weight: 700 } } })).toEqual([
      'title.font.weight',
    ])
  })
})
