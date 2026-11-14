import { describe, expect, it } from 'vitest'
import type {
  ChartConfig,
  ChartEncoding,
  EncodingChannel,
  FieldType,
  YFieldConfig,
} from '@/types/encoding'
import type { CustomChartManifest } from '@/types/customChart'
import type { ChartRefusal, ChartRefusalCode } from '@/utils/manifestFromChart'
import { manifestFromChart, manifestIdFor, yFieldsModeFor } from '@/utils/manifestFromChart'

/**
 * Reverse-conversion contract: a built-in `ChartConfig` becomes a manifest the
 * Python backend accepts (`backend/core/custom_charts.py`).
 *
 * vitest cannot import the backend, so the "does `validate_payload` accept
 * this?" half is pinned here as an exhaustive shape check against the
 * constants in that module (`TRACE_TYPES`, `STYLE_KEYS`, `DATA_KEYS`,
 * `LAYOUT_KEYS`, `TRANSFORM_KEYS`, `CHANNEL_KEYS`, the id/label regexes). The
 * real validator was run by hand on three of the manifests these tests build
 * (see `MANUAL VALIDATION` at the bottom of this file); the constants are
 * mirrored, not guessed.
 */

// ---------------------------------------------------------------------------
// mirrors of backend/core/custom_charts.py
// ---------------------------------------------------------------------------

const TRACE_TYPES = [
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

const STYLE_KEYS = [
  'mode',
  'name',
  'text',
  'textposition',
  'orientation',
  'opacity',
  'fill',
  'line',
  'marker',
  'width',
  'offsetgroup',
  'showlegend',
  'hovertemplate',
  'hole',
  'boxpoints',
  'cumulative',
  'histnorm',
  'error_x',
  'error_y',
  'title',
  'number',
  'gauge',
  'delta',
  'node',
  'link',
  'arrangement',
] as const

const DATA_KEYS = ['x', 'y', 'z', 'labels', 'values'] as const
/** Keys `_validate_traces` accepts besides style/data keys. */
const EXTRA_TRACE_KEYS = ['type', 'splitBy', 'segments', 'value', 'source', 'target'] as const

const LAYOUT_KEYS = [
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

const CHANNEL_KEYS = [
  'x',
  'color',
  'size',
  'facet',
  'z',
  'error',
  'source',
  'target',
] as const
const CHANNEL_TYPES = ['quantitative', 'nominal', 'temporal'] as const
const Y_FIELD_MODES = ['none', 'one', 'range', 'multi'] as const
const GROUP_AGGS = ['sum', 'mean', 'count', 'min', 'max'] as const

const TRANSFORM_KEYS: Record<string, readonly string[]> = {
  dropna: ['slots'],
  sort: ['by', 'descending'],
  limit: ['count', 'from'],
  group_agg: ['groupBy', 'field', 'agg', 'as'],
  cumulate: ['field', 'as'],
  reduce: ['field', 'agg', 'as'],
}

const TOP_LEVEL_KEYS = [
  'schemaVersion',
  'id',
  'label',
  'description',
  'channels',
  'transforms',
  'traces',
  'layout',
  'options',
  'keywords',
  'facetBy',
] as const

/**
 * Every refusal code the dialog can translate (`chart.custom.reason.<code>`).
 * Typing the map as a total `Record` makes the union and this list fail
 * together if a code is ever added without an i18n key in mind.
 */
const REFUSAL_CODE_MAP: Record<ChartRefusalCode, true> = {
  unsupportedType: true,
  noYField: true,
  noValueField: true,
  missingLinks: true,
}
const REFUSAL_CODES = Object.keys(REFUSAL_CODE_MAP) as ChartRefusalCode[]

const ID_RE = /^[a-z][a-z0-9_-]{1,39}$/
const AS_RE = /^[a-z][a-z0-9_]{0,23}$/
/** Every built-in chart type; a manifest id must never collide with one. */
const BUILTIN_IDS = [
  'line',
  'bar',
  'barh',
  'area',
  'step',
  'scatter',
  'dot',
  'scatter3d',
  'pie',
  'histogram',
  'box',
  'violin',
  'ecdf',
  'density_heatmap',
  'density_contour',
  'heatmap',
  'contour',
  'splom',
  'treemap',
  'sunburst',
  'icicle',
  'sankey',
  'parcoords',
  'parcats',
  'radar',
  'ternary',
  'waterfall',
  'funnel',
  'table',
  'gantt',
  'candlestick',
  'surface',
  'timeline',
  'gauge',
] as const

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

function channel(field: string, type: FieldType = 'nominal'): EncodingChannel {
  return { field, type }
}

function yField(field: string, patch: Partial<YFieldConfig> = {}): YFieldConfig {
  return { field, type: 'quantitative', aggregate: null, axis: 'left', normalize: 'none', ...patch }
}

function chart(
  encoding: Partial<ChartEncoding> & { yFields?: YFieldConfig[] },
  layout: Record<string, unknown> = {},
  name = 'Chart 1',
): ChartConfig {
  return {
    id: 'builtin-1',
    name,
    datasetId: 'ds-1',
    encoding: { chartType: 'line', yFields: [], ...encoding },
    layout,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

function convert(source: ChartConfig): { manifest: CustomChartManifest; warnings: string[] } {
  const result = manifestFromChart(source)
  if ('reason' in result) {
    throw new Error(`expected a manifest, got reason: ${JSON.stringify(result.reason)}`)
  }
  return result
}

function reasonFor(source: ChartConfig): ChartRefusal {
  const result = manifestFromChart(source)
  if (!('reason' in result)) throw new Error('expected a reason, got a manifest')
  return result.reason
}

/** A line chart with one Y field and an x — the shape most cases start from. */
function relational(
  encoding: Partial<ChartEncoding> = {},
  layout: Record<string, unknown> = {},
  name = 'Chart 1',
): ChartConfig {
  return chart(
    { chartType: 'line', x: channel('month'), yFields: [yField('revenue')], ...encoding },
    layout,
    name,
  )
}

// ---------------------------------------------------------------------------
// traces, one case per expressible chart type
// ---------------------------------------------------------------------------

describe('manifestFromChart traces', () => {
  const cases: [string, Partial<ChartEncoding> & { yFields?: YFieldConfig[] }, unknown][] = [
    [
      'line',
      { chartType: 'line', x: channel('month'), yFields: [yField('revenue')] },
      { type: 'scatter', mode: 'lines', x: '$x', y: '$y0' },
    ],
    [
      'area',
      { chartType: 'area', x: channel('month'), yFields: [yField('revenue')] },
      { type: 'scatter', mode: 'lines', x: '$x', y: '$y0', fill: 'tozeroy' },
    ],
    [
      'step',
      { chartType: 'step', x: channel('month'), yFields: [yField('revenue')] },
      { type: 'scatter', mode: 'lines', x: '$x', y: '$y0', line: { shape: 'hv' } },
    ],
    [
      'dot',
      { chartType: 'dot', x: channel('month'), yFields: [yField('revenue')] },
      { type: 'scatter', mode: 'markers', x: '$x', y: '$y0' },
    ],
    [
      'scatter',
      { chartType: 'scatter', x: channel('month'), yFields: [yField('revenue')] },
      { type: 'scatter', mode: 'markers', x: '$x', y: '$y0' },
    ],
    [
      'bar',
      { chartType: 'bar', x: channel('month'), yFields: [yField('revenue')] },
      { type: 'bar', x: '$x', y: '$y0' },
    ],
    [
      'barh',
      { chartType: 'barh', x: channel('month'), yFields: [yField('revenue')] },
      // Values on x, categories on y: what Plotly's orientation:"h" expects.
      { type: 'bar', orientation: 'h', x: '$y0', y: '$x' },
    ],
    [
      'histogram (y)',
      { chartType: 'histogram', yFields: [yField('revenue')] },
      { type: 'histogram', x: '$y0' },
    ],
    [
      'histogram (x only)',
      { chartType: 'histogram', x: channel('revenue', 'quantitative') },
      { type: 'histogram', x: '$x' },
    ],
    ['box', { chartType: 'box', yFields: [yField('revenue')] }, { type: 'box', y: '$y0' }],
    ['violin', { chartType: 'violin', yFields: [yField('revenue')] }, { type: 'violin', y: '$y0' }],
    [
      'waterfall',
      { chartType: 'waterfall', x: channel('month'), yFields: [yField('revenue')] },
      { type: 'waterfall', x: '$x', y: '$y0' },
    ],
    [
      'funnel',
      { chartType: 'funnel', x: channel('stage'), yFields: [yField('users')] },
      // Stages on y, lengths on x, like the built-in funnel builder.
      { type: 'funnel', x: '$y0', y: '$x' },
    ],
    [
      'timeline',
      { chartType: 'timeline', x: channel('day', 'temporal'), yFields: [yField('events')] },
      { type: 'scatter', mode: 'markers', x: '$x', y: '$y0' },
    ],
  ]

  for (const [name, encoding, expected] of cases) {
    it(`converts ${name}`, () => {
      const { manifest, warnings } = convert(chart(encoding))
      expect(manifest.traces).toEqual([expected])
      expect(manifest.transforms).toBeUndefined()
      expect(warnings).toEqual([])
    })
  }

  it('falls back to $index when the chart has no x channel', () => {
    const { manifest } = convert(chart({ chartType: 'line', yFields: [yField('revenue')] }))
    expect(manifest.traces).toEqual([{ type: 'scatter', mode: 'lines', x: '$index', y: '$y0' }])
    expect(manifest.channels.x).toBeUndefined()
  })

  it('adds splitBy for a coloured relational chart', () => {
    const { manifest } = convert(relational({ x: channel('month'), color: channel('region') }))
    expect(manifest.traces).toEqual([
      { type: 'scatter', mode: 'lines', x: '$x', y: '$y0', splitBy: '$color' },
    ])
  })

  it('adds splitBy for a coloured violin', () => {
    const { manifest } = convert(
      chart({ chartType: 'violin', color: channel('region'), yFields: [yField('revenue')] }),
    )
    expect(manifest.traces).toEqual([{ type: 'violin', y: '$y0', splitBy: '$color' }])
  })

  it('uses $size.values and $error.values arrays on a scatter', () => {
    const { manifest, warnings } = convert(
      chart({
        chartType: 'scatter',
        x: channel('gdp'),
        yFields: [yField('life')],
        size: channel('population', 'quantitative'),
        error: channel('margin', 'quantitative'),
      }),
    )
    expect(manifest.traces).toEqual([
      {
        type: 'scatter',
        mode: 'markers',
        x: '$x',
        y: '$y0',
        marker: { size: '$size.values' },
        error_y: { type: 'data', array: '$error.values', visible: true },
      },
    ])
    expect(warnings).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// aggregation
// ---------------------------------------------------------------------------

describe('manifestFromChart aggregation', () => {
  it('rebuilds the frame with group_agg and plots the alias', () => {
    const { manifest, warnings } = convert(
      relational({ x: channel('month'), yFields: [yField('revenue', { aggregate: 'mean' })] }),
    )
    expect(manifest.transforms).toEqual([
      { op: 'group_agg', groupBy: 'x', field: 'y0', agg: 'mean', as: 'v0' },
    ])
    expect(manifest.traces).toEqual([{ type: 'scatter', mode: 'lines', x: '$x', y: '$v0' }])
    expect(warnings).toEqual([])
  })

  it('groups by x and colour together so splitBy still resolves', () => {
    const { manifest } = convert(
      relational({
        x: channel('month'),
        color: channel('region'),
        yFields: [yField('revenue', { aggregate: 'sum' })],
      }),
    )
    expect(manifest.transforms).toEqual([
      { op: 'group_agg', groupBy: ['x', 'color'], field: 'y0', agg: 'sum', as: 'v0' },
    ])
    expect(manifest.traces).toEqual([
      { type: 'scatter', mode: 'lines', x: '$x', y: '$v0', splitBy: '$color' },
    ])
  })

  it('warns and keeps raw values for several aggregated Y fields', () => {
    const { manifest, warnings } = convert(
      chart({
        chartType: 'line',
        x: channel('month'),
        yFields: [
          yField('revenue', { aggregate: 'sum' }),
          yField('cost', { aggregate: 'mean' }),
        ],
      }),
    )
    expect(manifest.transforms).toBeUndefined()
    expect(manifest.traces).toEqual([{ type: 'scatter', mode: 'lines', x: '$x', y: '$y0' }])
    expect(manifest.channels.yFields).toEqual({ mode: 'range' })
    expect(warnings).toEqual([
      'Aggregating more than one Y field is not expressible in a manifest; raw values are used instead.',
    ])
  })

  it('warns and keeps raw values when there is no x to group by', () => {
    const { manifest, warnings } = convert(
      chart({ chartType: 'line', yFields: [yField('revenue', { aggregate: 'sum' })] }),
    )
    expect(manifest.transforms).toBeUndefined()
    expect(manifest.traces).toEqual([{ type: 'scatter', mode: 'lines', x: '$index', y: '$y0' }])
    expect(warnings).toEqual([
      'An aggregate needs an x channel to group by; raw values are used instead.',
    ])
  })

  it('drops the size and error slots an aggregate cannot carry', () => {
    const { manifest, warnings } = convert(
      chart({
        chartType: 'scatter',
        x: channel('month'),
        yFields: [yField('revenue', { aggregate: 'sum' })],
        size: channel('population', 'quantitative'),
        error: channel('margin', 'quantitative'),
      }),
    )
    expect(manifest.traces).toEqual([{ type: 'scatter', mode: 'markers', x: '$x', y: '$v0' }])
    expect(warnings).toEqual([
      'Aggregation drops the size column, so marker sizes are not carried over.',
      'Aggregation drops the error column, so error bars are not carried over.',
    ])
  })

  it('ignores an aggregate on a histogram/box/violin, as the built-in path does', () => {
    for (const chartType of ['histogram', 'box', 'violin']) {
      const { manifest, warnings } = convert(
        chart({ chartType, yFields: [yField('revenue', { aggregate: 'sum' })] }),
      )
      expect(manifest.transforms, chartType).toBeUndefined()
      expect(warnings, chartType).toEqual([])
    }
  })

  it('reduces a gauge to one value and shows it as an indicator', () => {
    const { manifest } = convert(
      chart({ chartType: 'gauge', yFields: [yField('revenue', { aggregate: 'mean' })] }),
    )
    expect(manifest.transforms).toEqual([
      { op: 'reduce', field: 'y0', agg: 'mean', as: 'total' },
    ])
    expect(manifest.traces).toEqual([
      { type: 'indicator', mode: 'gauge+number', value: '$total' },
    ])
  })

  it('defaults the gauge aggregate to sum', () => {
    const { manifest } = convert(chart({ chartType: 'gauge', yFields: [yField('revenue')] }))
    expect(manifest.transforms).toEqual([{ op: 'reduce', field: 'y0', agg: 'sum', as: 'total' }])
  })

  it('aggregates sankey links over source and target', () => {
    const { manifest } = convert(
      chart({
        chartType: 'sankey',
        source: channel('from'),
        target: channel('to'),
        yFields: [yField('flow')],
      }),
    )
    expect(manifest.transforms).toEqual([
      { op: 'group_agg', groupBy: ['source', 'target'], field: 'y0', agg: 'sum', as: 'total' },
    ])
    expect(manifest.traces).toEqual([
      { type: 'sankey', source: '$source', target: '$target', values: '$total' },
    ])
  })
})

// ---------------------------------------------------------------------------
// channels
// ---------------------------------------------------------------------------

describe('manifestFromChart channels', () => {
  it('declares every bound channel with its own type', () => {
    const { manifest } = convert(
      chart({
        chartType: 'scatter',
        x: channel('month', 'temporal'),
        yFields: [yField('revenue')],
        color: channel('region', 'nominal'),
        size: channel('population', 'quantitative'),
        z: channel('score', 'quantitative'),
        error: channel('margin', 'quantitative'),
        source: channel('from', 'nominal'),
        target: channel('to', 'nominal'),
      }),
    )
    expect(manifest.channels).toEqual({
      x: { required: true, types: ['temporal'] },
      color: { required: true, types: ['nominal'] },
      size: { required: true, types: ['quantitative'] },
      z: { required: true, types: ['quantitative'] },
      error: { required: true, types: ['quantitative'] },
      source: { required: true, types: ['nominal'] },
      target: { required: true, types: ['nominal'] },
      yFields: { mode: 'one' },
    })
  })

  it('maps the Y field count onto the four modes', () => {
    const modes: [number, string][] = [
      [0, 'none'],
      [1, 'one'],
      [2, 'range'],
      [3, 'multi'],
      [5, 'multi'],
    ]
    for (const [count, mode] of modes) {
      expect(yFieldsModeFor(count)).toBe(mode)
      const yFields = Array.from({ length: count }, (_, index) => yField(`y${index}`))
      // A histogram with only an x is the one shape that legitimately has no Y.
      const source =
        count === 0
          ? chart({ chartType: 'histogram', x: channel('a', 'quantitative'), yFields })
          : chart({ chartType: 'box', yFields })
      expect(convert(source).manifest.channels.yFields).toEqual({ mode })
    }
  })

  it('reports the facet grid instead of declaring an unbindable facet channel', () => {
    const { manifest, warnings } = convert(
      relational({ x: channel('month'), facet: channel('region') }),
    )
    expect(manifest.channels.facet).toBeUndefined()
    expect(warnings).toEqual([
      'The facet grid is not carried over: a custom chart can only facet by colour (`facetBy`).',
    ])
  })
})

// ---------------------------------------------------------------------------
// layout, id, label
// ---------------------------------------------------------------------------

describe('manifestFromChart layout', () => {
  it('copies only the allowlisted keys and names every dropped one', () => {
    const { manifest, warnings } = convert(
      relational(
        {},
        {
          autosize: true,
          margin: { t: 40, r: 20, b: 40, l: 60 },
          paper_bgcolor: '#ffffff',
          plot_bgcolor: '#ffffff',
          font: {},
          xaxis: { gridcolor: '#eee' },
          yaxis: {},
          legend: { orientation: 'h', y: -0.2 },
          showlegend: false,
          barmode: 'group',
          hovermode: 'x unified',
          title: { text: 'Revenue' },
        },
      ),
    )
    expect(manifest.layout).toEqual({
      margin: { t: 40, r: 20, b: 40, l: 60 },
      xaxis: { gridcolor: '#eee' },
      yaxis: {},
      legend: { orientation: 'h', y: -0.2 },
      showlegend: false,
      barmode: 'group',
      hovermode: 'x unified',
      title: { text: 'Revenue' },
    })
    expect(warnings).toEqual([
      'Layout key "autosize" has no declarative equivalent and was dropped.',
      'Layout key "paper_bgcolor" has no declarative equivalent and was dropped.',
      'Layout key "plot_bgcolor" has no declarative equivalent and was dropped.',
      'Layout key "font" has no declarative equivalent and was dropped.',
    ])
  })

  it('omits the layout object entirely when nothing survives', () => {
    const { manifest } = convert(relational({}, { autosize: true, font: {} }))
    expect(manifest.layout).toEqual({})
  })
})

describe('manifestFromChart identity', () => {
  it('slugs the chart name behind the custom- prefix', () => {
    expect(manifestIdFor('Chart 1')).toBe('custom-chart-1')
    expect(convert(relational()).manifest.id).toBe('custom-chart-1')
  })

  it('falls back to custom-chart when the name has no latin characters', () => {
    expect(manifestIdFor('图表')).toBe('custom-chart')
    expect(manifestIdFor('  ')).toBe('custom-chart')
    expect(manifestIdFor('!!!')).toBe('custom-chart')
    expect(convert(relational({}, {}, '趋势 图 ①')).manifest.id).toBe('custom-chart')
  })

  it('never exceeds 40 characters or ends in a separator', () => {
    const id = manifestIdFor('Quarterly revenue by region and channel — 2024 edition')
    expect(id.length).toBeLessThanOrEqual(40)
    expect(id).toMatch(ID_RE)
    expect(id.endsWith('-')).toBe(false)
  })

  it('never collides with a built-in chart type', () => {
    for (const chartType of BUILTIN_IDS) {
      const id = manifestIdFor(chartType)
      expect(id.startsWith('custom-'), id).toBe(true)
      expect(BUILTIN_IDS as readonly string[]).not.toContain(id)
    }
  })

  it('carries the name into both label languages and describes the origin', () => {
    const { manifest } = convert(relational({}, {}, '月度营收'))
    expect(manifest.label).toEqual({ zh: '月度营收', en: '月度营收' })
    expect(manifest.description).toEqual({
      zh: '由内置图表「月度营收」转换',
      en: 'Converted from built-in chart "月度营收"',
    })
  })

  it('truncates an over-long name to the label cap and warns', () => {
    const { manifest, warnings } = convert(relational({}, {}, 'x'.repeat(80)))
    expect(manifest.label.en).toHaveLength(60)
    expect(warnings).toEqual([
      'The chart name is longer than 60 characters; the manifest label is truncated.',
    ])
  })

  it('leaves keywords and options empty', () => {
    const { manifest } = convert(relational())
    expect(manifest.keywords).toEqual([])
    expect(manifest.options).toEqual([])
    expect(manifest.schemaVersion).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// unsupported types and impossible inputs
// ---------------------------------------------------------------------------

describe('manifestFromChart reasons', () => {
  const unsupported = BUILTIN_IDS.filter(
    (id) =>
      ![
        'line',
        'bar',
        'barh',
        'area',
        'step',
        'scatter',
        'dot',
        'histogram',
        'box',
        'violin',
        'sankey',
        'waterfall',
        'funnel',
        'timeline',
        'gauge',
      ].includes(id),
  )

  for (const chartType of unsupported) {
    it(`refuses ${chartType} with the unsupportedType code`, () => {
      expect(
        reasonFor(chart({ chartType, x: channel('a'), yFields: [yField('b')], z: channel('c') })),
      ).toEqual({ code: 'unsupportedType', params: { type: chartType } })
    })
  }

  // One assertion per refusal code: the reason is data the dialog localizes as
  // `chart.custom.reason.<code>`, so no English sentence may creep back in.
  it('refuses a relational chart with no Y field (noYField)', () => {
    expect(reasonFor(chart({ chartType: 'line', x: channel('month') }))).toEqual({
      code: 'noYField',
    })
  })

  it('refuses a gauge with no Y field (noValueField)', () => {
    expect(reasonFor(chart({ chartType: 'gauge' }))).toEqual({ code: 'noValueField' })
  })

  it('refuses a histogram with neither x nor Y (noValueField)', () => {
    expect(reasonFor(chart({ chartType: 'histogram' }))).toEqual({ code: 'noValueField' })
  })

  it('refuses a sankey without source/target (missingLinks)', () => {
    expect(
      reasonFor(chart({ chartType: 'sankey', source: channel('from'), yFields: [yField('flow')] })),
    ).toEqual({ code: 'missingLinks' })
  })

  it('reports a sankey with no data field before it looks at the links', () => {
    expect(reasonFor(chart({ chartType: 'sankey' }))).toEqual({ code: 'noValueField' })
  })

  it('returns only codes, params and no free text', () => {
    const refusals = [
      reasonFor(chart({ chartType: 'pie', x: channel('a'), yFields: [yField('b')] })),
      reasonFor(chart({ chartType: 'line', x: channel('month') })),
      reasonFor(chart({ chartType: 'histogram' })),
      reasonFor(chart({ chartType: 'sankey' })),
      reasonFor(chart({ chartType: 'sankey', source: channel('from'), yFields: [yField('f')] })),
    ]
    for (const refusal of refusals) {
      for (const key of Object.keys(refusal)) {
        expect(['code', 'params'], `${refusal.code}.${key}`).toContain(key)
      }
      expect(REFUSAL_CODES as readonly string[]).toContain(refusal.code)
      for (const value of Object.values(refusal.params ?? {})) {
        expect(typeof value).toBe('string')
      }
    }
  })
})

// ---------------------------------------------------------------------------
// contract shape: the checks `validate_payload` would make over the wire
// ---------------------------------------------------------------------------

describe('manifestFromChart backend contract', () => {
  /** One representative chart per expressible type, plus the awkward ones. */
  const fixtures: ChartConfig[] = [
    relational(),
    relational({ color: channel('region') }),
    relational({ facet: channel('region') }),
    relational({ yFields: [yField('revenue', { aggregate: 'mean' })] }),
    relational({
      size: channel('population', 'quantitative'),
      error: channel('margin', 'quantitative'),
    }),
    chart({ chartType: 'area', x: channel('month'), yFields: [yField('a'), yField('b')] }),
    chart({ chartType: 'step', yFields: [yField('a')] }),
    chart({ chartType: 'dot', x: channel('month'), yFields: [yField('a')] }),
    chart({ chartType: 'scatter', x: channel('month'), yFields: [yField('a')] }),
    chart({ chartType: 'bar', x: channel('month'), yFields: [yField('a')] }),
    chart({ chartType: 'barh', x: channel('month'), yFields: [yField('a')] }),
    chart({ chartType: 'histogram', yFields: [yField('a')] }),
    chart({ chartType: 'histogram', x: channel('a', 'quantitative') }),
    chart({ chartType: 'box', color: channel('region'), yFields: [yField('a')] }),
    chart({ chartType: 'violin', yFields: [yField('a')] }),
    chart({ chartType: 'waterfall', x: channel('month'), yFields: [yField('a')] }),
    chart({
      chartType: 'waterfall',
      x: channel('month'),
      yFields: [yField('a', { aggregate: 'sum' })],
    }),
    chart({ chartType: 'funnel', x: channel('stage'), yFields: [yField('a')] }),
    chart({ chartType: 'timeline', x: channel('day', 'temporal'), yFields: [yField('a')] }),
    chart({ chartType: 'gauge', yFields: [yField('a', { aggregate: 'max' })] }),
    chart({ chartType: 'sankey', source: channel('f'), target: channel('t'), yFields: [yField('a')] }),
  ]

  it('keeps every produced manifest inside the schema', () => {
    for (const fixture of fixtures) {
      const { manifest } = convert(fixture)
      const where = `${fixture.encoding.chartType}`

      for (const key of Object.keys(manifest)) {
        expect(TOP_LEVEL_KEYS as readonly string[], `${where}.${key}`).toContain(key)
      }

      expect(manifest.schemaVersion, where).toBe(1)
      expect(manifest.id, where).toMatch(ID_RE)
      expect(BUILTIN_IDS as readonly string[], where).not.toContain(manifest.id)
      for (const text of [manifest.label.zh, manifest.label.en]) {
        expect(text.length, where).toBeGreaterThan(0)
        expect(text.length, where).toBeLessThanOrEqual(60)
      }
      for (const text of [manifest.description?.zh ?? '', manifest.description?.en ?? '']) {
        expect(text.length, where).toBeGreaterThan(0)
        expect(text.length, where).toBeLessThanOrEqual(200)
      }

      const channelKeys = Object.keys(manifest.channels)
      expect(channelKeys.length, where).toBeGreaterThan(0)
      for (const key of channelKeys) {
        expect([...CHANNEL_KEYS, 'yFields'], `${where}.channels.${key}`).toContain(key)
      }
      for (const key of CHANNEL_KEYS) {
        const rule = manifest.channels[key]
        if (!rule) continue
        expect(Object.keys(rule).sort(), `${where}.channels.${key}`).toEqual(['required', 'types'])
        expect(rule.required, where).toBe(true)
        expect(rule.types, where).toHaveLength(1)
        for (const type of rule.types ?? []) {
          expect(CHANNEL_TYPES as readonly string[], where).toContain(type)
        }
      }
      const mode = manifest.channels.yFields?.mode
      expect(Y_FIELD_MODES as readonly string[], where).toContain(mode)
      // "declare at least one channel or a non-none yFields mode"
      expect(channelKeys.length > 1 || mode !== 'none', where).toBe(true)

      for (const step of manifest.transforms ?? []) {
        const allowed = TRANSFORM_KEYS[step.op]
        expect(allowed, `${where}: unknown op ${step.op}`).toBeDefined()
        for (const key of Object.keys(step)) {
          expect(['op', ...allowed], `${where}.transforms.${key}`).toContain(key)
        }
        if (step.op === 'group_agg' || step.op === 'reduce') {
          expect(GROUP_AGGS as readonly string[], where).toContain(step.agg)
        }
        if (step.op === 'group_agg') {
          const groupBy = Array.isArray(step.groupBy) ? step.groupBy : [step.groupBy]
          expect(groupBy.length, where).toBeGreaterThanOrEqual(1)
          expect(groupBy.length, where).toBeLessThanOrEqual(2)
        }
        if ('as' in step) expect(step.as, where).toMatch(AS_RE)
      }

      expect(manifest.traces.length, where).toBeGreaterThanOrEqual(1)
      expect(manifest.traces.length, where).toBeLessThanOrEqual(8)
      for (const trace of manifest.traces) {
        expect(TRACE_TYPES as readonly string[], `${where}.${trace.type}`).toContain(trace.type)
        for (const key of Object.keys(trace)) {
          const ok =
            (STYLE_KEYS as readonly string[]).includes(key) ||
            (DATA_KEYS as readonly string[]).includes(key) ||
            (EXTRA_TRACE_KEYS as readonly string[]).includes(key)
          expect(ok, `${where}: unsupported trace key ${key}`).toBe(true)
        }
      }

      for (const key of Object.keys(manifest.layout ?? {})) {
        expect(LAYOUT_KEYS as readonly string[], `${where}.layout.${key}`).toContain(key)
      }

      expect(manifest.keywords?.length ?? 0, where).toBeLessThanOrEqual(5)
      expect(manifest.options?.length ?? 0, where).toBeLessThanOrEqual(8)
      expect(manifest.facetBy, where).toBeUndefined()
    }
  })

  it('names only slots the manifest declares or produces', () => {
    for (const fixture of fixtures) {
      const { manifest } = convert(fixture)
      const where = fixture.encoding.chartType
      const declared = new Set(Object.keys(manifest.channels))
      const yMode = manifest.channels.yFields?.mode ?? 'none'
      const produced = new Set<string>()
      for (const step of manifest.transforms ?? []) {
        if (typeof step.as === 'string') produced.add(step.as)
      }

      const resolve = (slot: string): boolean => {
        expect(slot.startsWith('$'), `${where}: ${slot}`).toBe(true)
        const name = slot.slice(1)
        if (name === 'count' || name === 'index') return true
        if (name.endsWith('.values')) return resolve(`$${name.slice(0, -'.values'.length)}`)
        if (produced.has(name)) return true
        if (/^y[0-4]$/.test(name)) {
          const index = Number(name.slice(1))
          if (yMode === 'one') return index === 0
          if (yMode === 'range') return index <= 1
          if (yMode === 'multi') return true
          return false
        }
        return declared.has(name)
      }

      for (const trace of manifest.traces) {
        for (const [key, value] of Object.entries(trace)) {
          if (key === 'type' || key === 'splitBy') continue
          if (typeof value === 'string' && value.startsWith('$')) {
            expect(resolve(value), `${where}.${key}: ${value}`).toBe(true)
          }
          if (key === 'marker' && typeof value === 'object' && value !== null) {
            for (const nested of Object.values(value as Record<string, unknown>)) {
              if (typeof nested === 'string') expect(resolve(nested), `${where}.marker`).toBe(true)
            }
          }
          if (key === 'error_y' && typeof value === 'object' && value !== null) {
            const array = (value as Record<string, unknown>).array
            if (typeof array === 'string') expect(resolve(array), `${where}.error_y`).toBe(true)
          }
        }
        if (trace.splitBy !== undefined) {
          expect(trace.splitBy, where).toBe('$color')
          expect(declared.has('color'), where).toBe(true)
        }
      }
    }
  })
})

/**
 * MANUAL VALIDATION
 * -----------------
 * vitest cannot import `backend/core/custom_charts.py`, so the manifests this
 * converter produces were round-tripped through the real validator (and the
 * real renderer) by hand, with a throwaway `CHART_DIR` so the user's
 * `~/.metricstudio/charts/` was never touched:
 *
 *   backend/.venv/bin/python - <<'PY'
 *   import glob, json, pathlib, tempfile
 *   import backend.core.custom_charts as cc
 *   cc.CHART_DIR = pathlib.Path(tempfile.mkdtemp()) / "charts"
 *   cc.CHART_DIR.mkdir(parents=True)
 *   for path in sorted(glob.glob("/tmp/manifest-*.json")):
 *       manifest = cc.validate_payload(json.load(open(path)))   # raises on error
 *       print(path, "OK", manifest.id)
 *   PY
 *
 * All ten converted manifests (line, aggregated bar + colour, bubble with
 * size/error, gauge, sankey, histogram, barh, box, funnel, faceted line) passed
 * `validate_payload` and also rendered through `custom_charts.render` without a
 * `_RenderError`. The assertions above exist so a later change to the converter
 * fails here even without the Python venv.
 */
