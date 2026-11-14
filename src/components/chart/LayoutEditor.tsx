import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'
import {
  FIELD_LABEL,
  JsonTextarea,
  LeafField,
  NumberField,
  PairField,
  UnsupportedNotice,
} from '@/components/chart/StyleField'
import {
  errorAtPath,
  getPath,
  isRecord,
  layoutLeafValue,
  layoutRangeValue,
  layoutToForm,
  numberConstraints,
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
 *
 * The core set (`LAYOUT_FIELD_PATHS`) is always rendered, including for a
 * converted chart whose `layout` only has `{xaxis: {}, yaxis: {}}`. A control
 * that is still empty shows its placeholder and writes nothing; clearing a
 * field removes the key (`layoutLeafValue`) instead of writing `""`/`0`, so
 * opening a manifest never invents layout keys.
 */

const BAR_MODES = ['stack', 'group', 'overlay', 'relative'] as const
const HOVER_MODES = ['closest', 'x', 'y', 'x unified', 'y unified', 'false'] as const
const LEGEND_ORIENTATIONS = ['v', 'h'] as const
const AXIS_TYPES = ['-', 'linear', 'log', 'date', 'category', 'multicategory'] as const
const MARGIN_KEYS = ['l', 'r', 't', 'b'] as const
const AXIS_KEYS = ['xaxis', 'yaxis'] as const

export function LayoutEditor({
  layout,
  options,
  errors = {},
  error,
  onChange,
}: {
  layout: string
  options: ManifestForm['options']
  /** `layout`-relative problems (`xaxis.title`, `margin.l`); `''` is the object. */
  errors?: Readonly<Record<string, string>>
  /** `layout` text problem (unparsable JSON, …). */
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

  /**
   * Commit one control. A blank value deletes the key — and a key that is
   * already absent is left alone, so a no-op edit never writes `layout`.
   */
  const setField = (path: string, value: unknown) => {
    const cleared = layoutLeafValue(value)
    if (cleared === undefined && getPath(fields, path) === undefined) return
    commit(setPath(fields, path, cleared))
  }

  /** A range with both ends blank is not a range: delete instead of `["",""]`. */
  const setRange = (path: string, lo: unknown, hi: unknown) => {
    const next = layoutRangeValue(lo, hi)
    if (next === undefined && getPath(fields, path) === undefined) return
    commit(setPath(fields, path, next))
  }

  /**
   * `title` may be a bare string or `{text}` (Plotly accepts both), so a title
   * control writes `title.text` but must also be able to clear a bare string —
   * clearing only the leaf would leave the old value on screen.
   */
  const setTitleText = (parent: string, next: unknown) => {
    const text = layoutLeafValue(next)
    const current = getPath(fields, parent)
    if (text !== undefined) {
      setField(`${parent}.text`, text)
      return
    }
    if (current === undefined) return
    if (isRecord(current)) setField(`${parent}.text`, undefined)
    else commit(setPath(fields, parent, undefined))
  }

  const unrepresented = unrepresentedLayoutKeys(fields)
  const unsupportedMessage =
    unrepresented.length === 0
      ? null
      : optionalLabel(
          (key) => t(key, { keys: unrepresented.join(', ') }),
          'chart.workbench.unsupportedKeys',
          `unsupported keys: ${unrepresented.join(', ')}`,
        )

  const leaf = (
    path: string,
    control: LeafSpec['control'],
    choices?: readonly string[],
    value: unknown = getPath(fields, path),
  ) => (
    <LeafField
      spec={{ key: path, control, choices }}
      path={path}
      value={value}
      sources={sources}
      error={errorAtPath(errors, path)}
      onChange={(next) => setField(path, next)}
    />
  )

  const axisEditor = (axis: (typeof AXIS_KEYS)[number]) => {
    const current = isRecord(fields[axis]) ? (fields[axis] as Record<string, unknown>) : {}
    return (
      <div key={axis} className="flex flex-col gap-1 rounded border border-border/60 p-1.5">
        <span className="font-mono text-[11px]">{axis}</span>
        <div className="grid grid-cols-2 gap-1.5">
          <LeafField
            spec={{ key: `${axis}.title.text`, control: 'style' }}
            path={`${axis}.title.text`}
            value={titleText(current.title)}
            sources={sources}
            error={errorAtPath(errors, `${axis}.title.text`)}
            onChange={(next) => setTitleText(`${axis}.title`, next)}
          />
          <LeafField
            spec={{ key: `${axis}.type`, control: 'select', choices: AXIS_TYPES }}
            path={`${axis}.type`}
            value={current.type}
            sources={sources}
            error={errorAtPath(errors, `${axis}.type`)}
            // `-` is the "auto" choice: clear the key instead of writing it.
            onChange={(next) => setField(`${axis}.type`, next === '-' ? undefined : next)}
          />
          {leaf(`${axis}.showgrid`, 'boolean', undefined, current.showgrid)}
          {leaf(`${axis}.gridcolor`, 'style', undefined, current.gridcolor)}
          <NumberField
            label={`${axis}.tickangle`}
            value={current.tickangle}
            options={sources.options}
            constraints={numberConstraints(`${axis}.tickangle`)}
            placeholder={label('chart.workbench.placeholder.number', 'number')}
            error={errorAtPath(errors, `${axis}.tickangle`)}
            onChange={(next) => setField(`${axis}.tickangle`, next)}
          />
          <div className="col-span-2 min-w-0">
            <PairField
              label={`${axis}.range`}
              value={current.range}
              options={sources.options}
              error={errorAtPath(errors, `${axis}.range`)}
              onChange={(next) => setRange(`${axis}.range`, next[0], next[1])}
            />
          </div>
        </div>
      </div>
    )
  }

  const legend = isRecord(fields.legend) ? (fields.legend as Record<string, unknown>) : {}

  return (
    <div className="flex flex-col gap-1.5">
      {!invalid && (
        <>
          {errors[''] !== undefined && (
            <div className="rounded border border-danger/40 bg-danger/10 px-2 py-1 text-[10px] text-danger break-words">
              {errors['']}
            </div>
          )}

          <div className="grid grid-cols-3 gap-1.5">
            {leaf('showlegend', 'boolean')}
            {leaf('barmode', 'select', BAR_MODES)}
            {leaf('hovermode', 'select', HOVER_MODES)}
          </div>

          <div className="flex flex-col gap-1 rounded border border-border/60 p-1.5">
            <span className={FIELD_LABEL}>{label('chart.workbench.layout.title', 'Title')}</span>
            <div className="grid grid-cols-2 gap-1.5">
              <LeafField
                spec={{ key: 'title.text', control: 'style' }}
                path="title.text"
                value={titleText(fields.title)}
                sources={sources}
                error={errorAtPath(errors, 'title.text')}
                onChange={(next) => setTitleText('title', next)}
              />
              {leaf('polar.bgcolor', 'style')}
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded border border-border/60 p-1.5">
            <span className={FIELD_LABEL}>
              {label('chart.workbench.layout.margin', 'Margin')}
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {MARGIN_KEYS.map((key) => (
                <NumberField
                  key={key}
                  label={`margin.${key}`}
                  value={getPath(fields, `margin.${key}`)}
                  options={sources.options}
                  constraints={numberConstraints(`margin.${key}`)}
                  placeholder={label('chart.workbench.placeholder.number', 'number')}
                  error={errorAtPath(errors, `margin.${key}`)}
                  onChange={(next) => setField(`margin.${key}`, next)}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded border border-border/60 p-1.5">
            <span className={FIELD_LABEL}>
              {label('chart.workbench.layout.legend', 'Legend')}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {leaf('legend.orientation', 'select', LEGEND_ORIENTATIONS, legend.orientation)}
              <NumberField
                label="legend.x"
                value={legend.x}
                options={sources.options}
                constraints={numberConstraints('legend.x')}
                placeholder={label('chart.workbench.placeholder.number', 'number')}
                error={errorAtPath(errors, 'legend.x')}
                onChange={(next) => setField('legend.x', next)}
              />
              <NumberField
                label="legend.y"
                value={legend.y}
                options={sources.options}
                constraints={numberConstraints('legend.y')}
                placeholder={label('chart.workbench.placeholder.number', 'number')}
                error={errorAtPath(errors, 'legend.y')}
                onChange={(next) => setField('legend.y', next)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1 rounded border border-border/60 p-1.5">
            <span className="font-mono text-[11px]">
              {label('chart.workbench.layout.axis', 'Axes')}
            </span>
            <div className="flex flex-col gap-1.5">
              {AXIS_KEYS.map((axis) => axisEditor(axis))}
            </div>
          </div>

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
