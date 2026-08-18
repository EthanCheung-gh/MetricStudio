import type { PlotlyFigure } from '@/types/plotly'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function mergePlotlyLayout(
  base: Record<string, unknown>,
  overrides?: Record<string, unknown>,
): Record<string, unknown> {
  if (!overrides) return { ...base }
  const result = { ...base }
  for (const [key, overrideValue] of Object.entries(overrides)) {
    const baseValue = base[key]
    if (isRecord(baseValue) && isRecord(overrideValue)) {
      result[key] = mergePlotlyLayout(baseValue, overrideValue)
    } else if (overrideValue !== undefined) {
      result[key] = overrideValue
    }
  }
  return result
}

function traceColor(
  trace: Record<string, unknown>,
  index: number,
  palette: string[],
  overrides: Record<string, string>,
): string | undefined {
  const name = String(trace.name || '')
  const fieldName = name.split(' - ')[0]
  return overrides[name] || overrides[fieldName] || palette[index % palette.length]
}

export function applyPlotlyUserStyle(
  figure: PlotlyFigure,
  userLayout?: Record<string, unknown>,
): PlotlyFigure {
  if (!userLayout) return { data: figure.data, layout: { ...figure.layout } }
  const palette = Array.isArray(userLayout.colorway)
    ? userLayout.colorway.filter((color): color is string => typeof color === 'string')
    : []
  const overrides = isRecord(userLayout.metricstudio_trace_colors)
    ? Object.fromEntries(Object.entries(userLayout.metricstudio_trace_colors).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {}
  const data = figure.data.map((trace, index) => {
    const color = traceColor(trace, index, palette, overrides)
    if (!color) return trace
    const marker = isRecord(trace.marker) ? trace.marker : {}
    const line = isRecord(trace.line) ? trace.line : {}
    if (trace.type === 'pie') {
      const pointCount = Array.isArray(trace.labels) ? trace.labels.length : palette.length
      const colors = palette.length > 0
        ? Array.from({ length: pointCount }, (_, pointIndex) => palette[pointIndex % palette.length])
        : marker.colors
      return { ...trace, marker: { ...marker, colors } }
    }
    const hasArrayColor = Array.isArray(marker.color)
    if (hasArrayColor && !overrides[String(trace.name || '')]) return trace
    return {
      ...trace,
      marker: { ...marker, color },
      ...(trace.type === 'scatter' || trace.type === 'scatterpolar' ? { line: { ...line, color } } : {}),
    }
  })
  const layoutOverrides = Object.fromEntries(
    Object.entries(userLayout).filter(([key]) => !key.startsWith('metricstudio_')),
  )
  return { data, layout: mergePlotlyLayout(figure.layout, layoutOverrides) }
}
