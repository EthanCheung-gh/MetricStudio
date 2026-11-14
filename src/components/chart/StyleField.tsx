import { useState } from 'react'
import type { ComponentProps } from 'react'
import { Button, Input, Select, SelectItem, Switch, Textarea } from '@heroui/react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import {
  addNestedObject,
  appendGaugeStep,
  errorAtPath,
  getPath,
  isColorPath,
  isNumericArrayPath,
  isObjectSpec,
  isRecord,
  isSlotString,
  literalText,
  numberConstraints,
  optionalLabel,
  parseLiteralText,
  placeholderKind,
  removeNestedObject,
  setPath,
  swatchColor,
} from '@/utils/traceFields'
import type {
  LeafSpec,
  NumberConstraints,
  ObjectSpec,
  PlaceholderKind,
  SlotSources,
} from '@/utils/traceFields'

/**
 * Small controls shared by the trace / layout forms.
 *
 * The value model is deliberately the raw manifest value: a slot string
 * (`$x`, `$opt.width`), a JSON literal (number, string, list, boolean) or a
 * nested object. Nothing is normalised on the way in, so a control that is not
 * touched leaves its key byte-identical.
 *
 * Two UI rules the audit asked for:
 *
 * - every control is labelled with its schema path (`line.color`), because a
 *   bare input gives no hint what it edits;
 * - a value control that can switch between a slot and a literal says so with a
 *   visible "Value mode" select instead of an unexplained `literal` item.
 */

export const FIELD_LABEL = 'text-[10px] uppercase tracking-wide text-muted'
const ERROR_TEXT = 'text-[10px] leading-tight text-danger break-words'

/**
 * Shared look for every single-line input in the workbench.
 *
 * The label sits *outside* the box: inside a fixed-height `h-8` wrapper HeroUI
 * floats the label over the value and the top border, which is unreadable at
 * this scale. {@link WorkbenchInput} owns the placement, so it cannot drift.
 */
const workbenchInputClassNames = {
  input: 'text-xs',
  inputWrapper: 'h-8 min-h-8',
  label: FIELD_LABEL,
}

/** Compact box for inputs nested inside a card row (label still above). */
const denseInputClassNames = {
  input: 'text-[11px]',
  inputWrapper: 'h-7 min-h-7',
}

const MONO_FONT = 'font-mono text-[11px]'

/**
 * `<Input>` with the workbench's outside label.
 *
 * `isInvalid` / `errorMessage` keep working: HeroUI renders the message under
 * the box, and an outside label only moves the label into `mainWrapper`.
 * `dense` picks the 28px box for a row nested in a card; the label placement is
 * not a per-call decision.
 */
export function WorkbenchInput({
  classNames,
  dense = false,
  ...props
}: ComponentProps<typeof Input> & { dense?: boolean }) {
  return (
    <Input
      {...props}
      labelPlacement="outside"
      classNames={{ ...(dense ? denseInputClassNames : workbenchInputClassNames), ...classNames }}
    />
  )
}

const MODE_SLOT = 'slot'
const MODE_LITERAL = 'literal'

/** Plain-text fallbacks used until the locale file catches up. */
const PLACEHOLDER_FALLBACK: Record<PlaceholderKind, string> = {
  opacity: '0–1',
  color: '#3b82f6',
  hovertemplate: '%{x}: %{y}',
  number: '2',
}

type LabelFn = (key: string, fallback: string) => string

function useOptionalLabel(): LabelFn {
  const { t } = useTranslation()
  return (key, fallback) => optionalLabel((name) => t(name), key, fallback)
}

function placeholderFor(label: LabelFn, kind: PlaceholderKind | null): string | undefined {
  if (kind === null) return undefined
  return label(`chart.workbench.placeholder.${kind}`, PLACEHOLDER_FALLBACK[kind])
}

function stepProp(constraints: NumberConstraints): string {
  return constraints.step === 'any' ? 'any' : String(constraints.step)
}

function FieldError({ message }: { message?: string }) {
  if (message === undefined) return null
  return <span className={ERROR_TEXT}>{message}</span>
}

/**
 * Controlled text that keeps what is being typed.
 *
 * Number inputs re-derive their text from the parsed value, so `0.` would snap
 * back to `0` mid-keystroke. While the input has focus the local draft wins;
 * on blur it snaps to the canonical text again.
 */
function useTextDraft(external: string) {
  const [draft, setDraft] = useState(external)
  const [editing, setEditing] = useState(false)
  return {
    value: editing ? draft : external,
    set: setDraft,
    onFocus: () => {
      setDraft(external)
      setEditing(true)
    },
    onBlur: () => setEditing(false),
  }
}

export function RemoveButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Button
      isIconOnly
      size="sm"
      variant="light"
      color="danger"
      className="h-6 w-5 min-w-0 shrink-0"
      aria-label={label}
      title={label}
      onPress={onPress}
    >
      <X className="h-3 w-3" />
    </Button>
  )
}

/**
 * Compact colour swatch (`<input type="color">`).
 *
 * The text control stays authoritative: the swatch only writes a hex literal
 * and disappears when the value is a slot or a list (`swatchColor` returns
 * `null`), so `$opt.brand` / `$x.values` keep working.
 */
export function ColorSwatch({
  label,
  value,
  onChange,
}: {
  label: string
  value: unknown
  onChange: (next: string) => void
}) {
  const hex = swatchColor(value)
  if (hex === null) return null
  return (
    <input
      type="color"
      aria-label={`${label} ${hex}`}
      title={label}
      value={hex}
      onChange={(event) => onChange(event.target.value)}
      className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
    />
  )
}

/**
 * Slot/literal value control.
 *
 * Slots are the manifest-resolved options; `allowLiteral` is only set where the
 * backend accepts a literal in that position (`x`/`y`/… and style leaves do,
 * `segments` values do not). A hand-written slot the manifest does not offer
 * is kept as an extra item so it stays visible and selectable.
 */
export function SlotValueField({
  label,
  value,
  options,
  allowLiteral = true,
  numeric = false,
  constraints = { step: 'any' },
  placeholder,
  error,
  onChange,
}: {
  label: string
  value: unknown
  options: readonly string[]
  allowLiteral?: boolean
  numeric?: boolean
  constraints?: NumberConstraints
  placeholder?: string
  error?: string
  onChange: (next: unknown) => void
}) {
  const tLabel = useOptionalLabel()
  const modeLabel = tLabel('chart.workbench.valueMode.label', 'Value mode')
  const slotLabel = tLabel('chart.workbench.valueMode.slot', 'Slot')
  const literalLabel = tLabel('chart.workbench.valueMode.literal', 'Literal')

  const isSlot = isSlotString(value)
  // Which arm to show for an *empty* value; a non-empty value decides for
  // itself so an edit from the JSON panel is reflected immediately. With no
  // slot to offer (`line.color` without `$opt.*` options) the literal input is
  // the only useful arm.
  const [picked, setPicked] = useState<'slot' | 'literal' | null>(null)
  const hasValue = value !== undefined && value !== null && value !== ''
  const literalMode =
    allowLiteral && !isSlot && (hasValue || (picked ?? (options.length === 0 ? 'literal' : 'slot')) === 'literal')

  const items = isSlot && !options.includes(value) ? [...options, value] : [...options]
  const draft = useTextDraft(literalText(value))

  const literalInput = (
    <WorkbenchInput
      size="sm"
      type={numeric ? 'number' : 'text'}
      inputMode={numeric ? 'decimal' : undefined}
      min={numeric ? constraints.min : undefined}
      max={numeric ? constraints.max : undefined}
      step={numeric ? stepProp(constraints) : undefined}
      aria-label={label}
      placeholder={placeholder}
      value={draft.value}
      onFocus={draft.onFocus}
      onBlur={draft.onBlur}
      onValueChange={(text) => {
        draft.set(text)
        onChange(parseLiteralText(text, numeric))
      }}
      isInvalid={error !== undefined}
      dense
      classNames={{ input: MONO_FONT }}
    />
  )

  const slotSelect = (
    <Select
      size="sm"
      aria-label={label}
      placeholder="—"
      selectedKeys={isSlot ? [value] : []}
      onSelectionChange={(keys) => {
        const next = String(Array.from(keys)[0] ?? '')
        if (next !== '') onChange(next)
      }}
      isInvalid={error !== undefined}
      classNames={{ trigger: 'h-7 min-h-7', value: 'font-mono text-[11px]' }}
    >
      {items.map((option) => (
        <SelectItem key={option} textValue={option}>
          {option}
        </SelectItem>
      ))}
    </Select>
  )

  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={FIELD_LABEL}>{label}</span>
      <div className="flex min-w-0 items-center gap-1">
        {allowLiteral && (
          <Select
            size="sm"
            aria-label={modeLabel}
            label={modeLabel}
            labelPlacement="outside-left"
            selectedKeys={[literalMode ? MODE_LITERAL : MODE_SLOT]}
            onSelectionChange={(keys) => {
              const next = String(Array.from(keys)[0] ?? '')
              if (next === MODE_LITERAL) {
                setPicked(MODE_LITERAL)
                // Switching arms never invents a value: the old one is cleared
                // and the other control takes over.
                if (isSlot) onChange(undefined)
              } else if (next === MODE_SLOT) {
                setPicked(MODE_SLOT)
                if (!isSlot) onChange(undefined)
              }
            }}
            classNames={{
              base: 'w-[140px] shrink-0',
              label: 'text-[9px] whitespace-nowrap text-muted',
              trigger: 'h-7 min-h-7',
              value: 'font-mono text-[11px]',
            }}
          >
            <SelectItem key={MODE_SLOT} textValue={slotLabel}>
              {slotLabel}
            </SelectItem>
            <SelectItem key={MODE_LITERAL} textValue={literalLabel}>
              {literalLabel}
            </SelectItem>
          </Select>
        )}
        <div className="min-w-0 flex-1">{literalMode ? literalInput : slotSelect}</div>
        {isColorPath(label) && (
          <ColorSwatch label={label} value={value} onChange={onChange} />
        )}
      </div>
      <FieldError message={error} />
    </div>
  )
}

/**
 * Compact number input for layout scalars (`margin.l`, `legend.x`, …).
 *
 * The value may still be a `$opt.<key>` slot — typing one turns the control
 * into the slot select on the next render. A blank input deletes the key.
 */
export function NumberField({
  label,
  value,
  options,
  constraints = { step: 'any' },
  placeholder,
  error,
  onChange,
}: {
  label: string
  value: unknown
  options: readonly string[]
  constraints?: NumberConstraints
  placeholder?: string
  error?: string
  onChange: (next: unknown) => void
}) {
  const draft = useTextDraft(literalText(value))
  if (isSlotString(value)) {
    return (
      <SlotValueField
        label={label}
        value={value}
        options={options}
        numeric
        constraints={constraints}
        placeholder={placeholder}
        error={error}
        onChange={onChange}
      />
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={FIELD_LABEL}>{label}</span>
      <WorkbenchInput
        size="sm"
        type="number"
        inputMode="decimal"
        min={constraints.min}
        max={constraints.max}
        step={stepProp(constraints)}
        aria-label={label}
        placeholder={placeholder}
        value={draft.value}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        onValueChange={(text) => {
          draft.set(text)
          onChange(parseLiteralText(text, true))
        }}
        isInvalid={error !== undefined}
        dense
        classNames={{ input: MONO_FONT }}
      />
      <FieldError message={error} />
    </div>
  )
}

function BooleanField({
  label,
  value,
  error,
  onChange,
}: {
  label: string
  value: unknown
  error?: string
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex h-7 items-center justify-between gap-1">
        <span className="truncate font-mono text-[11px]">{label}</span>
        <Switch
          size="sm"
          isSelected={value === true}
          onValueChange={onChange}
          aria-label={label}
        />
      </div>
      <FieldError message={error} />
    </div>
  )
}

function SelectField({
  label,
  value,
  choices,
  error,
  onChange,
}: {
  label: string
  value: unknown
  choices: readonly string[]
  error?: string
  onChange: (next: string) => void
}) {
  const current = typeof value === 'string' ? value : literalText(value)
  const items = current !== '' && !choices.includes(current) ? [...choices, current] : [...choices]
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={FIELD_LABEL}>{label}</span>
      <Select
        size="sm"
        aria-label={label}
        placeholder="—"
        selectedKeys={current === '' ? [] : [current]}
        onSelectionChange={(keys) => {
          const next = String(Array.from(keys)[0] ?? '')
          if (next !== '') onChange(next)
        }}
        isInvalid={error !== undefined}
        classNames={{ trigger: 'h-7 min-h-7', value: 'font-mono text-[11px]' }}
      >
        {items.map((choice) => (
          <SelectItem key={choice} textValue={choice}>
            {choice}
          </SelectItem>
        ))}
      </Select>
      <FieldError message={error} />
    </div>
  )
}

/** Exactly-two value list (`gauge.axis.range`, `gauge.steps[].range`). */
export function PairField({
  label,
  value,
  options,
  numeric = false,
  error,
  onChange,
}: {
  label: string
  value: unknown
  options: readonly string[]
  numeric?: boolean
  error?: string
  onChange: (next: unknown[]) => void
}) {
  const list = Array.isArray(value) ? value : []
  const setAt = (index: number, next: unknown) => {
    const copy: unknown[] = [list[0] ?? '', list[1] ?? '']
    copy[index] = next
    onChange(copy)
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className={FIELD_LABEL}>{label}</span>
      <div className="flex min-w-0 gap-1">
        <div className="min-w-0 flex-1">
          <SlotValueField
            label={`${label}[0]`}
            value={list[0]}
            options={options}
            numeric={numeric}
            onChange={(next) => setAt(0, next)}
          />
        </div>
        <div className="min-w-0 flex-1">
          <SlotValueField
            label={`${label}[1]`}
            value={list[1]}
            options={options}
            numeric={numeric}
            onChange={(next) => setAt(1, next)}
          />
        </div>
      </div>
      <FieldError message={error} />
    </div>
  )
}

/** `gauge.steps`: at most 10 `{range: [lo, hi], color}` objects. */
export function GaugeStepsField({
  label,
  value,
  sources,
  error,
  onChange,
}: {
  label: string
  value: unknown
  sources: SlotSources
  error?: string
  onChange: (next: unknown[]) => void
}) {
  const tLabel = useOptionalLabel()
  const addLabel = tLabel('chart.workbench.add', 'Add')
  const removeLabel = tLabel('chart.workbench.remove', 'Remove')
  const steps = Array.isArray(value) ? value.filter(isRecord) : []
  const replace = (index: number, next: Record<string, unknown>) =>
    onChange(steps.map((step, i) => (i === index ? next : step)))
  return (
    <div className="flex flex-col gap-1">
      <span className={FIELD_LABEL}>{label}</span>
      {steps.map((step, index) => {
        const stepPath = `${label}[${index}]`
        const range = Array.isArray(step.range) ? step.range : []
        const setRange = (item: number, next: unknown) => {
          const copy: unknown[] = [range[0] ?? '', range[1] ?? '']
          copy[item] = next
          replace(index, { ...step, range: copy })
        }
        return (
          <div key={index} className="flex flex-col gap-1 rounded border border-border/60 p-1">
            <div className="flex items-center justify-between gap-1">
              <span className="font-mono text-[10px] text-muted">{stepPath}</span>
              <RemoveButton
                label={`${removeLabel} ${stepPath}`}
                onPress={() => onChange(steps.filter((_, i) => i !== index))}
              />
            </div>
            <div className="flex min-w-0 items-start gap-1">
              <SlotValueField
                label={`${stepPath}.range[0]`}
                value={range[0]}
                options={sources.options}
                onChange={(next) => setRange(0, next)}
              />
              <SlotValueField
                label={`${stepPath}.range[1]`}
                value={range[1]}
                options={sources.options}
                onChange={(next) => setRange(1, next)}
              />
            </div>
            <div className="min-w-0">
              <SlotValueField
                label={`${stepPath}.color`}
                value={step.color}
                options={sources.options}
                onChange={(next) => replace(index, setPath(step, 'color', next))}
              />
            </div>
          </div>
        )
      })}
      <Button
        size="sm"
        variant="bordered"
        className="w-full justify-start text-[11px]"
        startContent={<Plus className="h-3 w-3" />}
        isDisabled={steps.length >= 10}
        onPress={() => onChange(appendGaugeStep(steps))}
      >
        {addLabel} {label}
      </Button>
      <FieldError message={error} />
    </div>
  )
}

/**
 * One schema leaf.
 *
 * `path` is the schema path (`line.color`, `gauge.steps[0].color`): it labels
 * the control, selects the colour swatch / numeric constraints and finds the
 * matching validation error.
 */
export function LeafField({
  spec,
  path,
  value,
  sources,
  error,
  onChange,
}: {
  spec: LeafSpec
  path?: string
  value: unknown
  sources: SlotSources
  error?: string
  onChange: (next: unknown) => void
}) {
  const fieldPath = path ?? spec.key
  const tLabel = useOptionalLabel()
  const kind = placeholderKind(fieldPath, spec.control)
  const placeholder = placeholderFor(tLabel, kind)
  const constraints = numberConstraints(fieldPath)
  // `marker.size` / `marker.opacity` accept a `$x.values` array slot, but their
  // literal form is one number, so the literal arm is a number input.
  const numericLiteral = spec.control === 'styleNumber' || isNumericArrayPath(fieldPath)

  switch (spec.control) {
    case 'boolean':
      if (isSlotString(value)) {
        return (
          <SlotValueField
            label={fieldPath}
            value={value}
            options={sources.options}
            error={error}
            onChange={onChange}
          />
        )
      }
      return (
        <BooleanField label={fieldPath} value={value} error={error} onChange={onChange} />
      )
    case 'select':
      return (
        <SelectField
          label={fieldPath}
          value={value}
          choices={spec.choices ?? []}
          error={error}
          onChange={onChange}
        />
      )
    case 'pair':
      return (
        <PairField
          label={fieldPath}
          value={value}
          options={sources.options}
          error={error}
          onChange={onChange}
        />
      )
    case 'list':
      return (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className={FIELD_LABEL}>{fieldPath}</span>
          <WorkbenchInput
            size="sm"
            aria-label={fieldPath}
            placeholder={placeholder ?? '[1, 2]'}
            value={literalText(value)}
            onValueChange={(text) => onChange(parseLiteralText(text, false))}
            isInvalid={error !== undefined}
            dense
            classNames={{ input: MONO_FONT }}
          />
          <FieldError message={error} />
        </div>
      )
    case 'steps':
      return (
        <GaugeStepsField
          label={fieldPath}
          value={value}
          sources={sources}
          error={error}
          onChange={onChange}
        />
      )
    case 'data':
      return (
        <SlotValueField
          label={fieldPath}
          value={value}
          options={sources.data}
          placeholder={placeholder}
          error={error}
          onChange={onChange}
        />
      )
    case 'dataOnly':
      return (
        <SlotValueField
          label={fieldPath}
          value={value}
          options={sources.data}
          allowLiteral={false}
          error={error}
          onChange={onChange}
        />
      )
    case 'text':
      return (
        <SlotValueField
          label={fieldPath}
          value={value}
          options={spec.slots === 'label' ? [...sources.labels, ...sources.options] : sources.options}
          placeholder={placeholder}
          error={error}
          onChange={onChange}
        />
      )
    case 'arrayStyle':
      return (
        <SlotValueField
          label={fieldPath}
          value={value}
          options={[...sources.array, ...sources.options]}
          numeric={numericLiteral}
          constraints={constraints}
          placeholder={placeholder}
          error={error}
          onChange={onChange}
        />
      )
    case 'styleNumber':
      return (
        <SlotValueField
          label={fieldPath}
          value={value}
          options={sources.options}
          numeric
          constraints={constraints}
          placeholder={placeholder}
          error={error}
          onChange={onChange}
        />
      )
    case 'style':
    default:
      return (
        <SlotValueField
          label={fieldPath}
          value={value}
          options={sources.options}
          placeholder={placeholder}
          error={error}
          onChange={onChange}
        />
      )
  }
}

function LeafRow({
  spec,
  path,
  fields,
  sources,
  errors,
  commit,
}: {
  spec: LeafSpec
  path: string
  fields: Record<string, unknown>
  sources: SlotSources
  errors: Readonly<Record<string, string>>
  commit: (next: Record<string, unknown>) => void
}) {
  const tLabel = useOptionalLabel()
  const removeLabel = tLabel('chart.workbench.remove', 'Remove')
  const value = getPath(fields, path)
  return (
    <div className="flex min-w-0 items-start gap-1">
      <div className="min-w-0 flex-1">
        <LeafField
          spec={spec}
          path={path}
          value={value}
          sources={sources}
          error={errorAtPath(errors, path)}
          onChange={(next) => commit(setPath(fields, path, next))}
        />
      </div>
      {value !== undefined && (
        <RemoveButton
          label={`${removeLabel} ${path}`}
          onPress={() => commit(setPath(fields, path, undefined))}
        />
      )}
    </div>
  )
}

/**
 * One nested style object (`line`, `marker`, `marker.line`, `gauge.axis`, …).
 *
 * Absent objects collapse to an explicit "Add <path>" button (a `+ line` row
 * reads like a list item); once added, its fields sit inline in a bordered
 * block titled with the path and an X removes the whole object again.
 */
export function ObjectSection({
  spec,
  path,
  fields,
  sources,
  errors,
  commit,
}: {
  spec: ObjectSpec
  path: string
  fields: Record<string, unknown>
  sources: SlotSources
  errors: Readonly<Record<string, string>>
  commit: (next: Record<string, unknown>) => void
}) {
  const tLabel = useOptionalLabel()
  const addLabel = tLabel('chart.workbench.add', 'Add')
  const removeLabel = tLabel('chart.workbench.remove', 'Remove')
  const value = getPath(fields, path)

  if (!isRecord(value)) {
    return (
      <Button
        size="sm"
        variant="bordered"
        className="w-full justify-start text-[11px]"
        startContent={<Plus className="h-3 w-3" />}
        aria-label={`${addLabel} ${path}`}
        onPress={() => commit(addNestedObject(fields, path))}
      >
        {addLabel} <span className="font-mono">{path}</span>
      </Button>
    )
  }
  return (
    <div className="rounded border border-border/60">
      <div className="flex items-center justify-between gap-1 px-1.5 py-0.5">
        <span className="truncate font-mono text-[11px]">{path}</span>
        <RemoveButton
          label={`${removeLabel} ${path}`}
          onPress={() => commit(removeNestedObject(fields, path))}
        />
      </div>
      <div className="flex flex-col gap-1 p-1.5 pt-0">
        {spec.children.map((child) =>
          isObjectSpec(child) ? (
            <ObjectSection
              key={child.key}
              spec={child}
              path={`${path}.${child.key}`}
              fields={fields}
              sources={sources}
              errors={errors}
              commit={commit}
            />
          ) : (
            <LeafRow
              key={child.key}
              spec={child}
              path={`${path}.${child.key}`}
              fields={fields}
              sources={sources}
              errors={errors}
              commit={commit}
            />
          ),
        )}
        <FieldError message={errorAtPath(errors, path)} />
      </div>
    </div>
  )
}

/** The "高级（JSON）" editor: the full object, replaced wholesale on save. */
export function JsonTextarea({
  label,
  value,
  error,
  minRows = 4,
  onChange,
}: {
  label: string
  value: string
  error?: string
  minRows?: number
  onChange: (next: string) => void
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <Textarea
        size="sm"
        aria-label={label}
        minRows={minRows}
        placeholder="{ }"
        value={value}
        onValueChange={onChange}
        isInvalid={error !== undefined}
        classNames={{ input: 'font-mono text-[11px]' }}
      />
      {error !== undefined && <span className="text-[10px] text-danger">{error}</span>}
    </div>
  )
}

/**
 * Non-blocking notice listing keys the form cannot represent. They stay in the
 * object; this only says where they can be edited.
 */
export function UnsupportedNotice({ message }: { message: string | null }) {
  if (message === null) return null
  return (
    <div className="rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] leading-relaxed text-warning break-words">
      {message}
    </div>
  )
}
