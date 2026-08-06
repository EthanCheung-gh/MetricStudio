import { useChartStore } from '@/stores/chartStore'
import { Input, Switch } from '@heroui/react'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'

export function PropertyEditor() {
  const charts = useChartStore((s) => s.charts)
  const activeChartId = useChartStore((s) => s.activeChartId)
  const updateLayout = useChartStore((s) => s.updateLayout)

  const chart = charts.find((c) => c.id === activeChartId)

  if (!chart) {
    return (
      <div className="rounded border border-border bg-surface-elevated p-3 text-xs text-muted">
        Select a chart to edit properties.
      </div>
    )
  }

  const layout = chart.layout as Record<string, any>
  const xaxis = (layout.xaxis || {}) as Record<string, any>
  const yaxis = (layout.yaxis || {}) as Record<string, any>
  const yaxis2 = (layout.yaxis2 || {}) as Record<string, any>

  const encoding = chart.encoding
  const hasRightAxis = (encoding.yFields || []).some((yf) => yf.axis === 'right')

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
    <CollapsibleSection title="Properties" defaultOpen={false}>
      <div className="flex flex-col gap-2">
        <Input size="sm" label="Title" value={String(layout.title || '')}
          onValueChange={(v) => updateLayout(chart.id, { title: v })} />
        <Input size="sm" label="X Axis Label" value={getTitleText(xaxis)}
          onValueChange={(v) => setTitleText('xaxis', v)} />
        <Input size="sm" label="Left Y Axis Label" value={getTitleText(yaxis)}
          onValueChange={(v) => setTitleText('yaxis', v)} />
        {hasRightAxis && (
          <Input size="sm" label="Right Y Axis Label" value={getTitleText(yaxis2)}
            onValueChange={(v) => setTitleText('yaxis2', v)} />
        )}
        <div className="flex items-center justify-between text-xs">
          <span>X Log Scale</span>
          <Switch size="sm" isSelected={xaxis.type === 'log'}
            onValueChange={(v) => setAxisLog('xaxis', v)} />
        </div>
        <div className="flex items-center justify-between text-xs">
          <span>Left Y Log Scale</span>
          <Switch size="sm" isSelected={yaxis.type === 'log'}
            onValueChange={(v) => setAxisLog('yaxis', v)} />
        </div>
        {hasRightAxis && (
          <div className="flex items-center justify-between text-xs">
            <span>Right Y Log Scale</span>
            <Switch size="sm" isSelected={yaxis2.type === 'log'}
              onValueChange={(v) => setAxisLog('yaxis2', v)} />
          </div>
        )}
        <div className="flex items-center justify-between text-xs">
          <span>Show Legend</span>
          <Switch size="sm" isSelected={!!layout.showlegend}
            onValueChange={(v) => updateLayout(chart.id, { showlegend: v })} />
        </div>
        <Input size="sm" type="color" label="Background Color"
          value={String(layout.plot_bgcolor || '#000000')}
          onValueChange={(v) => updateLayout(chart.id, { plot_bgcolor: v })} />
      </div>
    </CollapsibleSection>
  )
}
