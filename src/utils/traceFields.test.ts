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
  arrayValueSlots,
  availableSlots,
  dataKeysFor,
  fieldsToSegments,
  formToLayout,
  formToTrace,
  isApplicableKey,
  labelSlots,
  layoutToForm,
  optionSlots,
  optionalLabel,
  parseLayoutFields,
  parseLiteralText,
  parseTraceFields,
  readSegments,
  sameJsonValue,
  serializeLayoutFields,
  serializeTraceFields,
  setPath,
  switchTraceType,
  titleText,
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
    ).toEqual([
      'template',
      'xaxis.automargin',
      'xaxis.title.font',
      'margin.pad',
      'legend.font',
      'title.font',
      'polar.hole',
    ])
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
