import { beforeEach, describe, expect, it } from 'vitest'
import type { CustomChartManifest } from '@/types/customChart'
import { customChartSpec, customOptionDefs, resolveCustomOptions } from '@/utils/customChartSpecs'
import { chartTypeLabel, localizedCustomText } from '@/utils/chartTypeLabel'
import { useCustomChartStore } from '@/stores/customChartStore'

/**
 * Contract tests for the declarative custom chart projection.
 *
 * The backend owns the manifest format; these tests pin the translation into
 * the panel's vocabulary (channels, y-field arity, options) and the label
 * resolution order used by both type pickers.
 */

function manifest(patch: Partial<CustomChartManifest> = {}): CustomChartManifest {
  return {
    schemaVersion: 1,
    id: 'radar_pulse',
    label: { zh: '雷达脉冲', en: 'Radar Pulse' },
    channels: {},
    traces: [{ type: 'scatterpolar' }],
    ...patch,
  }
}

describe('customChartSpec yFields mode', () => {
  it('maps all four manifest modes onto the panel vocabulary', () => {
    const cases = [
      ['none', 'none'],
      ['one', 'first'],
      ['range', 'multi'],
      ['multi', 'multi'],
    ] as const
    for (const [mode, expected] of cases) {
      const spec = customChartSpec(manifest({ channels: { yFields: { mode } } }))
      expect(spec.yFields, mode).toBe(expected)
    }
  })

  it('falls back to "none" when the manifest declares no yFields', () => {
    expect(customChartSpec(manifest({ channels: { x: {} } })).yFields).toBe('none')
  })
})

describe('customChartSpec channels', () => {
  it('keeps only known channels and preserves manifest order', () => {
    const spec = customChartSpec(manifest({
      channels: {
        // Deliberately not the panel's canonical order, and with two unknown keys.
        color: {},
        x: {},
        legend: {},
        source: {},
        target: {},
        tooltip: {},
      } as CustomChartManifest['channels'],
    }))
    expect(spec.channels).toEqual(['color', 'x', 'source', 'target'])
  })

  it('drops yFields from the channel list and labels from the English side', () => {
    const spec = customChartSpec(manifest({
      channels: { yFields: { mode: 'one' }, x: {} },
    }))
    expect(spec.channels).toEqual(['x'])
    expect(spec.label).toBe('Radar Pulse')
    // Custom charts render their own options; the built-in OptionKey list stays empty.
    expect(spec.options).toBeUndefined()
  })

  it('ignores known channels the manifest left undeclared (explicit nulls on the wire)', () => {
    // The backend dumps every channel key, undeclared ones as `null`; only `x`
    // and `color` carry a rule here, so only those two may reach the panel.
    const payload = {
      x: { required: true, types: ['quantitative'] },
      color: { types: ['nominal'] },
      size: null,
      facet: null,
      z: null,
      error: null,
      source: null,
      target: null,
      yFields: { mode: 'range' },
    } as unknown as CustomChartManifest['channels']
    const spec = customChartSpec(manifest({ channels: payload }))
    expect(spec.channels).toEqual(['x', 'color'])
    expect(spec.yFields).toBe('multi')
  })
})

describe('customOptionDefs', () => {
  it('returns the manifest order and tolerates a missing options array', () => {
    const defs = customOptionDefs(manifest({
      options: [
        { key: 'smooth', type: 'boolean', default: false, label: { zh: '平滑', en: 'Smooth' } },
        { key: 'width', type: 'number', default: 2, label: { zh: '线宽', en: 'Width' } },
      ],
    }))
    expect(defs.map((def) => def.key)).toEqual(['smooth', 'width'])
    expect(customOptionDefs(manifest())).toEqual([])
  })
})

describe('resolveCustomOptions', () => {
  const withOptions = manifest({
    options: [
      { key: 'width', type: 'number', default: 2, label: { zh: '线宽', en: 'Width' } },
      { key: 'title', type: 'text', default: 'none', label: { zh: '标题', en: 'Title' } },
      { key: 'smooth', type: 'boolean', default: false, label: { zh: '平滑', en: 'Smooth' } },
      { key: 'shape', type: 'select', default: 'line', choices: ['line', 'bar'], label: { zh: '形状', en: 'Shape' } },
    ],
  })

  it('uses manifest defaults when nothing is stored', () => {
    expect(resolveCustomOptions(withOptions, undefined)).toEqual({
      width: 2,
      title: 'none',
      smooth: false,
      shape: 'line',
    })
  })

  it('lets a stored value win over the default', () => {
    const resolved = resolveCustomOptions(withOptions, {
      width: 5,
      title: 'Trend',
      smooth: true,
      shape: 'bar',
    })
    expect(resolved).toEqual({ width: 5, title: 'Trend', smooth: true, shape: 'bar' })
  })

  it('ignores wrong-typed stored values and unknown keys', () => {
    const resolved = resolveCustomOptions(withOptions, {
      width: 'wide',       // number option holding a string
      title: 42,           // text option holding a number
      smooth: 'yes',       // boolean option holding a string
      shape: 'triangle',   // not in choices
      leftover: 'dropped', // not declared by the manifest
    })
    expect(resolved).toEqual({
      width: 2,
      title: 'none',
      smooth: false,
      shape: 'line',
    })
  })

  it('keeps a non-finite stored number out of the encoding', () => {
    expect(resolveCustomOptions(withOptions, { width: Number.NaN }).width).toBe(2)
  })
})

describe('localizedCustomText', () => {
  it('prefers the requested language and falls back to the other one', () => {
    expect(localizedCustomText({ zh: '雷达', en: 'Radar' }, 'zh')).toBe('雷达')
    expect(localizedCustomText({ zh: '雷达', en: 'Radar' }, 'en')).toBe('Radar')
    expect(localizedCustomText({ zh: '', en: 'Radar' }, 'zh')).toBe('Radar')
    expect(localizedCustomText({ zh: '雷达', en: '  ' }, 'en')).toBe('雷达')
    expect(localizedCustomText(undefined, 'en')).toBe('')
  })
})

describe('chartTypeLabel resolution order', () => {
  type Translate = (key: string, options?: { defaultValue?: string }) => string

  /** Stand-in for i18next: returns translated copy, else the defaultValue. */
  const stubbedT = ((key: string, options?: { defaultValue?: string }) => {
    if (key === 'chart.type.line') return 'TRANSLATED line'
    return options?.defaultValue ?? key
  }) as Translate

  beforeEach(() => {
    useCustomChartStore.setState({ items: [], invalid: [], loading: false, error: null, loaded: false })
  })

  it('prefers the custom manifest label over any i18n copy', () => {
    useCustomChartStore.setState({
      items: [{ ...manifest({ id: 'radar_pulse' }), file: 'radar_pulse.json' }],
    })
    expect(chartTypeLabel('radar_pulse', 'en', stubbedT)).toBe('Radar Pulse')
    expect(chartTypeLabel('radar_pulse', 'zh', stubbedT)).toBe('雷达脉冲')
  })

  it('uses the i18n copy for built-in ids', () => {
    expect(chartTypeLabel('line', 'en', stubbedT)).toBe('TRANSLATED line')
  })

  it('falls back to the bare id for unknown ids instead of the raw key', () => {
    const label = chartTypeLabel('future_plugin_type', 'en', stubbedT)
    expect(label).toBe('future_plugin_type')
    expect(label).not.toContain('chart.type.')
  })

  it('never throws when the translate function is broken', () => {
    const brokenT = (() => {
      throw new Error('i18n exploded')
    }) as Translate
    expect(chartTypeLabel('line', 'en', brokenT)).toBe('line')
    expect(chartTypeLabel('radar_pulse', 'en', brokenT)).toBe('radar_pulse')
  })
})
