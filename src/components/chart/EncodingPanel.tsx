import { Button, Select, SelectItem, Switch } from '@heroui/react'
import { Plus, X } from 'lucide-react'
import type { ColumnMeta } from '@/types/data'
import type { ChartConfig, ChartOptions, YFieldConfig, FieldType, AggregateType } from '@/types/encoding'
import { useChartStore } from '@/stores/chartStore'
import { aggregateOptions } from '@/utils/encodingToPlotly'
import { chartTypeSpecs, channelLabels, type ChannelKey } from '@/utils/chartTypeSpecs'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'

interface EncodingPanelProps {
  chart: ChartConfig
  columns: ColumnMeta[]
}

function SearchableSelect({ items, selectedKey, onSelect, label }: {
  items: { key: string; label: string }[]
  selectedKey?: string
  onSelect: (key: string | null) => void
  label: string
}) {
  return (
    <Select
      size="sm"
      label={label}
      placeholder={label}
      selectedKeys={selectedKey ? [selectedKey] : []}
      onSelectionChange={(keys) => onSelect(Array.from(keys)[0] as string || null)}
      className="min-w-0"
      classNames={{ trigger: 'h-7 min-h-7', label: 'text-[10px]', value: 'text-xs' }}
    >
      {items.map((item) => (
        <SelectItem key={item.key} textValue={item.label}>{item.label}</SelectItem>
      ))}
    </Select>
  )
}

function YFieldConfigRow({
  yf, index, columns, onUpdate, onRemove,
}: {
  yf: YFieldConfig; index: number; columns: ColumnMeta[]
  onUpdate: (index: number, updated: YFieldConfig) => void
  onRemove: (index: number) => void
}) {
  const fieldItems = columns.map((c) => ({ key: c.name, label: c.name }))
  const aggItems = aggregateOptions.map((opt) => ({ key: opt.value, label: opt.label }))
  const axisItems = [
    { key: 'left', label: '⇐ Left' },
    { key: 'right', label: 'Right ⇒' },
  ]
  const normItems = [
    { key: 'none', label: 'None' },
    { key: 'perSeries', label: 'Per Series' },
    { key: 'global', label: 'Global' },
  ]

  return (
    <div className="flex items-center gap-1 rounded border border-border bg-surface p-1">
      <div className="flex-1 min-w-0">
        <SearchableSelect
          items={fieldItems}
          selectedKey={yf.field}
          onSelect={(field) => {
            const col = columns.find((c) => c.name === field)
            onUpdate(index, { ...yf, field: field || '', type: (col?.inferredType as FieldType) || 'nominal' })
          }}
          label="Field"
        />
      </div>
      <div className="w-20 shrink-0">
        <SearchableSelect
          items={aggItems}
          selectedKey={yf.aggregate || undefined}
          onSelect={(agg) => onUpdate(index, { ...yf, aggregate: (agg as AggregateType) || null })}
          label="Agg"
        />
      </div>
      <div className="w-20 shrink-0">
        <SearchableSelect
          items={axisItems}
          selectedKey={yf.axis}
          onSelect={(axis) => onUpdate(index, { ...yf, axis: (axis as 'left' | 'right') || 'left' })}
          label="Axis"
        />
      </div>
      <div className="w-24 shrink-0">
        <SearchableSelect
          items={normItems}
          selectedKey={yf.normalize || 'none'}
          onSelect={(norm) => onUpdate(index, { ...yf, normalize: (norm as YFieldConfig['normalize']) || 'none' })}
          label="Norm"
        />
      </div>
      <Button isIconOnly size="sm" variant="light" className="h-6 w-6 min-w-0 shrink-0" onPress={() => onRemove(index)}>
        <X className="h-3 w-3" />
      </Button>
    </div>
  )
}

function ChannelSlot({ channel, chart, columns }: {
  channel: ChannelKey
  chart: ChartConfig; columns: ColumnMeta[]
}) {
  const encoding = chart.encoding[channel]
  const updateEncoding = useChartStore((s) => s.updateEncoding)

  const fieldItems = columns.map((c) => ({ key: c.name, label: c.name }))
  const aggItems = aggregateOptions.map((opt) => ({ key: opt.value, label: opt.label }))

  return (
    <div className="flex items-center gap-1">
      <span className="w-12 text-[10px] font-medium text-muted shrink-0">
        {channelLabels[channel]}
      </span>
      <div className="flex-1">
        <SearchableSelect
          items={fieldItems}
          selectedKey={encoding?.field}
          onSelect={(field) => {
            if (!field) {
              const next = { ...chart.encoding }
              delete next[channel]
              updateEncoding(chart.id, next)
              return
            }
            const col = columns.find((c) => c.name === field)
            updateEncoding(chart.id, {
              [channel]: { field, type: col?.inferredType || 'nominal' },
            })
          }}
          label=""
        />
      </div>
      {encoding && channel === 'x' && (
        <div className="w-20 shrink-0">
          <SearchableSelect
            items={aggItems}
            selectedKey={encoding.aggregate || undefined}
            onSelect={(agg) => {
              updateEncoding(chart.id, {
                x: { ...encoding, aggregate: agg ? (agg as AggregateType) : null },
              })
            }}
            label="Agg"
          />
        </div>
      )}
      {encoding && (
        <Button isIconOnly size="sm" variant="light" className="h-6 w-6 min-w-0 shrink-0" onPress={() => {
          const next = { ...chart.encoding }
          delete next[channel]
          updateEncoding(chart.id, next)
        }}>
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  )
}

/** Multi-column select for dimensions / path channels. */
function MultiColumnSelect({ label, values, columns, onChange }: {
  label: string
  values: string[]
  columns: ColumnMeta[]
  onChange: (next: string[]) => void
}) {
  return (
    <Select
      size="sm"
      selectionMode="multiple"
      label={label}
      placeholder={label}
      selectedKeys={new Set(values)}
      onSelectionChange={(keys) => onChange(Array.from(keys) as string[])}
      classNames={{ trigger: 'min-h-7', label: 'text-[10px]', value: 'text-xs' }}
    >
      {columns.map((c) => (
        <SelectItem key={c.name} textValue={c.name}>{c.name}</SelectItem>
      ))}
    </Select>
  )
}

function OptionsSection({ chart, specOptions, columns }: {
  chart: ChartConfig
  specOptions: NonNullable<(typeof chartTypeSpecs)[ChartConfig['encoding']['chartType']]['options']>
  columns: ColumnMeta[]
}) {
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const opts: ChartOptions = chart.encoding.options || {}
  const setOpts = (patch: Partial<ChartOptions>) =>
    updateEncoding(chart.id, { options: { ...opts, ...patch } })

  const fieldItems = columns.map((c) => ({ key: c.name, label: c.name }))

  return (
    <CollapsibleSection title="Options" defaultOpen={false}>
      <div className="flex flex-col gap-1.5">
        {specOptions.includes('barmode') && (
          <SearchableSelect
            label="Bar Mode"
            items={[{ key: 'group', label: 'Group' }, { key: 'stack', label: 'Stack' }]}
            selectedKey={opts.barmode || 'group'}
            onSelect={(v) => setOpts({ barmode: (v as ChartOptions['barmode']) || 'group' })}
          />
        )}
        {specOptions.includes('orientation') && (
          <SearchableSelect
            label="Orientation"
            items={[{ key: 'v', label: 'Vertical' }, { key: 'h', label: 'Horizontal' }]}
            selectedKey={opts.orientation || 'v'}
            onSelect={(v) => setOpts({ orientation: (v as ChartOptions['orientation']) || 'v' })}
          />
        )}
        {specOptions.includes('histnorm') && (
          <SearchableSelect
            label="Normalize"
            items={[
              { key: '', label: 'Count (default)' },
              { key: 'percent', label: 'Percent' },
              { key: 'probability', label: 'Probability' },
              { key: 'density', label: 'Density' },
            ]}
            selectedKey={opts.histnorm || ''}
            onSelect={(v) => setOpts({ histnorm: (v as ChartOptions['histnorm']) || null })}
          />
        )}
        {specOptions.includes('cumulative') && (
          <div className="flex items-center justify-between text-xs">
            <span>Cumulative</span>
            <Switch size="sm" isSelected={!!opts.cumulative} onValueChange={(v) => setOpts({ cumulative: v })} />
          </div>
        )}
        {specOptions.includes('boxPoints') && (
          <SearchableSelect
            label="Points"
            items={[
              { key: 'outliers', label: 'Outliers (default)' },
              { key: 'all', label: 'All' },
              { key: 'none', label: 'None' },
            ]}
            selectedKey={opts.boxPoints || 'outliers'}
            onSelect={(v) => setOpts({ boxPoints: (v as ChartOptions['boxPoints']) || 'outliers' })}
          />
        )}
        {specOptions.includes('marginal') && (
          <>
            <SearchableSelect
              label="Marginal X"
              items={[
                { key: '', label: 'None' },
                { key: 'histogram', label: 'Histogram' },
                { key: 'box', label: 'Box' },
                { key: 'violin', label: 'Violin' },
                { key: 'rug', label: 'Rug' },
              ]}
              selectedKey={opts.marginalX || ''}
              onSelect={(v) => setOpts({ marginalX: (v as ChartOptions['marginalX']) || null })}
            />
            <SearchableSelect
              label="Marginal Y"
              items={[
                { key: '', label: 'None' },
                { key: 'histogram', label: 'Histogram' },
                { key: 'box', label: 'Box' },
                { key: 'violin', label: 'Violin' },
                { key: 'rug', label: 'Rug' },
              ]}
              selectedKey={opts.marginalY || ''}
              onSelect={(v) => setOpts({ marginalY: (v as ChartOptions['marginalY']) || null })}
            />
          </>
        )}
        {specOptions.includes('annotated') && (
          <div className="flex items-center justify-between text-xs">
            <span>Annotate Cells</span>
            <Switch size="sm" isSelected={!!opts.annotated} onValueChange={(v) => setOpts({ annotated: v })} />
          </div>
        )}
        {specOptions.includes('corr') && (
          <div className="flex items-center justify-between text-xs">
            <span>Correlation Matrix</span>
            <Switch size="sm" isSelected={!!opts.corr} onValueChange={(v) => setOpts({ corr: v })} />
          </div>
        )}
        {specOptions.includes('ganttFields') && (
          <>
            <SearchableSelect
              label="Start Field"
              items={fieldItems}
              selectedKey={opts.startField}
              onSelect={(v) => setOpts({ startField: v || undefined })}
            />
            <SearchableSelect
              label="End Field"
              items={fieldItems}
              selectedKey={opts.endField}
              onSelect={(v) => setOpts({ endField: v || undefined })}
            />
          </>
        )}
      </div>
    </CollapsibleSection>
  )
}

export function EncodingPanel({ chart, columns }: EncodingPanelProps) {
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const yFields = chart.encoding.yFields || []
  const spec = chartTypeSpecs[chart.encoding.chartType]

  const updateYField = (index: number, updated: YFieldConfig) => {
    const newYFields = [...yFields]
    newYFields[index] = updated
    updateEncoding(chart.id, { yFields: newYFields })
  }

  const removeYField = (index: number) => {
    updateEncoding(chart.id, { yFields: yFields.filter((_, i) => i !== index) })
  }

  const addYField = () => {
    const firstCol = columns[0]
    const rawType = firstCol?.inferredType || 'quantitative'
    updateEncoding(chart.id, {
      yFields: [...yFields, {
        field: firstCol?.name || '',
        type: rawType === 'unknown' ? 'nominal' : rawType as FieldType,
        axis: 'left' as const,
        normalize: 'none' as const,
      }],
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {spec.yFields !== 'none' && (
        <CollapsibleSection title={`Y Fields (${yFields.length})`} defaultOpen={yFields.length > 0}>
          <div className="flex flex-col gap-1">
            {yFields.length === 0 && (
              <div className="rounded border border-dashed border-border p-2 text-center text-xs text-muted">
                No Y fields
              </div>
            )}
            {yFields.map((yf, idx) => (
              <YFieldConfigRow key={idx} yf={yf} index={idx} columns={columns}
                onUpdate={updateYField} onRemove={removeYField} />
            ))}
            <Button size="sm" variant="flat" onPress={addYField} className="w-full text-xs" startContent={<Plus className="h-3 w-3" />}>
              Add Y Field
            </Button>
          </div>
        </CollapsibleSection>
      )}

      {spec.channels.length > 0 && (
        <CollapsibleSection title="Encoding Channels" defaultOpen>
          <div className="flex flex-col gap-1.5">
            {spec.channels.map((ch) => (
              <ChannelSlot key={ch} channel={ch} chart={chart} columns={columns} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {spec.dimensionsLabel && (
        <CollapsibleSection title={spec.dimensionsLabel} defaultOpen>
          <MultiColumnSelect
            label={spec.dimensionsLabel}
            values={chart.encoding.dimensions || []}
            columns={columns}
            onChange={(dims) => updateEncoding(chart.id, { dimensions: dims })}
          />
        </CollapsibleSection>
      )}

      {spec.path && (
        <CollapsibleSection title="Hierarchy Path" defaultOpen>
          <MultiColumnSelect
            label="Path (outer → inner)"
            values={chart.encoding.path || []}
            columns={columns}
            onChange={(p) => updateEncoding(chart.id, { path: p })}
          />
        </CollapsibleSection>
      )}

      {spec.options && spec.options.length > 0 && (
        <OptionsSection chart={chart} specOptions={spec.options} columns={columns} />
      )}
    </div>
  )
}
