import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Select, SelectItem, Switch } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { CollapsibleSection } from '@/components/common/CollapsibleSection'
import {
  FIELD_LABEL,
  JsonTextarea,
  LeafField,
  ObjectSection,
  RemoveButton,
  SlotValueField,
  UnsupportedNotice,
} from '@/components/chart/StyleField'
import { SPLIT_BY_TRACE_TYPES, TRACE_TYPES } from '@/utils/manifestForm'
import {
  dataKeysFor,
  errorAtPath,
  formToTrace,
  isRecord,
  optionalLabel,
  parseTraceFields,
  readSegments,
  sameJsonValue,
  serializeTraceFields,
  setPath,
  slotSources,
  switchTraceType,
  traceObjects,
  traceScalars,
  unrepresentedTraceKeys,
  writeSegments,
} from '@/utils/traceFields'
import type { SegmentState, SlotSources, TraceErrorSet, TraceState } from '@/utils/traceFields'
import type { ManifestForm, TraceForm } from '@/utils/manifestForm'

/**
 * Structured per-trace form.
 *
 * The trace's `type` lives in `TraceForm.type` and everything else in
 * `TraceForm.json` (that split is `manifestForm.ts`'s contract). Every edit
 * here patches one path and re-serializes the same object, so keys the form has
 * no control for survive untouched; the "高级（JSON）" panel is the only place
 * that replaces the object wholesale.
 *
 * `errors` carries this trace's slice of the validation problems (see
 * `traceErrors`), so the control the backend blamed — not just the section —
 * gets the red outline.
 */
export function TraceEditor({
  trace,
  form,
  errors,
  error,
  onChange,
}: {
  trace: TraceForm
  form: ManifestForm
  /** Problems scoped to this trace, keyed by leaf path (`marker.color`). */
  errors?: TraceErrorSet
  /** `traces[n].json` problem (the JSON escape hatch's own). */
  error?: string
  onChange: (next: Partial<TraceForm>) => void
}) {
  const { t } = useTranslation()
  const label = (key: string, fallback: string) => optionalLabel((name) => t(name), key, fallback)
  const fieldErrors = errors?.fields ?? {}

  const parsed = useMemo(() => parseTraceFields(trace.json), [trace.json])
  const sources = useMemo(() => slotSources(form), [form])
  const [dropped, setDropped] = useState<string[]>([])

  const fields = parsed.fields
  const state: TraceState = { type: trace.type, fields }
  const segment = readSegments(fields)
  const splitSupported = (SPLIT_BY_TRACE_TYPES as readonly string[]).includes(trace.type)
  const unrepresented = unrepresentedTraceKeys(trace.type, fields)

  const unsupportedMessage = (paths: string[]) => {
    if (paths.length === 0) return null
    return optionalLabel(
      (key) => t(key, { keys: paths.join(', ') }),
      'chart.workbench.unsupportedKeys',
      `unsupported keys: ${paths.join(', ')}`,
    )
  }

  const commit = (nextFields: Record<string, unknown>, type = trace.type) => {
    onChange({ type, json: serializeTraceFields(nextFields) })
  }
  const setField = (path: string, value: unknown) => commit(setPath(fields, path, value))

  const changeType = (nextType: string) => {
    const result = switchTraceType(state, nextType)
    setDropped(result.dropped)
    onChange({ type: result.state.type, json: serializeTraceFields(result.state.fields) })
  }

  // An unparsable JSON body leaves nothing to key the structured form off; the
  // escape hatch below stays mounted (and focused) instead of being replaced.
  const invalid = parsed.error !== undefined

  const typeOptions = (TRACE_TYPES as readonly string[]).includes(trace.type)
    ? [...TRACE_TYPES]
    : [...TRACE_TYPES, trace.type]

  // `segments` and top-level `x`/`y` are mutually exclusive: with segments on,
  // x/y are hidden (and removed on the way in). A hand-written trace that still
  // carries them keeps an editor so the conflict is fixable in the form.
  const hideSegmentsAxis = segment !== null
  const visibleDataKeys = dataKeysFor(trace.type).filter(
    (key) => !(hideSegmentsAxis && (key === 'x' || key === 'y') && !(key in fields)),
  )

  const defaultSegment = (): SegmentState => {
    const pick = (slot: string) => (sources.data.includes(slot) ? slot : '')
    return { x: pick('$x'), from: pick('$y0'), to: pick('$y1') || pick('$y0'), horizontal: false }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {!invalid && (
        <>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={FIELD_LABEL}>
              {label('chart.workbench.field.traceType', 'Trace type')}
            </span>
            <Select
              size="sm"
              aria-label={label('chart.workbench.field.traceType', 'Trace type')}
              selectedKeys={[trace.type]}
              onSelectionChange={(keys) => {
                const next = String(Array.from(keys)[0] ?? '')
                if (next !== '' && next !== trace.type) changeType(next)
              }}
              isInvalid={errors?.type !== undefined}
              classNames={{ trigger: 'h-7 min-h-7', value: 'font-mono text-[11px]' }}
            >
              {typeOptions.map((type) => (
                <SelectItem key={type} textValue={type}>
                  {type}
                </SelectItem>
              ))}
            </Select>
            {errors?.type !== undefined && (
              <span className="text-[10px] text-danger break-words">{errors.type}</span>
            )}
          </div>

          {dropped.length > 0 && (
            <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] text-warning break-words">
              <span>dropped</span> <span className="font-mono">{dropped.join(', ')}</span>
            </div>
          )}

          <CollapsibleSection title={label('chart.workbench.trace.data', 'Data')} defaultOpen>
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                {visibleDataKeys.map((key) => (
                  <SlotValueField
                    key={key}
                    label={key}
                    value={fields[key]}
                    options={sources.data}
                    error={errorAtPath(fieldErrors, key)}
                    onChange={(next) => setField(key, next)}
                  />
                ))}
              </div>

              {trace.type === 'scatter' &&
                (segment !== null ? (
                  <SegmentsForm
                    title={label('chart.workbench.segments', 'segments')}
                    segment={segment}
                    sources={sources}
                    errors={fieldErrors}
                    onChange={(next) => commit(writeSegments(fields, next))}
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="bordered"
                    className="w-full justify-start text-[11px]"
                    startContent={<Plus className="h-3 w-3" />}
                    onPress={() => commit(writeSegments(fields, defaultSegment()))}
                  >
                    {label('chart.workbench.segments', 'segments')}
                  </Button>
                ))}

              {splitSupported && (
                <div className="flex h-7 items-center justify-between gap-1">
                  <span className="font-mono text-[11px]">
                    {label('chart.workbench.splitBy', 'splitBy')}
                  </span>
                  <Switch
                    size="sm"
                    aria-label="splitBy"
                    isSelected={fields.splitBy === '$color'}
                    onValueChange={(enabled) =>
                      setField('splitBy', enabled ? '$color' : undefined)
                    }
                  />
                </div>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title={label('chart.workbench.trace.style', 'Style')}
            // A trace that already carries style objects opens on them, so a
            // converted chart shows its swatches instead of an empty row.
            defaultOpen={traceObjects(trace.type, fields).some((spec) =>
              isRecord(fields[spec.key]),
            )}
          >
            <div className="flex flex-col gap-1.5">
              <div className="grid grid-cols-2 gap-1.5">
                {traceScalars(trace.type, fields).map((spec) => (
                  <LeafField
                    key={spec.key}
                    spec={spec}
                    path={spec.key}
                    value={fields[spec.key]}
                    sources={sources}
                    error={errorAtPath(fieldErrors, spec.key)}
                    onChange={(next) => setField(spec.key, next)}
                  />
                ))}
              </div>
              <div className="flex flex-col gap-1">
                {traceObjects(trace.type, fields).map((spec) => (
                  <ObjectSection
                    key={spec.key}
                    spec={spec}
                    path={spec.key}
                    fields={fields}
                    sources={sources}
                    errors={fieldErrors}
                    commit={commit}
                  />
                ))}
              </div>
            </div>
          </CollapsibleSection>

          <UnsupportedNotice message={unsupportedMessage(unrepresented)} />
        </>
      )}

      <CollapsibleSection
        title={label('chart.workbench.trace.advanced', 'Advanced (JSON)')}
        defaultOpen={invalid}
      >
        <TraceJsonBody
          trace={trace}
          error={error ?? errors?.json ?? parsed.error}
          onChange={onChange}
        />
      </CollapsibleSection>
    </div>
  )
}

/**
 * `segments` sub-form: the three data slots plus the orientation switch.
 *
 * Values here are slot-only — the backend rejects literals in `segments`.
 */
function SegmentsForm({
  title,
  segment,
  sources,
  errors,
  onChange,
}: {
  title: string
  segment: SegmentState
  sources: SlotSources
  errors: Readonly<Record<string, string>>
  onChange: (next: SegmentState | null) => void
}) {
  const { t } = useTranslation()
  const removeLabel = optionalLabel(
    (key) => t(key),
    'chart.workbench.remove',
    'Remove',
  )
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px]">{title}</span>
        <RemoveButton label={`${removeLabel} ${title}`} onPress={() => onChange(null)} />
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {(['x', 'from', 'to'] as const).map((key) => (
          <SlotValueField
            key={key}
            label={`segments.${key}`}
            value={segment[key]}
            options={sources.data}
            allowLiteral={false}
            error={errorAtPath(errors, `segments.${key}`)}
            onChange={(next) => onChange({ ...segment, [key]: String(next ?? '') })}
          />
        ))}
      </div>
      <div className="flex h-7 items-center justify-between gap-1">
        <span className={FIELD_LABEL}>segments.horizontal</span>
        <Switch
          size="sm"
          aria-label="segments.horizontal"
          isSelected={segment.horizontal}
          onValueChange={(horizontal) => onChange({ ...segment, horizontal })}
        />
      </div>
    </div>
  )
}

/**
 * Full-trace JSON escape hatch.
 *
 * The textarea holds `{type, ...}` (the whole trace), so editing it replaces
 * the trace wholesale once it parses. `TraceForm` still needs the type apart
 * from the body, so a valid edit is split back out. The draft is kept verbatim
 * while it matches the object the form holds, which is what stops the
 * pretty-printer from rewriting the text under the cursor mid-edit.
 */
function TraceJsonBody({
  trace,
  error,
  onChange,
}: {
  trace: TraceForm
  error?: string
  onChange: (next: Partial<TraceForm>) => void
}) {
  const { t } = useTranslation()
  // `null` while the body does not parse: there is no object to compare the
  // draft against, and re-seeding would overwrite what is being typed.
  const canonical = useMemo(() => {
    const parsed = parseTraceFields(trace.json)
    if (parsed.error !== undefined) return null
    return JSON.stringify(formToTrace({ type: trace.type, fields: parsed.fields }), null, 2)
  }, [trace.type, trace.json])

  const [draft, setDraft] = useState(() => canonical ?? trace.json)
  const [parseError, setParseError] = useState<string | null>(null)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const canonicalRef = useRef(canonical)

  useEffect(() => {
    if (canonical === null || canonicalRef.current === canonical) return
    canonicalRef.current = canonical
    // A commit made from this textarea parses back to the same object; an edit
    // made anywhere else does not, and the panel follows the form again.
    let same = false
    try {
      same = sameJsonValue(JSON.parse(draftRef.current), JSON.parse(canonical))
    } catch {
      same = false
    }
    if (!same) {
      setDraft(canonical)
      setParseError(null)
    }
  }, [canonical])

  return (
    <JsonTextarea
      label={t('chart.workbench.field.json')}
      value={draft}
      error={error ?? parseError ?? undefined}
      minRows={8}
      onChange={(text) => {
        setDraft(text)
        try {
          const parsed: unknown = JSON.parse(text)
          if (!isRecord(parsed)) {
            setParseError('must be a JSON object')
            return
          }
          setParseError(null)
          const { type, ...rest } = parsed
          onChange({
            type: typeof type === 'string' ? type : trace.type,
            json: serializeTraceFields(rest),
          })
        } catch (err) {
          setParseError(err instanceof Error ? err.message : String(err))
        }
      }}
    />
  )
}
