import { beforeAll, describe, expect, it } from 'vitest'
import { createInstance } from 'i18next'
import en from '@/i18n/locales/en'
import zh from '@/i18n/locales/zh'
import { chartTypeOptions } from '@/utils/chartConstants'
import {
  GENERATED_CHART_TYPES,
  GENERATED_CHART_TYPE_IDS,
} from '@/utils/chartTypeRegistry.generated'
import { getChartTypeSpec } from '@/utils/chartTypeSpecs'
import type { ChannelKey, OptionKey } from '@/utils/chartTypeSpecs'

/**
 * Contract tests for the generated chart registry and its frontend projection.
 *
 * backend/core/chart_registry.py is the source of truth; this file guards the
 * mirror (chartTypeRegistry.generated.ts), the projection the config panel reads
 * (chartTypeSpecs.ts), the picker order (chartConstants.ts) and the i18n copy.
 */

const REGISTRY_IDS = GENERATED_CHART_TYPES.map((entry) => entry.id)
const REGISTRY_ID_SET = new Set(REGISTRY_IDS)

// Exhaustive runtime mirrors of the panel's key unions: `Record<ChannelKey, true>`
// stops compiling if a key is added to (or removed from) the union, so these two
// tables can never silently drift from the types they describe.
const CHANNEL_KEYS: Record<ChannelKey, true> = {
  x: true,
  color: true,
  size: true,
  facet: true,
  z: true,
  error: true,
  source: true,
  target: true,
}

const OPTION_KEYS: Record<OptionKey, true> = {
  barmode: true,
  orientation: true,
  histnorm: true,
  cumulative: true,
  boxPoints: true,
  marginal: true,
  annotated: true,
  corr: true,
  ganttFields: true,
  candlestickFields: true,
  gaugeRange: true,
}

const CHANNEL_KEY_SET = new Set<string>(Object.keys(CHANNEL_KEYS))
const OPTION_KEY_SET = new Set<string>(Object.keys(OPTION_KEYS))

const zhMap = zh as Record<string, string>
const enMap = en as Record<string, string>

describe('generated registry mirror', () => {
  it('registers every chart type exactly once', () => {
    // The expected size is the registry's own length: registering a 35th type
    // must not turn this file red. Correctness of the new entry is covered by
    // the projection and i18n parity tests below (per-id, both directions).
    const count = GENERATED_CHART_TYPES.length
    expect(count).toBeGreaterThanOrEqual(34)
    expect(REGISTRY_ID_SET.size).toBe(count)
    expect(new Set(GENERATED_CHART_TYPE_IDS).size).toBe(count)
  })

  it('keeps GENERATED_CHART_TYPE_IDS in sync with the entry list', () => {
    expect([...GENERATED_CHART_TYPE_IDS]).toEqual(REGISTRY_IDS)
  })

  it('gives every type an id and a label', () => {
    const blank = GENERATED_CHART_TYPES.filter(
      (entry) => entry.id.trim() === '' || entry.label.trim() === '',
    ).map((entry) => entry.id)
    expect(blank).toEqual([])
  })
})

describe('i18n parity', () => {
  it('has a label and a description for every registered type in zh and en', () => {
    const missing: string[] = []
    for (const id of REGISTRY_IDS) {
      for (const [locale, map] of [
        ['zh', zhMap],
        ['en', enMap],
      ] as const) {
        for (const prefix of ['chart.type.', 'chart.desc.']) {
          const value = map[`${prefix}${id}`]
          if (typeof value !== 'string' || value.trim() === '') {
            missing.push(`${locale}:${prefix}${id}`)
          }
        }
      }
    }
    expect(missing).toEqual([])
  })

  it('has no orphaned chart.type / chart.desc copy for unregistered types', () => {
    const orphans: string[] = []
    for (const map of [zhMap, enMap]) {
      for (const key of Object.keys(map)) {
        const match = /^chart\.(?:type|desc)\.(.+)$/.exec(key)
        if (match && !REGISTRY_ID_SET.has(match[1])) orphans.push(key)
      }
    }
    expect(orphans).toEqual([])
  })
})

describe('getChartTypeSpec projection', () => {
  it('projects a spec for every registered id', () => {
    for (const entry of GENERATED_CHART_TYPES) {
      const spec = getChartTypeSpec(entry.id)
      expect(spec.label, entry.id).toBe(entry.label)
      expect(spec.yFields, entry.id).toBe(entry.yFields)
      expect(spec.path === true, entry.id).toBe(entry.path)
    }
  })

  it('projects only channels and options the panel knows how to render', () => {
    for (const entry of GENERATED_CHART_TYPES) {
      const spec = getChartTypeSpec(entry.id)
      for (const channel of spec.channels) {
        expect(CHANNEL_KEY_SET.has(channel), `${entry.id}: unknown channel ${channel}`).toBe(true)
      }
      for (const option of spec.options ?? []) {
        expect(OPTION_KEY_SET.has(option), `${entry.id}: unknown option ${option}`).toBe(true)
      }
    }
  })

  it('projects the gauge as a single-value type with only a range option', () => {
    expect(getChartTypeSpec('gauge')).toEqual({
      label: 'Gauge',
      yFields: 'first',
      channels: [],
      options: ['gaugeRange'],
    })
  })

  it('labels the multi-column picker per type', () => {
    expect(getChartTypeSpec('splom').dimensionsLabel).toBe('Dimensions')
    expect(getChartTypeSpec('parcoords').dimensionsLabel).toBe('Dimensions')
    expect(getChartTypeSpec('table').dimensionsLabel).toBe('Columns')
    expect(getChartTypeSpec('line').dimensionsLabel).toBeUndefined()
    expect(getChartTypeSpec('table').path).toBeUndefined()
  })

  it('flags the hierarchy family as path-driven', () => {
    for (const id of ['treemap', 'sunburst', 'icicle']) {
      expect(getChartTypeSpec(id).path, id).toBe(true)
    }
    expect(getChartTypeSpec('line').path).toBeUndefined()
  })
})

describe('getChartTypeSpec fallback', () => {
  it('returns an inert spec for unknown ids instead of throwing', () => {
    for (const id of ['future_plugin_type', '', 'constructor', 'toString']) {
      const spec = getChartTypeSpec(id)
      expect(spec).toEqual({ label: id, yFields: 'none', channels: [], options: [] })
      // Only own, plain data — no inherited Object.prototype members leaked in.
      expect(Object.keys(spec).sort()).toEqual(['channels', 'label', 'options', 'yFields'])
      expect(typeof spec.label).toBe('string')
      expect(spec.channels).toEqual([])
    }
  })

  it('does not resolve prototype member names to a real chart type', () => {
    expect(getChartTypeSpec('constructor').label).toBe('constructor')
    expect(getChartTypeSpec('toString').yFields).toBe('none')
    expect(getChartTypeSpec('hasOwnProperty').channels).toEqual([])
  })
})

describe('chart type picker order', () => {
  it('matches the registry order and labels exactly', () => {
    expect(chartTypeOptions.map((option) => option.value)).toEqual(REGISTRY_IDS)
    expect(chartTypeOptions.map((option) => option.label)).toEqual(
      GENERATED_CHART_TYPES.map((entry) => entry.label),
    )
    expect(chartTypeOptions).toHaveLength(GENERATED_CHART_TYPES.length)
  })
})

describe('config dialog type title', () => {
  // ChartConfigDialog resolves the selected type with
  //   t(`chart.type.${id}`, { defaultValue: getChartTypeSpec(id).label })
  // A real i18next instance is used so the fallback semantics are the ones the
  // component gets at runtime: known ids keep their translated label, unknown
  // ids must show the registry label instead of the raw "chart.type.<id>" key.
  type Translate = (key: string, options?: { defaultValue?: string }) => string
  let tEn: Translate
  let tZh: Translate

  beforeAll(async () => {
    const make = async (lng: 'en' | 'zh') => {
      const instance = createInstance()
      await instance.init({
        resources: {
          en: { translation: enMap },
          zh: { translation: zhMap },
        },
        lng,
        fallbackLng: lng,
        interpolation: { escapeValue: false },
      })
      return instance.t.bind(instance) as unknown as Translate
    }
    ;[tEn, tZh] = await Promise.all([make('en'), make('zh')])
  })

  const titleFor = (id: string, t: Translate = tEn) =>
    t(`chart.type.${id}`, { defaultValue: getChartTypeSpec(id).label })

  it('keeps the translated label for registered ids', () => {
    for (const id of ['gauge', 'line']) {
      expect(titleFor(id, tEn), id).toBe(enMap[`chart.type.${id}`])
      expect(titleFor(id, tZh), id).toBe(zhMap[`chart.type.${id}`])
    }
    // zh really is a translation, not the fallback label from the registry.
    expect(titleFor('gauge', tZh)).not.toBe(getChartTypeSpec('gauge').label)
  })

  it('falls back to the spec label instead of the raw key for unknown ids', () => {
    for (const t of [tEn, tZh]) {
      const title = titleFor('future_plugin_type', t)
      expect(title).toBe('future_plugin_type')
      expect(title).not.toContain('chart.type.')
    }
  })
})
