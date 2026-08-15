import { Button, Select, SelectItem, Switch } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import type { ColumnMeta } from '@/types/data'
import type { ChartConfig, ChartOptions, YFieldConfig, FieldType, AggregateType } from '@/types/encoding'
import { useChartStore } from '@/stores/chartStore'
import { aggregateOptions } from '@/utils/encodingToPlotly'
import { chartTypeSpecs, type ChannelKey } from '@/utils/chartTypeSpecs'
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
      aria-label={label || 'Select'}
      placeholder={label || 'Select'}
      selectedKeys={selectedKey ? [selectedKey] : []}
      onSelectionChange={(keys) => onSelect(Array.from(keys)[0] as string || null)}
      className="min-w-0"
      classNames={{ trigger: 'h-7 min-h-7', value: 'text-xs' }}
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
  const { t } = useTranslation()
  const fieldItems = columns.map((c) => ({ key: c.name, label: c.name }))
  const aggItems = aggregateOptions.map((opt) => ({
    key: opt.value,
    label: opt.value === '' ? t('chart.agg.none') : t(`chart.agg.${opt.value}`),
  }))
  const axisItems = [
    { key: 'left', label: t('chart.axis.left') },
    { key: 'right', label: t('chart.axis.right') },
  ]
  const normItems = [
    { key: 'none', label: t('chart.norm.none') },
    { key: 'perSeries', label: t('chart.norm.perSeries') },
    { key: 'global', label: t('chart.norm.global') },
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
          label={t('chart.field')}
        />
      </div>
      <div className="w-24 shrink-0">
        <SearchableSelect
          items={aggItems}
          selectedKey={yf.aggregate || undefined}
          onSelect={(agg) => onUpdate(index, { ...yf, aggregate: (agg as AggregateType) || null })}
          label={t('chart.agg')}
        />
      </div>
      <div className="w-24 shrink-0">
        <SearchableSelect
          items={axisItems}
          selectedKey={yf.axis}
          onSelect={(axis) => onUpdate(index, { ...yf, axis: (axis as 'left' | 'right') || 'left' })}
          label={t('chart.axis')}
        />
      </div>
      <div className="w-28 shrink-0">
        <SearchableSelect
          items={normItems}
          selectedKey={yf.normalize || 'none'}
          onSelect={(norm) => onUpdate(index, { ...yf, normalize: (norm as YFieldConfig['normalize']) || 'none' })}
          label={t('chart.norm')}
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
  const { t } = useTranslation()
  const encoding = chart.encoding[channel]
  const updateEncoding = useChartStore((s) => s.updateEncoding)

  const fieldItems = columns.map((c) => ({ key: c.name, label: c.name }))
  const aggItems = aggregateOptions.map((opt) => ({
    key: opt.value,
    label: opt.value === '' ? t('chart.agg.none') : t(`chart.agg.${opt.value}`),
  }))

  return (
    <div className="flex items-center gap-1">
      <span className="w-12 text-[10px] font-medium text-muted shrink-0">
        {t(`chart.channel.${channel}`)}
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
        <div className="w-24 shrink-0">
          <SearchableSelect
            items={aggItems}
            selectedKey={encoding.aggregate || undefined}
            onSelect={(agg) => {
              updateEncoding(chart.id, {
                x: { ...encoding, aggregate: agg ? (agg as AggregateType) : null },
              })
            }}
            label={t('chart.agg')}
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
  const { t } = useTranslation()
  const updateEncoding = useChartStore((s) => s.updateEncoding)
  const opts: ChartOptions = chart.encoding.options || {}
  const setOpts = (patch: Partial<ChartOptions>) =>
    updateEncoding(chart.id, { options: { ...opts, ...patch } })

  const fieldItems = columns.map((c) => ({ key: c.name, label: c.name }))

  return (
    <CollapsibleSection title={t('chart.options')} defaultOpen={false}>
      <div className="flex flex-col gap-1.5">
        {specOptions.includes('barmode') && (
          <SearchableSelect
            label={t('chart.barMode')}
            items={[{ key: 'group', label: t('chart.group') }, { key: 'stack', label: t('chart.stack') }]}
            selectedKey={opts.barmode || 'group'}
            onSelect={(v) => setOpts({ barmode: (v as ChartOptions['barmode']) || 'group' })}
          />
        )}
        {specOptions.includes('orientation') && (
          <SearchableSelect
            label={t('chart.orientation')}
            items={[{ key: 'v', label: t('chart.vertical') }, { key: 'h', label: t('chart.horizontal') }]}
            selectedKey={opts.orientation || 'v'}
            onSelect={(v) => setOpts({ orientation: (v as ChartOptions['orientation']) || 'v' })}
          />
        )}
        {specOptions.includes('histnorm') && (
          <SearchableSelect
            label={t('chart.normalize')}
            items={[
              { key: '', label: t('chart.countDefault') },
              { key: 'percent', label: t('chart.percent') },
              { key: 'probability', label: t('chart.probability') },
              { key: 'density', label: t('chart.density') },
            ]}
            selectedKey={opts.histnorm || ''}
            onSelect={(v) => setOpts({ histnorm: (v as ChartOptions['histnorm']) || null })}
          />
        )}
        {specOptions.includes('cumulative') && (
          <div className="flex items-center justify-between text-xs">
            <span>{t('chart.cumulative')}</span>
            <Switch size="sm" isSelected={!!opts.cumulative} onValueChange={(v) => setOpts({ cumulative: v })} />
          </div>
        )}
        {specOptions.includes('boxPoints') && (
          <SearchableSelect
            label={t('chart.points')}
            items={[
              { key: 'outliers', label: t('chart.outliers') },
              { key: 'all', label: t('chart.all') },
              { key: 'none', label: t('chart.none') },
            ]}
            selectedKey={opts.boxPoints || 'outliers'}
            onSelect={(v) => setOpts({ boxPoints: (v as ChartOptions['boxPoints']) || 'outliers' })}
          />
        )}
        {specOptions.includes('marginal') && (
          <>
            <SearchableSelect
              label={t('chart.marginalX')}
              items={[
                { key: '', label: t('chart.none') },
                { key: 'histogram', label: t('chart.histogram') },
                { key: 'box', label: t('chart.box') },
                { key: 'violin', label: t('chart.violin') },
                { key: 'rug', label: t('chart.rug') },
              ]}
              selectedKey={opts.marginalX || ''}
              onSelect={(v) => setOpts({ marginalX: (v as ChartOptions['marginalX']) || null })}
            />
            <SearchableSelect
              label={t('chart.marginalY')}
              items={[
                { key: '', label: t('chart.none') },
                { key: 'histogram', label: t('chart.histogram') },
                { key: 'box', label: t('chart.box') },
                { key: 'violin', label: t('chart.violin') },
                { key: 'rug', label: t('chart.rug') },
              ]}
              selectedKey={opts.marginalY || ''}
              onSelect={(v) => setOpts({ marginalY: (v as ChartOptions['marginalY']) || null })}
            />
          </>
        )}
        {specOptions.includes('annotated') && (
          <div className="flex items-center justify-between text-xs">
            <span>{t('chart.annotateCells')}</span>
            <Switch size="sm" isSelected={!!opts.annotated} onValueChange={(v) => setOpts({ annotated: v })} />
          </div>
        )}
        {specOptions.includes('corr') && (
          <div className="flex items-center justify-between text-xs">
            <span>{t('chart.corrMatrix')}</span>
            <Switch size="sm" isSelected={!!opts.corr} onValueChange={(v) => setOpts({ corr: v })} />
          </div>
        )}
        {specOptions.includes('ganttFields') && (
          <>
            <SearchableSelect
              label={t('chart.startField')}
              items={fieldItems}
              selectedKey={opts.startField}
              onSelect={(v) => setOpts({ startField: v || undefined })}
            />
            <SearchableSelect
              label={t('chart.endField')}
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
  const { t } = useTranslation()
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
        <CollapsibleSection title={t('chart.yFields', { count: yFields.length })} defaultOpen={yFields.length > 0}>
          <div className="flex flex-col gap-1">
            {yFields.length === 0 && (
              <div className="rounded border border-dashed border-border p-2 text-center text-xs text-muted">
                {t('chart.noYFields')}
              </div>
            )}
            {yFields.map((yf, idx) => (
              <YFieldConfigRow key={idx} yf={yf} index={idx} columns={columns}
                onUpdate={updateYField} onRemove={removeYField} />
            ))}
            <Button size="sm" variant="flat" onPress={addYField} className="w-full text-xs" startContent={<Plus className="h-3 w-3" />}>
              {t('chart.addYField')}
            </Button>
          </div>
        </CollapsibleSection>
      )}

      {spec.channels.length > 0 && (
        <CollapsibleSection title={t('chart.encodingChannels')} defaultOpen>
          <div className="flex flex-col gap-1.5">
            {spec.channels.map((ch) => (
              <ChannelSlot key={ch} channel={ch} chart={chart} columns={columns} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {spec.dimensionsLabel && (
        <CollapsibleSection
          title={spec.dimensionsLabel === 'Dimensions' ? t('chart.dimensions') : t('chart.tableColumns')}
          defaultOpen
        >
          <MultiColumnSelect
            label={spec.dimensionsLabel === 'Dimensions' ? t('chart.dimensions') : t('chart.tableColumns')}
            values={chart.encoding.dimensions || []}
            columns={columns}
            onChange={(dims) => updateEncoding(chart.id, { dimensions: dims })}
          />
        </CollapsibleSection>
      )}

      {spec.path && (
        <CollapsibleSection title={t('chart.hierarchyPath')} defaultOpen>
          <MultiColumnSelect
            label={t('chart.pathHint')}
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
