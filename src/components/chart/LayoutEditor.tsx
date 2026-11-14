import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'
import {
  JsonTextarea,
  LeafField,
  NumberField,
  SlotValueField,
  UnsupportedNotice,
} from '@/components/chart/StyleField'
import {
  getPath,
  isRecord,
  layoutToForm,
  optionalLabel,
  optionSlots,
  parseLayoutFields,
  serializeLayoutFields,
  setPath,
  titleText,
  unrepresentedLayoutKeys,
} from '@/utils/traceFields'
import type { LeafSpec, SlotSources } from '@/utils/traceFields'
import type { ManifestForm } from '@/utils/manifestForm'

/**
 * Structured layout form.
 *
 * `layout` is one JSON object in the manifest and is stored as text
 * (`ManifestForm.layout`). Every control patches a single path with
 * `setPath`, so nested keys the form does not show (`xaxis.automargin`,
 * `legend.font`, …) stay exactly as written; the JSON panel replaces the whole
 * object once it parses.
 */

const BAR_MODES = ['stack', 'group', 'overlay', 'relative'] as const
const HOVER_MODES = ['closest', 'x', 'y', 'x unified', 'y unified', 'false'] as const
const LEGEND_ORIENTATIONS = ['v', 'h'] as const
const AXIS_TYPES = ['-', 'linear', 'log', 'date', 'category', 'multicategory'] as const
const MARGIN_KEYS = ['l', 'r', 't', 'b'] as const

export function LayoutEditor({
  layout,
  options,
  error,
  onChange,
}: {
  layout: string
  options: ManifestForm['options']
  error?: string
  onChange: (next: string) => void
}) {
  const { t } = useTranslation()
  const label = (key: string, fallback: string) => optionalLabel((name) => t(name), key, fallback)

  const parsed = useMemo(() => parseLayoutFields(layout), [layout])
  const invalid = parsed.error !== undefined
  const sources: SlotSources = useMemo(
    () => ({ data: [], labels: [], array: [], options: optionSlots(options) }),
    [options],
  )

  const fields = layoutToForm(parsed.fields).fields
  const commit = (next: Record<string, unknown>) => onChange(serializeLayoutFields(next))
  const setField = (path: string, value: unknown) => commit(setPath(fields, path, value))

  const unrepresented = unrepresentedLayoutKeys(fields)
  const unsupportedMessage =
    unrepresented.length === 0
      ? null
      : optionalLabel(
          (key) => t(key, { keys: unrepresented.join(', ') }),
          'chart.workbench.unsupportedKeys',
          `unsupported keys: ${unrepresented.join(', ')}`,
        )

  const axisEditor = (axis: 'xaxis' | 'yaxis') => {
    const current = isRecord(fields[axis]) ? (fields[axis] as Record<string, unknown>) : {}
    const spec = (key: string, control: LeafSpec['control'], choices?: readonly string[]) => ({
      key: `${axis}.${key}`,
      control,
      choices,
    })
    return (
      <div key={axis} className="flex flex-col gap-1 rounded border border-border/60 p-1.5">
        <span className="font-mono text-[11px]">{axis}</span>
        <div className="grid grid-cols-2 gap-1.5">
          <SlotValueField
            label={`${axis}.title`}
            value={titleText(current.title)}
            options={sources.options}
            onChange={(next) => setField(`${axis}.title.text`, next)}
          />
          <LeafField
            spec={spec('type', 'select', AXIS_TYPES)}
            value={current.type}
            sources={sources}
            onChange={(next) => setField(`${axis}.type`, next)}
          />
          <LeafField
            spec={spec('showgrid', 'boolean')}
            value={current.showgrid}
            sources={sources}
            onChange={(next) => setField(`${axis}.showgrid`, next)}
          />
          <SlotValueField
            label={`${axis}.gridcolor`}
            value={current.gridcolor}
            options={sources.options}
            onChange={(next) => setField(`${axis}.gridcolor`, next)}
          />
          <NumberField
            label={`${axis}.tickangle`}
            value={current.tickangle}
            options={sources.options}
            onChange={(next) => setField(`${axis}.tickangle`, next)}
          />
          <LeafField
            spec={spec('range', 'pair')}
            value={current.range}
            sources={sources}
            onChange={(next) => setField(`${axis}.range`, next)}
          />
        </div>
      </div>
    )
  }

  const legend = isRecord(fields.legend) ? (fields.legend as Record<string, unknown>) : {}

  return (
    <div className="flex flex-col gap-1.5">
      {!invalid && (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <LeafField
              spec={{ key: 'showlegend', control: 'boolean' }}
              value={fields.showlegend}
              sources={sources}
              onChange={(next) => setField('showlegend', next)}
            />
            <LeafField
              spec={{ key: 'barmode', control: 'select', choices: BAR_MODES }}
              value={fields.barmode}
              sources={sources}
              onChange={(next) => setField('barmode', next)}
            />
            <LeafField
              spec={{ key: 'hovermode', control: 'select', choices: HOVER_MODES }}
              value={fields.hovermode}
              sources={sources}
              onChange={(next) => setField('hovermode', next)}
            />
          </div>

          <div className="grid grid-cols-4 gap-1.5">
            {MARGIN_KEYS.map((key) => (
              <NumberField
                key={key}
                label={`margin.${key}`}
                value={getPath(fields, `margin.${key}`)}
                options={sources.options}
                onChange={(next) => setField(`margin.${key}`, next)}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <SlotValueField
              label="title.text"
              value={titleText(fields.title)}
              options={sources.options}
              onChange={(next) => setField('title.text', next)}
            />
            <SlotValueField
              label="polar.bgcolor"
              value={getPath(fields, 'polar.bgcolor')}
              options={sources.options}
              onChange={(next) => setField('polar.bgcolor', next)}
            />
          </div>

          <CollapsibleSection
            title={label('chart.workbench.layout.legend', 'Legend')}
            defaultOpen={false}
          >
            <div className="grid grid-cols-3 gap-1.5">
              <LeafField
                spec={{
                  key: 'legend.orientation',
                  control: 'select',
                  choices: LEGEND_ORIENTATIONS,
                }}
                value={legend.orientation}
                sources={sources}
                onChange={(next) => setField('legend.orientation', next)}
              />
              <NumberField
                label="legend.x"
                value={legend.x}
                options={sources.options}
                onChange={(next) => setField('legend.x', next)}
              />
              <NumberField
                label="legend.y"
                value={legend.y}
                options={sources.options}
                onChange={(next) => setField('legend.y', next)}
              />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title={label('chart.workbench.layout.axis', 'Axis')}
            defaultOpen={false}
          >
            <div className="flex flex-col gap-1.5">
              {axisEditor('xaxis')}
              {axisEditor('yaxis')}
            </div>
          </CollapsibleSection>

          <UnsupportedNotice message={unsupportedMessage} />
        </>
      )}

      <CollapsibleSection
        title={label('chart.workbench.trace.advanced', 'Advanced (JSON)')}
        defaultOpen={invalid}
      >
        <JsonTextarea
          label={t('chart.workbench.field.json')}
          value={layout}
          error={parsed.error ?? error}
          minRows={8}
          onChange={onChange}
        />
      </CollapsibleSection>
    </div>
  )
}
