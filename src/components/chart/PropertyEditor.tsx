import { useTranslation } from 'react-i18next'
import { useChartStore } from '@/stores/chartStore'
import { Button, Input, Select, SelectItem, Switch } from '@heroui/react'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'
import { Minus, MessageSquarePlus, Trash2 } from 'lucide-react'

const PALETTES = {
  default: ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'],
  ocean: ['#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#84cc16', '#38bdf8', '#2dd4bf', '#4ade80'],
  sunset: ['#f97316', '#ef4444', '#ec4899', '#a855f7', '#8b5cf6', '#fb923c', '#f43f5e', '#d946ef'],
  neutral: ['#525252', '#737373', '#a3a3a3', '#d4d4d4', '#404040', '#8a8a8a', '#b8b8b8', '#e5e5e5'],
} as const

type AxisKey = 'xaxis' | 'yaxis' | 'yaxis2'

function titleText(value: unknown): string {
  if (value && typeof value === 'object') return String((value as Record<string, unknown>).text || '')
  return String(value || '')
}

function rangeValue(value: unknown, index: number): string {
  return Array.isArray(value) && value[index] !== undefined ? String(value[index]) : ''
}

function parseRangeValue(value: string): string | number {
  const numeric = Number(value)
  return value.trim() !== '' && Number.isFinite(numeric) ? numeric : value
}

export function PropertyEditor() {
  const { t } = useTranslation()
  const charts = useChartStore((s) => s.charts)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const updateLayout = useChartStore((s) => s.updateLayout)
  const chart = charts.find((item) => item.id === activeChartId)

  if (!chart) {
    return <div className="rounded border border-border bg-surface-elevated p-3 text-xs text-muted">{t('chart.selectChartToEdit')}</div>
  }

  const layout = chart.layout as Record<string, any>
  const xaxis = (layout.xaxis || {}) as Record<string, any>
  const yaxis = (layout.yaxis || {}) as Record<string, any>
  const yaxis2 = (layout.yaxis2 || {}) as Record<string, any>
  const legend = (layout.legend || {}) as Record<string, any>
  const font = (layout.font || {}) as Record<string, any>
  const title = layout.title && typeof layout.title === 'object' ? layout.title as Record<string, any> : { text: titleText(layout.title) }
  const hasRightAxis = (chart.encoding.yFields || []).some((field) => field.axis === 'right')
  const annotations = (layout.annotations || []) as Record<string, any>[]
  const shapes = (layout.shapes || []) as Record<string, any>[]
  const traceColors = (layout.metricstudio_trace_colors || {}) as Record<string, string>
  const selectedPalette = PALETTES[(layout.metricstudio_palette || 'default') as keyof typeof PALETTES] || PALETTES.default

  const patchAxis = (axisKey: AxisKey, patch: Record<string, unknown>) => {
    updateLayout(chart.id, { [axisKey]: { ...(layout[axisKey] || {}), ...patch } })
  }

  const setAxisTitle = (axisKey: AxisKey, value: string) => {
    const current = (layout[axisKey] || {}) as Record<string, any>
    patchAxis(axisKey, { title: { ...(typeof current.title === 'object' ? current.title : {}), text: value } })
  }

  const setAxisRange = (axisKey: AxisKey, index: number, value: string) => {
    const current = (layout[axisKey] || {}) as Record<string, any>
    const range = [rangeValue(current.range, 0), rangeValue(current.range, 1)]
    range[index] = value
    if (!range[0] || !range[1]) patchAxis(axisKey, { range: undefined, autorange: true })
    else patchAxis(axisKey, { range: range.map(parseRangeValue), autorange: false })
  }

  const addTextAnnotation = () => updateLayout(chart.id, {
    annotations: [...annotations, { text: t('chart.newAnnotation'), xref: 'paper', yref: 'paper', x: 0.5, y: 1.02, showarrow: false, font: { size: 12, color: '#f5f5f5' } }],
  })

  const addShape = (kind: 'hline' | 'vline') => {
    const shape = kind === 'hline'
      ? { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: '#ef4444', width: 2, dash: 'dash' } }
      : { type: 'line', xref: 'x', yref: 'paper', x0: 0, x1: 0, y0: 0, y1: 1, line: { color: '#ef4444', width: 2, dash: 'dash' } }
    updateLayout(chart.id, { shapes: [...shapes, shape] })
  }

  const axisEditor = (axisKey: AxisKey, axis: Record<string, any>, label: string) => (
    <div className="flex flex-col gap-2 rounded border border-border/60 p-2">
      <div className="text-[10px] font-semibold uppercase text-muted">{label}</div>
      <Input size="sm" label={t('chart.axisLabel')} value={titleText(axis.title)} onValueChange={(value) => setAxisTitle(axisKey, value)} />
      <div className="grid grid-cols-2 gap-1">
        <Input size="sm" label={t('chart.rangeStart')} value={rangeValue(axis.range, 0)} onValueChange={(value) => setAxisRange(axisKey, 0, value)} />
        <Input size="sm" label={t('chart.rangeEnd')} value={rangeValue(axis.range, 1)} onValueChange={(value) => setAxisRange(axisKey, 1, value)} />
      </div>
      <Input size="sm" label={t('chart.tickFormat')} value={String(axis.tickformat || '')} onValueChange={(value) => patchAxis(axisKey, { tickformat: value })} />
      {axisKey === 'xaxis' && (
        <Input size="sm" type="number" label={t('chart.tickAngle')} value={String(axis.tickangle ?? 0)} onValueChange={(value) => patchAxis(axisKey, { tickangle: Number(value) || 0 })} />
      )}
      <div className="flex items-center justify-between text-xs">
        <span>{t('chart.showGrid')}</span>
        <Switch size="sm" isSelected={axis.showgrid !== false} onValueChange={(value) => patchAxis(axisKey, { showgrid: value })} />
      </div>
      <div className="flex items-center justify-between text-xs">
        <span>{t('chart.logScale')}</span>
        <Switch size="sm" isSelected={axis.type === 'log'} onValueChange={(value) => patchAxis(axisKey, { type: value ? 'log' : '-' })} />
      </div>
    </div>
  )

  return (
    <>
      <CollapsibleSection title={t('panel.properties')} defaultOpen={false}>
        <div className="flex flex-col gap-2">
          <Input size="sm" label={t('chart.title')} value={titleText(title)} onValueChange={(value) => updateLayout(chart.id, { title: { ...title, text: value } })} />
          <Input size="sm" type="number" label={t('chart.titleFontSize')} value={String(title.font?.size ?? 16)} onValueChange={(value) => updateLayout(chart.id, { title: { ...title, font: { ...(title.font || {}), size: Number(value) || 16 } } })} />
          <Input size="sm" type="color" label={t('chart.bgColor')} value={String(layout.plot_bgcolor || '#000000')} onValueChange={(value) => updateLayout(chart.id, { plot_bgcolor: value })} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title={t('chart.axes')} defaultOpen={false}>
        <div className="flex flex-col gap-2">
          {axisEditor('xaxis', xaxis, t('chart.xAxis'))}
          {axisEditor('yaxis', yaxis, t('chart.leftYAxis'))}
          {hasRightAxis && axisEditor('yaxis2', yaxis2, t('chart.rightYAxis'))}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title={t('chart.legend')} defaultOpen={false}>
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <span>{t('chart.showLegend')}</span>
            <Switch size="sm" isSelected={layout.showlegend !== false} onValueChange={(value) => updateLayout(chart.id, { showlegend: value })} />
          </div>
          <Select size="sm" label={t('chart.legendOrientation')} selectedKeys={[String(legend.orientation || 'h')]} onSelectionChange={(keys) => updateLayout(chart.id, { legend: { ...legend, orientation: String(Array.from(keys)[0]) } })}>
            <SelectItem key="h">{t('chart.horizontal')}</SelectItem>
            <SelectItem key="v">{t('chart.vertical')}</SelectItem>
          </Select>
          <div className="grid grid-cols-2 gap-1">
            <Input size="sm" type="number" label={t('chart.legendX')} value={String(legend.x ?? 0)} onValueChange={(value) => updateLayout(chart.id, { legend: { ...legend, x: Number(value) || 0 } })} />
            <Input size="sm" type="number" label={t('chart.legendY')} value={String(legend.y ?? -0.2)} onValueChange={(value) => updateLayout(chart.id, { legend: { ...legend, y: Number(value) || 0 } })} />
          </div>
          <Input size="sm" type="number" label={t('chart.legendFontSize')} value={String(legend.font?.size ?? 12)} onValueChange={(value) => updateLayout(chart.id, { legend: { ...legend, font: { ...(legend.font || {}), size: Number(value) || 12 } } })} />
          <Input size="sm" label={t('chart.legendTitle')} value={titleText(legend.title)} onValueChange={(value) => updateLayout(chart.id, { legend: { ...legend, title: { ...(typeof legend.title === 'object' ? legend.title : {}), text: value } } })} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title={t('chart.typographyColors')} defaultOpen={false}>
        <div className="flex flex-col gap-2">
          <Input size="sm" label={t('chart.fontFamily')} value={String(font.family || '')} onValueChange={(value) => updateLayout(chart.id, { font: { ...font, family: value } })} />
          <Input size="sm" type="number" label={t('chart.globalFontSize')} value={String(font.size ?? 12)} onValueChange={(value) => updateLayout(chart.id, { font: { ...font, size: Number(value) || 12 } })} />
          <Select size="sm" label={t('chart.palette')} selectedKeys={[String(layout.metricstudio_palette || 'default')]} onSelectionChange={(keys) => {
            const key = String(Array.from(keys)[0]) as keyof typeof PALETTES
            updateLayout(chart.id, { metricstudio_palette: key, colorway: [...PALETTES[key]] })
          }}>
            <SelectItem key="default">{t('chart.paletteDefault')}</SelectItem>
            <SelectItem key="ocean">{t('chart.paletteOcean')}</SelectItem>
            <SelectItem key="sunset">{t('chart.paletteSunset')}</SelectItem>
            <SelectItem key="neutral">{t('chart.paletteNeutral')}</SelectItem>
          </Select>
          {(chart.encoding.yFields || []).map((field, index) => {
            const key = field.label || field.field || String(index)
            return (
              <div key={`${key}-${index}`} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted">{key}</span>
                <input type="color" className="h-7 w-10 rounded border border-border bg-transparent" value={traceColors[key] || selectedPalette[index % selectedPalette.length]} onChange={(event) => updateLayout(chart.id, { metricstudio_trace_colors: { ...traceColors, [key]: event.target.value } })} aria-label={t('chart.seriesColor', { name: key })} />
              </div>
            )
          })}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title={t('panel.annotations')} defaultOpen={false}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="flat" startContent={<MessageSquarePlus className="h-3 w-3" />} onPress={addTextAnnotation}>{t('chart.textAnnotation')}</Button>
            <Button size="sm" variant="flat" startContent={<Minus className="h-3 w-3" />} onPress={() => addShape('hline')}>{t('chart.hLine')}</Button>
            <Button size="sm" variant="flat" startContent={<Minus className="h-3 w-3 rotate-90" />} onPress={() => addShape('vline')}>{t('chart.vLine')}</Button>
          </div>
          {annotations.map((annotation, index) => (
            <div key={`ann-${index}`} className="flex items-center gap-1">
              <Input size="sm" value={String(annotation.text || '')} onValueChange={(value) => updateLayout(chart.id, { annotations: annotations.map((item, itemIndex) => itemIndex === index ? { ...item, text: value } : item) })} />
              <Button isIconOnly size="sm" variant="light" onPress={() => updateLayout(chart.id, { annotations: annotations.filter((_, itemIndex) => itemIndex !== index) })} aria-label={t('chart.removeAnnotation')}><Trash2 className="h-3 w-3 text-danger" /></Button>
            </div>
          ))}
          {shapes.map((shape, index) => (
            <div key={`shape-${index}`} className="flex items-center gap-1">
              <span className="w-14 shrink-0 text-[10px] text-muted">{shape.xref === 'paper' ? t('chart.hLine') : t('chart.vLine')}</span>
              <input type="color" className="h-6 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent" value={String(shape.line?.color || '#ef4444')} onChange={(event) => updateLayout(chart.id, { shapes: shapes.map((item, itemIndex) => itemIndex === index ? { ...item, line: { ...item.line, color: event.target.value } } : item) })} />
              <Button isIconOnly size="sm" variant="light" onPress={() => updateLayout(chart.id, { shapes: shapes.filter((_, itemIndex) => itemIndex !== index) })} aria-label={t('chart.removeShape')}><Trash2 className="h-3 w-3 text-danger" /></Button>
            </div>
          ))}
          {annotations.length === 0 && shapes.length === 0 && <div className="text-[11px] text-muted">{t('chart.annotationHint')}</div>}
        </div>
      </CollapsibleSection>
    </>
  )
}
