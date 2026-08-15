import { useTranslation } from 'react-i18next'
import { useChartStore } from '@/stores/chartStore'
import { Button, Input, Switch } from '@heroui/react'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'
import { Minus, MessageSquarePlus, Trash2 } from 'lucide-react'

export function PropertyEditor() {
  const { t } = useTranslation()
  const charts = useChartStore((s) => s.charts)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const updateLayout = useChartStore((s) => s.updateLayout)

  const chart = charts.find((c) => c.id === activeChartId)

  if (!chart) {
    return (
      <div className="rounded border border-border bg-surface-elevated p-3 text-xs text-muted">
        {t('chart.selectChartToEdit')}
      </div>
    )
  }

  const layout = chart.layout as Record<string, any>
  const xaxis = (layout.xaxis || {}) as Record<string, any>
  const yaxis = (layout.yaxis || {}) as Record<string, any>
  const yaxis2 = (layout.yaxis2 || {}) as Record<string, any>

  const encoding = chart.encoding
  const hasRightAxis = (encoding.yFields || []).some((yf) => yf.axis === 'right')

  const annotations = (layout.annotations || []) as Record<string, any>[]
  const shapes = (layout.shapes || []) as Record<string, any>[]

  const addTextAnnotation = () => {
    updateLayout(chart.id, {
      annotations: [
        ...annotations,
        { text: 'New annotation', xref: 'paper', yref: 'paper', x: 0.5, y: 1.02, showarrow: false, font: { size: 12, color: '#f5f5f5' } },
      ],
    })
  }

  const updateAnnotationText = (idx: number, text: string) => {
    updateLayout(chart.id, { annotations: annotations.map((a, i) => (i === idx ? { ...a, text } : a)) })
  }

  const removeAnnotation = (idx: number) => {
    updateLayout(chart.id, { annotations: annotations.filter((_, i) => i !== idx) })
  }

  const addShape = (kind: 'hline' | 'vline') => {
    const shape = kind === 'hline'
      ? { type: 'line', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 0, line: { color: '#ef4444', width: 2, dash: 'dash' } }
      : { type: 'line', xref: 'x', yref: 'paper', x0: 0, x1: 0, y0: 0, y1: 1, line: { color: '#ef4444', width: 2, dash: 'dash' } }
    updateLayout(chart.id, { shapes: [...shapes, shape] })
  }

  const updateShapeColor = (idx: number, color: string) => {
    updateLayout(chart.id, { shapes: shapes.map((sh, i) => (i === idx ? { ...sh, line: { ...sh.line, color } } : sh)) })
  }

  const removeShape = (idx: number) => {
    updateLayout(chart.id, { shapes: shapes.filter((_, i) => i !== idx) })
  }

  const getTitleText = (axis: Record<string, any>): string => {
    if (!axis.title) return ''
    if (typeof axis.title === 'object') return String((axis.title as Record<string, any>).text || '')
    return String(axis.title)
  }

  const setTitleText = (axisKey: string, value: string) => {
    const current = (layout[axisKey] || {}) as Record<string, any>
    updateLayout(chart.id, {
      [axisKey]: { ...current, title: { text: value } },
    })
  }

  const setAxisLog = (axisKey: string, log: boolean) => {
    const current = (layout[axisKey] || {}) as Record<string, any>
    updateLayout(chart.id, {
      [axisKey]: { ...current, type: log ? 'log' : '-' },
    })
  }

  return (
    <>
    <CollapsibleSection title={t('panel.properties')} defaultOpen={false}>
      <div className="flex flex-col gap-2">
        <Input size="sm" label={t('chart.title')} value={String(layout.title || '')}
          onValueChange={(v) => updateLayout(chart.id, { title: v })} />
        <Input size="sm" label={t('chart.xAxisLabel')} value={getTitleText(xaxis)}
          onValueChange={(v) => setTitleText('xaxis', v)} />
        <Input size="sm" label={t('chart.leftYAxisLabel')} value={getTitleText(yaxis)}
          onValueChange={(v) => setTitleText('yaxis', v)} />
        {hasRightAxis && (
          <Input size="sm" label={t('chart.rightYAxisLabel')} value={getTitleText(yaxis2)}
            onValueChange={(v) => setTitleText('yaxis2', v)} />
        )}
        <div className="flex items-center justify-between text-xs">
          <span>{t('chart.xAxisLog')}</span>
          <Switch size="sm" isSelected={xaxis.type === 'log'}
            onValueChange={(v) => setAxisLog('xaxis', v)} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>{t('chart.leftYAxisLog')}</span>
          <Switch size="sm" isSelected={yaxis.type === 'log'}
            onValueChange={(v) => setAxisLog('yaxis', v)} />
        </div>
        {hasRightAxis && (
          <div className="flex items-center justify-between text-xs">
            <span>{t('chart.rightYAxisLog')}</span>
            <Switch size="sm" isSelected={yaxis2.type === 'log'}
              onValueChange={(v) => setAxisLog('yaxis2', v)} />
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span>{t('chart.showLegend')}</span>
          <Switch size="sm" isSelected={!!layout.showlegend}
            onValueChange={(v) => updateLayout(chart.id, { showlegend: v })} />
        </div>
        <Input size="sm" type="color" label={t('chart.bgColor')}
          value={String(layout.plot_bgcolor || '#000000')}
          onValueChange={(v) => updateLayout(chart.id, { plot_bgcolor: v })} />
      </div>
    </CollapsibleSection>

    <CollapsibleSection title={t('panel.annotations')} defaultOpen={false}>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1">
          <Button size="sm" variant="flat" startContent={<MessageSquarePlus className="h-3 w-3" />} onPress={addTextAnnotation}>
            {t('chart.textAnnotation')}
          </Button>
          <Button size="sm" variant="flat" startContent={<Minus className="h-3 w-3" />} onPress={() => addShape('hline')}>
            {t('chart.hLine')}
          </Button>
          <Button size="sm" variant="flat" startContent={<Minus className="h-3 w-3 rotate-90" />} onPress={() => addShape('vline')}>
            {t('chart.vLine')}
          </Button>
        </div>
        {annotations.map((a, i) => (
          <div key={`ann-${i}`} className="flex items-center gap-1">
            <Input size="sm" value={String(a.text || '')} onValueChange={(v) => updateAnnotationText(i, v)} />
            <Button isIconOnly size="sm" variant="light" onPress={() => removeAnnotation(i)} aria-label="Remove annotation">
              <Trash2 className="h-3 w-3 text-danger" />
            </Button>
          </div>
        ))}
        {shapes.map((sh, i) => (
          <div key={`shape-${i}`} className="flex items-center gap-1">
            <span className="w-14 shrink-0 text-[10px] text-muted">{sh.xref === 'paper' ? 'hline' : 'vline'}</span>
            <input
              type="color"
              className="h-6 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              value={String(sh.line?.color || '#ef4444')}
              onChange={(e) => updateShapeColor(i, e.target.value)}
            />
            <Button isIconOnly size="sm" variant="light" onPress={() => removeShape(i)} aria-label="Remove shape">
              <Trash2 className="h-3 w-3 text-danger" />
            </Button>
          </div>
        ))}
        {annotations.length === 0 && shapes.length === 0 && (
          <div className="text-[11px] text-muted">{t('chart.annotationHint')}</div>
        )}
      </div>
    </CollapsibleSection>
    </>
  )
}
