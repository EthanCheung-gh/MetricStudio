import { describe, expect, it } from 'vitest'
import dumbbellRaw from '../../examples/charts/dumbbell.json?raw'
import {
  COMMA_LIST_ERROR,
  CUSTOM_CHART_ID_RE,
  PREVIEW_PLACEHOLDER_ID,
  duplicateChartId,
  emptyManifest,
  formToManifest,
  isValidCustomChartId,
  manifestToForm,
  parseValidationErrors,
  previewEncodingFor,
  previewManifestFor,
  reseedPreviewBindings,
  seedFormFor,
  seedPreviewBindings,
  type ManifestForm,
} from '@/utils/manifestForm'
import type { CustomChartManifest } from '@/types/customChart'

/**
 * Contract tests for the workbench's pure translation layer.
 *
 * The manifest schema lives in the backend; these tests pin the parts the SPA
 * is responsible for: a lossless form round-trip of the shipped examples,
 * tolerant handling of hand-edited JSON, and the error/encoding projections the
 * UI relies on.
 */

const dumbbell = JSON.parse(dumbbellRaw) as CustomChartManifest

/** Every manifest under `examples/charts/` — the backend renders all of them. */
const examples = import.meta.glob('../../examples/charts/*.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function withChannelTypes(form: ManifestForm, key: 'x' | 'color', types: ('quantitative' | 'nominal' | 'temporal')[]) {
  form.channels[key] = { enabled: true, required: true, types }
  return form
}

describe('emptyManifest', () => {
  it('is the minimal skeleton: x channel, yFields one, one scatter trace', () => {
    const form = emptyManifest()
    expect(form.id).toBe('')
    expect(form.yMode).toBe('one')
    expect(form.traces).toEqual([
      { type: 'scatter', json: JSON.stringify({ x: '$x', y: '$y0' }, null, 2) },
    ])

    const { manifest, errors } = formToManifest(form)
    expect(errors).toEqual({})
    expect(manifest.schemaVersion).toBe(1)
    expect(manifest.traces).toEqual([{ type: 'scatter', x: '$x', y: '$y0' }])
    expect(manifest.channels.x).toEqual({ required: true, types: ['nominal'] })
    expect(manifest.channels.yFields).toEqual({ mode: 'one' })
    // Disabled channels are absent, and nothing optional is padded in.
    expect(Object.keys(manifest.channels)).toEqual(['x', 'yFields'])
    expect(manifest.description).toBeUndefined()
    expect(manifest.transforms).toBeUndefined()
    expect(manifest.layout).toBeUndefined()
    expect(manifest.options).toBeUndefined()
    expect(manifest.keywords).toBeUndefined()
    expect(manifest.facetBy).toBeUndefined()
  })

  it('absorbs a partial draft without throwing', () => {
    const form = manifestToForm({ id: 'half', schemaVersion: 1 } as CustomChartManifest)
    expect(form.id).toBe('half')
    expect(form.yMode).toBe('none')
    expect(form.traces).toEqual([])
    expect(form.layout).toBe('')
    expect(form.channels.x.enabled).toBe(false)
  })
})

describe('manifest round-trip', () => {
  it('reproduces examples/charts/dumbbell.json exactly', () => {
    const { manifest, errors } = formToManifest(manifestToForm(dumbbell))
    expect(errors).toEqual({})
    expect(manifest).toEqual(dumbbell)
  })

  it('reproduces every shipped example exactly', () => {
    const paths = Object.keys(examples)
    expect(paths.length).toBeGreaterThanOrEqual(7)
    for (const [path, raw] of Object.entries(examples)) {
      const source = JSON.parse(raw) as CustomChartManifest
      const { manifest, errors } = formToManifest(manifestToForm(source))
      expect(errors, path).toEqual({})
      // Includes manifest-level `facetBy`, which the form must not drop.
      expect(manifest, path).toEqual(source)
    }
  })

  it('drops disabled channels and empty optional collections', () => {
    const form = manifestToForm(dumbbell)
    form.channels.color.enabled = false
    form.keywords = ''
    form.options = []
    form.transforms = []
    form.layout = ''

    const { manifest } = formToManifest(form)
    expect(manifest.channels.color).toBeUndefined()
    expect(manifest.channels.yFields).toEqual({ mode: 'range' })
    expect(manifest.keywords).toBeUndefined()
    expect(manifest.options).toBeUndefined()
    expect(manifest.transforms).toBeUndefined()
    expect(manifest.layout).toBeUndefined()
  })

  it('parses JSON textareas back into objects', () => {
    const form = emptyManifest()
    form.layout = '{"showlegend": false}'
    form.traces = [{ type: 'bar', json: '{"x": "$x", "width": 0.4}' }]

    const { manifest, errors } = formToManifest(form)
    expect(errors).toEqual({})
    expect(manifest.layout).toEqual({ showlegend: false })
    expect(manifest.traces).toEqual([{ type: 'bar', x: '$x', width: 0.4 }])
  })

  it('reports invalid JSON per field instead of throwing', () => {
    const form = emptyManifest()
    form.traces = [{ type: 'scatter', json: '{"x": ' }]
    form.layout = '[1, 2]'

    const { manifest, errors } = formToManifest(form)
    // The broken section is left out, the rest of the manifest survives.
    expect(manifest.traces).toEqual([{ type: 'scatter' }])
    expect(manifest.layout).toBeUndefined()
    expect(errors['traces[0].json']).toBeTruthy()
    expect(errors.layout).toBe('must be a JSON object')
  })
})

describe('parseValidationErrors', () => {
  it('splits the backend detail and tags each message with its section', () => {
    const detail = [
      "channels.yFields.mode: must be one of none, one, range, multi",
      "transforms[0].by: is required",
      "traces[0].type: unsupported trace type 'pie' (allowed: scatter, bar, box, violin, waterfall, funnel, indicator, histogram, sankey)",
      'layout.template: is not an allowed layout key (allowed: showlegend, barmode, margin, xaxis, yaxis, legend, hovermode, polar, title)',
      'options[0].key: must match ^[a-z][a-zA-Z0-9_]{0,23}$',
    ].join('; ')

    expect(parseValidationErrors(detail)).toEqual([
      { path: 'channels.yFields.mode', message: 'must be one of none, one, range, multi', section: 'channels' },
      { path: 'transforms[0].by', message: 'is required', section: 'transforms' },
      {
        path: 'traces[0].type',
        message:
          "unsupported trace type 'pie' (allowed: scatter, bar, box, violin, waterfall, funnel, indicator, histogram, sankey)",
        section: 'traces',
      },
      {
        path: 'layout.template',
        message:
          'is not an allowed layout key (allowed: showlegend, barmode, margin, xaxis, yaxis, legend, hovermode, polar, title)',
        section: 'layout',
      },
      {
        path: 'options[0].key',
        message: 'must match ^[a-z][a-zA-Z0-9_]{0,23}$',
        section: 'options',
      },
    ])
  })

  it('keeps path-less whole-manifest failures in the manifest section', () => {
    expect(parseValidationErrors('manifest must be a JSON object')).toEqual([
      { path: '', message: 'manifest must be a JSON object', section: 'manifest' },
    ])
  })

  it('maps a bare "channels" complaint to the channels section', () => {
    const [problem] = parseValidationErrors(
      'channels: declare at least one channel or a yFields mode other than "none"',
    )
    expect(problem.section).toBe('channels')
    expect(problem.path).toBe('channels')
  })

  it('keeps an embedded "; " inside one message (indicator arity)', () => {
    const detail =
      "traces[0].value: needs exactly one row after transforms (got 3); add a 'reduce' transform"
    expect(parseValidationErrors(detail)).toEqual([
      {
        path: 'traces[0].value',
        message:
          "needs exactly one row after transforms (got 3); add a 'reduce' transform",
        section: 'traces',
      },
    ])
  })

  it('dots the channels section for a path-less facetBy complaint', () => {
    expect(parseValidationErrors("manifest: 'facetBy' requires a 'color' channel")).toEqual([
      {
        path: 'manifest',
        message: "'facetBy' requires a 'color' channel",
        section: 'channels',
      },
    ])
  })
})

describe('previewEncodingFor', () => {
  const bindings = {
    fields: { x: 'region', color: 'segment' },
    yFields: ['a', 'b', 'c', 'd', 'e', 'f'],
  }
  const columnTypes = { region: 'nominal', a: 'quantitative' } as const

  it('takes 0 / 1 / 2 / up to 5 Y fields from the mode', () => {
    const counts = { none: 0, one: 1, range: 2, multi: 5 } as const
    for (const [mode, expected] of Object.entries(counts)) {
      const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
      form.id = 'my_chart'
      form.yMode = mode as ManifestForm['yMode']
      const encoding = previewEncodingFor(form, bindings, columnTypes)
      expect(encoding.yFields, mode).toHaveLength(expected)
      if (expected > 0) expect(encoding.yFields[0]).toEqual({ field: 'a', type: 'quantitative', axis: 'left', normalize: 'none' })
    }
  })

  it('binds only declared channels and keeps the manifest id as chartType', () => {
    const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
    form.id = 'my_chart'
    // `color` is bound but not declared, so it must not reach the encoding.
    const encoding = previewEncodingFor(form, bindings, columnTypes)
    expect(encoding.chartType).toBe('my_chart')
    expect(encoding.x).toEqual({ field: 'region', type: 'nominal' })
    expect(encoding.color).toBeUndefined()

    form.channels.color = { enabled: true, required: false, types: [] }
    const withColor = previewEncodingFor(form, bindings, columnTypes)
    // Unknown column types fall back to nominal instead of dropping the binding.
    expect(withColor.color).toEqual({ field: 'segment', type: 'nominal' })
  })

  it('uses the "custom" placeholder while the id is still blank', () => {
    const encoding = previewEncodingFor(emptyManifest(), bindings, columnTypes)
    expect(encoding.chartType).toBe('custom')
  })
})

describe('seedPreviewBindings', () => {
  it('fills the declared channels and the Y slots from the dataset columns', () => {
    const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
    const columns = [
      { name: 'value', inferredType: 'quantitative' },
      { name: 'region', inferredType: 'nominal' },
    ]
    const seeded = seedPreviewBindings(form, { fields: {}, yFields: [] }, columns)
    expect(seeded.fields.x).toBe('region')
    expect(seeded.yFields).toEqual(['value'])
  })

  it('never overwrites an existing binding', () => {
    const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
    const columns = [
      { name: 'region', inferredType: 'nominal' },
      { name: 'value', inferredType: 'quantitative' },
    ]
    const seeded = seedPreviewBindings(
      form,
      { fields: { x: 'region' }, yFields: ['value'] },
      columns,
    )
    expect(seeded.fields.x).toBe('region')
    expect(seeded.yFields).toEqual(['value'])
  })

  it('leaves an explicitly cleared binding cleared', () => {
    const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
    const columns = [{ name: 'region', inferredType: 'nominal' }]
    // The clear button writes `''`, which must win over auto-seeding.
    expect(seedPreviewBindings(form, { fields: { x: '' }, yFields: [] }, columns).fields.x).toBe('')
  })
})

describe('seeding on a mixed-type dataset', () => {
  /**
   * `demo.csv` as the app infers it: a date, two dimensions, five measures and
   * two more dimensions. Dataset order is what a "first free column" seed would
   * follow — which is how `month`/`region` used to land on the Y slots.
   */
  const demo = [
    { name: 'month', inferredType: 'temporal' },
    { name: 'city', inferredType: 'nominal' },
    { name: 'region', inferredType: 'nominal' },
    { name: 'before', inferredType: 'quantitative' },
    { name: 'after', inferredType: 'quantitative' },
    { name: 'sales', inferredType: 'quantitative' },
    { name: 'amount', inferredType: 'quantitative' },
    { name: 'value', inferredType: 'quantitative' },
    { name: 'src', inferredType: 'nominal' },
    { name: 'dst', inferredType: 'nominal' },
  ]
  const dimensionsOnly = demo.filter((column) => column.inferredType !== 'quantitative')

  it('gives a dumbbell two Y slots two measures, not the first columns', () => {
    const form = emptyManifest()
    form.yMode = 'range'
    const seeded = seedPreviewBindings(form, { fields: {}, yFields: [] }, demo)
    expect(seeded.fields.x).toBe('city')
    expect(seeded.yFields).toEqual(['before', 'after'])
  })

  it('prefers a dimension for an unconstrained x', () => {
    const form = withChannelTypes(emptyManifest(), 'x', [])
    const seeded = seedPreviewBindings(form, { fields: {}, yFields: [] }, demo)
    // A measure would render as a meaningless axis; `x` is a dimension first.
    expect(seeded.fields.x).toBe('month')
    expect(seeded.yFields).toEqual(['before'])
  })

  it('binds a declared-nominal color to a nominal column', () => {
    const form = emptyManifest()
    form.channels.color = { enabled: true, required: false, types: ['nominal'] }
    const seeded = seedPreviewBindings(form, { fields: {}, yFields: [] }, demo)
    expect(seeded.fields.x).toBe('city')
    expect(seeded.fields.color).toBe('region')
  })

  it('falls back to the channel default type when it declares none', () => {
    const form = emptyManifest()
    form.channels.color = { enabled: true, required: false, types: [] }
    form.channels.size = { enabled: true, required: false, types: [] }
    const seeded = seedPreviewBindings(form, { fields: {}, yFields: [] }, demo)
    // color is nominal by convention, size is a measure.
    expect(seeded.fields.color).toBe('region')
    expect(seeded.fields.size).toBe('before')
    // Channels claim their column first, so the one y slot takes the next measure.
    expect(seeded.yFields).toEqual(['after'])
  })

  it('leaves the Y slots blank when the dataset has no measure', () => {
    const form = emptyManifest()
    form.yMode = 'range'
    const seeded = seedPreviewBindings(form, { fields: {}, yFields: [] }, dimensionsOnly)
    expect(seeded.fields.x).toBe('city')
    // Nothing usable: the preview shows `chart.workbench.previewEmpty`.
    expect(seeded.yFields).toEqual([])

    // The re-seeding path pads the arity but must not pad it with a dimension.
    expect(reseedPreviewBindings(form, { fields: {}, yFields: [] }, dimensionsOnly).yFields).toEqual(
      ['', ''],
    )
  })

  it('keeps an existing y choice and only fills the free slot', () => {
    const form = emptyManifest()
    form.yMode = 'range'
    const reseeded = reseedPreviewBindings(form, { fields: {}, yFields: ['month'] }, demo)
    expect(reseeded.yFields).toEqual(['month', 'before'])
  })
})

describe('reseedPreviewBindings', () => {
  const columns = [
    { name: 'region', inferredType: 'nominal' },
    { name: 'value', inferredType: 'quantitative' },
    { name: 'extra', inferredType: 'quantitative' },
  ]

  it('drops a binding whose channel the manifest no longer declares', () => {
    const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
    const next = reseedPreviewBindings(
      form,
      { fields: { x: 'region', color: 'region' }, yFields: ['value'] },
      columns,
    )
    expect(next.fields).toEqual({ x: 'region' })
    expect(next.yFields).toEqual(['value'])
  })

  it('fills the Y slots a widened mode asks for and keeps manual choices', () => {
    const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
    form.yMode = 'range'
    const next = reseedPreviewBindings(
      form,
      { fields: { x: 'region' }, yFields: ['value'] },
      columns,
    )
    expect(next.fields.x).toBe('region')
    expect(next.yFields).toEqual(['value', 'extra'])
  })

  it('truncates the Y slots when the mode narrows', () => {
    const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
    const next = reseedPreviewBindings(
      form,
      { fields: {}, yFields: ['value', 'extra'] },
      columns,
    )
    expect(next.yFields).toEqual(['value'])
  })

  it('replaces a column the dataset no longer has', () => {
    const form = withChannelTypes(emptyManifest(), 'x', ['nominal'])
    const next = reseedPreviewBindings(
      form,
      { fields: { x: 'gone' }, yFields: ['value'] },
      columns,
    )
    expect(next.fields.x).toBe('region')
  })
})

describe('previewManifestFor', () => {
  it('previews a blank id under the placeholder, saving keeps it blank-invalid', () => {
    const { manifest } = formToManifest(emptyManifest())
    expect(manifest.id).toBe('')
    // The preview endpoint validates the id, so a blank one would be a 400.
    expect(previewManifestFor(manifest)).toEqual({
      ...manifest,
      id: PREVIEW_PLACEHOLDER_ID,
    })
    // Save posts `manifest` as-is: the placeholder never reaches a file name.
    expect(manifest.id).toBe('')
  })

  it('sends the real id untouched, without mutating the manifest', () => {
    const form = emptyManifest()
    form.id = 'my_chart'
    const { manifest } = formToManifest(form)
    expect(previewManifestFor(manifest)).toBe(manifest)
    expect(manifest.id).toBe('my_chart')
  })
})

describe('comma-separated lists', () => {
  const skeleton = () => {
    const { manifest } = formToManifest(emptyManifest())
    return { ...manifest, id: 'my_chart' }
  }

  it('flags keywords holding an item with a comma instead of splitting it', () => {
    const form = manifestToForm({ ...skeleton(), keywords: ['a,b', 'c'] })
    expect(form.keywords).toBe('a,b, c')
    expect(formToManifest(form).errors.keywords).toBe(COMMA_LIST_ERROR)

    // Rewriting the field resolves the ambiguity.
    form.keywords = 'a b, c'
    const { manifest, errors } = formToManifest(form)
    expect(errors.keywords).toBeUndefined()
    expect(manifest.keywords).toEqual(['a b', 'c'])
  })

  it('flags select choices the same way', () => {
    const form = manifestToForm({
      ...skeleton(),
      options: [
        { key: 'palette', type: 'select', default: 'auto', label: { zh: '', en: '' }, choices: ['auto,x', 'manual'] },
      ],
    })
    expect(form.options[0].choices).toBe('auto,x, manual')
    expect(formToManifest(form).errors['options[0].choices']).toBe(COMMA_LIST_ERROR)
  })

  it('leaves a comma-free list alone', () => {
    const form = manifestToForm({ ...skeleton(), keywords: ['bar', 'ranking'] })
    expect(formToManifest(form).errors).toEqual({})
    expect(formToManifest(form).manifest.keywords).toEqual(['bar', 'ranking'])
  })
})

describe('id helpers', () => {
  it('mirrors the backend id rule', () => {
    expect(CUSTOM_CHART_ID_RE.test('dumbbell')).toBe(true)
    expect(isValidCustomChartId('a1-b_c')).toBe(true)
    expect(isValidCustomChartId('a'.repeat(40))).toBe(true)
    for (const invalid of ['', 'a', 'A', '1abc', 'ab c', 'a'.repeat(41)]) {
      expect(isValidCustomChartId(invalid), invalid).toBe(false)
    }
  })

  it('suggests ids that stay inside the 40-character cap', () => {
    expect(duplicateChartId('dumbbell')).toBe('dumbbell-copy')
    expect(duplicateChartId('')).toBe('')
    const long = duplicateChartId('a'.repeat(40))
    expect(long).toHaveLength(40)
    expect(long.endsWith('-copy')).toBe(true)
    expect(isValidCustomChartId(long)).toBe(true)
  })
})

describe('seedFormFor', () => {
  /** What "从当前图表创建" opens: a converted manifest under a fresh id. */
  const converted: CustomChartManifest = { ...dumbbell, id: 'custom-demo' }

  it('keeps the seed id for an edit session', () => {
    const seeded = seedFormFor({ mode: 'edit', seed: dumbbell })
    expect(seeded.form.id).toBe('dumbbell')
    expect(seeded.suggestedId).toBe('')
    expect(formToManifest(seeded.form).manifest.id).toBe('dumbbell')
  })

  it('blanks the id and still suggests <id>-copy for a duplicate session', () => {
    const seeded = seedFormFor({ mode: 'duplicate', seed: dumbbell })
    expect(seeded.form.id).toBe('')
    expect(seeded.suggestedId).toBe('dumbbell-copy')
    expect(isValidCustomChartId(seeded.suggestedId)).toBe(true)
    // Blank id + suggestion is what makes "另存为副本" write a new file.
    expect(formToManifest(seeded.form).manifest.id).toBe('')
    expect(seeded.form.traces).toEqual(manifestToForm(dumbbell).traces)
  })

  it('keeps the seed id for a new session seeded from a chart', () => {
    const seeded = seedFormFor({ mode: 'new', seed: converted })
    expect(seeded.form.id).toBe('custom-demo')
    expect(seeded.suggestedId).toBe('')
    // The converted id survives the round trip, so preview/save work unedited.
    expect(isValidCustomChartId(seeded.form.id)).toBe(true)
    expect(formToManifest(seeded.form).manifest.id).toBe('custom-demo')
    expect(formToManifest(seeded.form).errors).toEqual({})
  })

  it('opens the empty skeleton for a blank new session', () => {
    expect(seedFormFor({ mode: 'new', seed: null })).toEqual({
      form: emptyManifest(),
      suggestedId: '',
    })
    expect(seedFormFor({ mode: 'new' }).form).toEqual(emptyManifest())
  })

  it('never invents an id without a seed', () => {
    for (const mode of ['new', 'edit', 'duplicate'] as const) {
      const seeded = seedFormFor({ mode, seed: null })
      expect(seeded.form.id, mode).toBe('')
      expect(seeded.suggestedId, mode).toBe('')
    }
  })
})
